// Panel iframe: the app's UI surface and the audio surface for narration.
// Audio must originate here because the headless iframe has no user gesture to
// unlock autoplay. The operator taps "Enable audio" once per session.
import { EV, type NarrateCommand, type BoardContext, settings } from './shared'
import { synthesize, TtsError } from './tts'

const board = (window as unknown as { miro: { board: any } }).miro.board

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// --- Audio playback (queue + pause/skip) ----------------------------------

let audioCtx: AudioContext | null = null
let audioEnabled = false
const audioEl = new Audio()
const queue: NarrateCommand[] = []
let playing = false

function setStatus(msg: string) {
  $('status').textContent = msg
}

function enableAudio() {
  // Resume an AudioContext inside the click handler to satisfy autoplay policy.
  audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)()
  void audioCtx.resume()
  audioEnabled = true
  $('enableAudio').setAttribute('disabled', 'true')
  $('enableAudio').textContent = 'Audio enabled ✓'
  setStatus('Audio enabled — narration will play here.')
}

async function pump() {
  if (playing) return
  const cmd = queue.shift()
  if (!cmd) return
  playing = true
  $('nowPlaying').textContent = cmd.text
  $('transcript').textContent = ''

  try {
    if (!audioEnabled) throw new TtsError('Audio not enabled — showing text')
    const url = await synthesize(cmd.text, cmd.voiceId)
    audioEl.src = url
    audioEl.onended = () => {
      URL.revokeObjectURL(url)
      playing = false
      $('nowPlaying').textContent = ''
      void pump()
    }
    await audioEl.play()
    setStatus('Narrating…')
  } catch (e) {
    // Story 04 fallback: render the text when TTS/audio is unavailable.
    const reason = e instanceof TtsError ? e.message : (e as Error).message
    setStatus(`Text fallback (${reason})`)
    $('transcript').textContent = cmd.text
    playing = false
    void pump()
  }
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

// --- Peer context display (Story 01/02 visibility) -------------------------

const peers = new Map<string, BoardContext>()

function renderPeers() {
  const rows = [...peers.values()]
    .sort((a, b) => b.ts - a.ts)
    .map(
      (p) =>
        `<li><b>${p.name || p.userId.slice(0, 6)}</b> — ${p.visibleIds.length} items in view` +
        `${p.selectionIds.length ? `, ${p.selectionIds.length} selected` : ''}</li>`
    )
    .join('')
  $('peers').innerHTML = rows || '<li class="muted">No viewers broadcasting yet.</li>'
}

// --- Wire up UI ------------------------------------------------------------

function initUI() {
  $('enableAudio').addEventListener('click', enableAudio)
  $('skip').addEventListener('click', skip)
  $('pause').addEventListener('click', togglePause)

  const dont = $<HTMLInputElement>('dontMove')
  dont.checked = settings.dontMoveMyView
  dont.addEventListener('change', () => {
    settings.dontMoveMyView = dont.checked
  })

  const voice = $<HTMLInputElement>('voiceId')
  voice.value = settings.voiceId
  voice.addEventListener('change', () => {
    settings.voiceId = voice.value.trim()
  })

  const key = $<HTMLInputElement>('elevenKey')
  key.value = settings.elevenKey
  key.addEventListener('change', () => {
    settings.elevenKey = key.value.trim()
  })

  const name = $<HTMLInputElement>('userName')
  name.value = settings.userName
  name.addEventListener('change', () => {
    settings.userName = name.value.trim()
  })

  renderPeers()
}

const seenNarrations = new Set<string>()

function handleNarration(cmd: NarrateCommand) {
  // Dedup: two headless iframes may relay the same command.
  if (cmd.id && seenNarrations.has(cmd.id)) return
  if (cmd.id) seenNarrations.add(cmd.id)
  queue.push(cmd)
  void pump()
}

async function init() {
  initUI()

  // Narration arrives via the headless iframe's same-origin relay (the panel
  // doesn't reliably receive the cross-user realtime broadcast directly).
  const narrateRelay = new BroadcastChannel('vs-narrate')
  narrateRelay.onmessage = (e: MessageEvent) => handleNarration(e.data as NarrateCommand)

  await board.events.on(EV.boardContext, (ctx: BoardContext) => {
    peers.set(ctx.userId, ctx)
    renderPeers()
  })

  setStatus('Ready. Tap "Enable audio" to allow narration playback.')
}

void init()
export {}
