// Panel iframe: the display's audio surface. It auto-opens when Claude wants to
// talk; the user taps "Allow" once (the gesture that unlocks audio), then
// narration plays. TTS is synthesized in the browser via ElevenLabs over https
// (CORS is open) using a RESTRICTED, credit-capped key the user pastes here —
// stored only in this browser, never in the repo. A pushed audioUrl, if present,
// is played directly and takes precedence.
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

function showConsent(show: boolean) {
  $('consent').style.display = show ? 'block' : 'none'
  $('player').style.display = show ? 'none' : 'block'
}

function allow() {
  audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)()
  void audioCtx.resume()
  audioEnabled = true
  showConsent(false)
  setStatus(settings.elevenKey ? 'Connected — narration will play here.' : 'Connected. Add an ElevenLabs key below for spoken audio.')
  void pump()
}

/** Synthesize speech in the browser using the restricted key (https, CORS-open). */
async function synth(text: string): Promise<string> {
  const key = settings.elevenKey
  if (!key) throw new Error('no key set')
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${settings.voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 150)}`)
  return URL.createObjectURL(await res.blob())
}

async function pump() {
  if (playing || !audioEnabled) return
  const cmd = queue.shift()
  if (!cmd) return
  playing = true
  $('nowPlaying').textContent = cmd.text || '(audio)'
  $('transcript').textContent = ''

  let objectUrl: string | null = null
  const done = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    playing = false
    $('nowPlaying').textContent = ''
    void pump()
  }

  try {
    let src = cmd.audioUrl
    if (!src) {
      src = await synth(cmd.text) // browser-side TTS
      objectUrl = src
    }
    audioEl.src = src
    audioEl.onended = done
    audioEl.onerror = () => {
      setStatus('Audio failed to load — showing text')
      $('transcript').textContent = cmd.text
      setTimeout(done, 1200)
    }
    await audioEl.play()
    setStatus('Narrating…')
  } catch (e) {
    // Fallback: render text when there's no key / synth fails / playback blocked.
    setStatus(`Text fallback (${(e as Error).message})`)
    $('transcript').textContent = cmd.text
    setTimeout(done, Math.min(8000, 1500 + cmd.text.length * 45))
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

const seenNarrations = new Set<string>()

function handleNarration(cmd: NarrateCommand) {
  if (cmd.id && seenNarrations.has(cmd.id)) return
  if (cmd.id) seenNarrations.add(cmd.id)
  queue.push(cmd)
  if (audioEnabled) void pump()
  else {
    showConsent(true)
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

  const key = $<HTMLInputElement>('elevenKey')
  key.value = settings.elevenKey
  key.addEventListener('change', () => {
    settings.elevenKey = key.value.trim()
  })

  const voice = $<HTMLInputElement>('voiceId')
  voice.value = settings.voiceId
  voice.addEventListener('change', () => {
    settings.voiceId = voice.value.trim()
  })

  showConsent(true)
}

async function init() {
  initUI()

  const narrateRelay = new BroadcastChannel('vs-narrate')
  narrateRelay.onmessage = (e: MessageEvent) => handleNarration(e.data as NarrateCommand)

  // Best-effort direct subscription too (deduped by id).
  await board.events.on(EV.narrate, (cmd: NarrateCommand) => handleNarration(cmd))

  setStatus('Waiting for Claude…')
}

void init()
export {}
