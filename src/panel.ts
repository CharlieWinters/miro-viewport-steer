// Panel iframe: the display's audio surface. It auto-opens when Claude wants to
// talk; the user taps "Allow" once (the gesture that unlocks audio), then clips
// pushed from the Claude side play automatically. TTS happens on the Claude
// side — the panel just plays the audioUrl it's handed.
import { EV, type NarrateCommand, settings } from './shared'

const board = (window as unknown as { miro: { board: any } }).miro.board

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

let audioCtx: AudioContext | null = null
let audioEnabled = false
const audioEl = new Audio()
const queue: NarrateCommand[] = []
let playing = false

function setStatus(msg: string) {
  $('status').textContent = msg
}

/** Show/hide the "Claude wants to talk to you → Allow" consent card. */
function showConsent(show: boolean) {
  $('consent').style.display = show ? 'block' : 'none'
  $('player').style.display = show ? 'none' : 'block'
}

function allow() {
  // Unlock autoplay inside the click handler.
  audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)()
  void audioCtx.resume()
  audioEnabled = true
  showConsent(false)
  setStatus('Connected — narration will play here.')
  void pump()
}

async function pump() {
  if (playing || !audioEnabled) return
  const cmd = queue.shift()
  if (!cmd) return
  playing = true
  $('nowPlaying').textContent = cmd.text || '(audio)'

  const done = () => {
    playing = false
    $('nowPlaying').textContent = ''
    void pump()
  }

  if (cmd.audioUrl) {
    try {
      audioEl.src = cmd.audioUrl
      audioEl.onended = done
      audioEl.onerror = () => {
        setStatus('Audio failed to load — showing text')
        $('transcript').textContent = cmd.text
        setTimeout(done, 1500)
      }
      await audioEl.play()
      setStatus('Narrating…')
      return
    } catch (e) {
      setStatus('Playback blocked — showing text (' + (e as Error).message + ')')
    }
  }
  // No audio (or playback failed before load): show the text as a caption.
  $('transcript').textContent = cmd.text
  setTimeout(done, Math.min(8000, 1500 + cmd.text.length * 45))
}

function skip() {
  audioEl.pause()
  audioEl.currentTime = 0
  playing = false
  $('nowPlaying').textContent = ''
  void pump()
}

function togglePause() {
  if (audioEl.paused) void audioEl.play()
  else audioEl.pause()
}

const seenNarrations = new Set<string>()

function handleNarration(cmd: NarrateCommand) {
  // Dedup: two headless iframes may relay the same command.
  if (cmd.id && seenNarrations.has(cmd.id)) return
  if (cmd.id) seenNarrations.add(cmd.id)
  queue.push(cmd)
  if (audioEnabled) void pump()
  else {
    showConsent(true) // first message before consent → prompt the user
    $('transcript').textContent = ''
  }
}

function initUI() {
  $('allow').addEventListener('click', allow)
  $('skip').addEventListener('click', skip)
  $('pause').addEventListener('click', togglePause)

  const dont = $<HTMLInputElement>('dontMove')
  dont.checked = settings.dontMoveMyView
  dont.addEventListener('change', () => {
    settings.dontMoveMyView = dont.checked
  })

  showConsent(true)
}

async function init() {
  initUI()

  // Narration arrives via the headless iframe's same-origin relay.
  const narrateRelay = new BroadcastChannel('vs-narrate')
  narrateRelay.onmessage = (e: MessageEvent) => handleNarration(e.data as NarrateCommand)

  // Still subscribe directly too, as a best-effort path.
  await board.events.on(EV.narrate, (cmd: NarrateCommand) => handleNarration(cmd))

  setStatus('Waiting for Claude…')
}

void init()
export {}
