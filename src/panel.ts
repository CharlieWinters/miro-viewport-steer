// Panel iframe: the display's audio surface. It auto-opens when Claude wants to
// talk; the user taps "Allow" once (consent + unlock), then narration is spoken
// using the browser's built-in Web Speech API (speechSynthesis) — no API key,
// no network, no hosting. A pushed audioUrl, if present, is played instead.
import { EV, type NarrateCommand, settings } from './shared'

const board = (window as unknown as { miro: { board: any } }).miro.board

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

let enabled = false
const audioEl = new Audio()
const queue: NarrateCommand[] = []
let playing = false

const VOICE_KEY = 'vs.webVoice'

function setStatus(msg: string) {
  $('status').textContent = msg
}

function showConsent(show: boolean) {
  $('consent').style.display = show ? 'block' : 'none'
  $('player').style.display = show ? 'none' : 'block'
}

function chosenVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices()
  const want = localStorage.getItem(VOICE_KEY)
  return voices.find((v) => v.name === want) || voices.find((v) => v.lang.startsWith('en')) || voices[0]
}

function populateVoices() {
  const sel = $<HTMLSelectElement>('voice')
  const voices = speechSynthesis.getVoices()
  if (!voices.length) return
  const current = localStorage.getItem(VOICE_KEY)
  sel.innerHTML = voices
    .map((v) => `<option value="${v.name}"${v.name === current ? ' selected' : ''}>${v.name} (${v.lang})</option>`)
    .join('')
}

function allow() {
  enabled = true
  // Unlock + prime speechSynthesis inside the user gesture.
  try {
    speechSynthesis.cancel()
  } catch {
    /* ignore */
  }
  showConsent(false)
  setStatus('Connected — narration will play here.')
  void pump()
}

function pump() {
  if (playing || !enabled) return
  const cmd = queue.shift()
  if (!cmd) return
  playing = true
  $('nowPlaying').textContent = cmd.text || '(audio)'
  $('transcript').textContent = ''

  const done = () => {
    playing = false
    $('nowPlaying').textContent = ''
    pump()
  }

  // A pushed clip URL takes precedence; otherwise speak with Web Speech.
  if (cmd.audioUrl) {
    audioEl.src = cmd.audioUrl
    audioEl.onended = done
    audioEl.onerror = () => {
      $('transcript').textContent = cmd.text
      setTimeout(done, 1200)
    }
    void audioEl.play().then(() => setStatus('Narrating…')).catch(done)
    return
  }

  if (!('speechSynthesis' in window) || !cmd.text) {
    $('transcript').textContent = cmd.text
    setTimeout(done, Math.min(8000, 1500 + cmd.text.length * 45))
    return
  }

  const u = new SpeechSynthesisUtterance(cmd.text)
  const v = chosenVoice()
  if (v) u.voice = v
  u.onend = done
  u.onerror = done
  setStatus('Narrating…')
  speechSynthesis.speak(u)
}

function skip() {
  speechSynthesis.cancel()
  audioEl.pause()
  audioEl.currentTime = 0
  playing = false
  $('nowPlaying').textContent = ''
  pump()
}

function togglePause() {
  if (speechSynthesis.speaking && !speechSynthesis.paused) speechSynthesis.pause()
  else if (speechSynthesis.paused) speechSynthesis.resume()
  else if (audioEl.src) audioEl.paused ? void audioEl.play() : audioEl.pause()
}

const seen = new Set<string>()

function handleNarration(cmd: NarrateCommand) {
  if (cmd.id && seen.has(cmd.id)) return
  if (cmd.id) seen.add(cmd.id)
  queue.push(cmd)
  if (enabled) pump()
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

  const sel = $<HTMLSelectElement>('voice')
  sel.addEventListener('change', () => localStorage.setItem(VOICE_KEY, sel.value))
  populateVoices()
  // Voices often load asynchronously.
  speechSynthesis.onvoiceschanged = populateVoices

  showConsent(true)
}

async function init() {
  initUI()

  const relay = new BroadcastChannel('vs-narrate')
  relay.onmessage = (e: MessageEvent) => handleNarration(e.data as NarrateCommand)

  // Best-effort direct subscription too (deduped by id).
  await board.events.on(EV.narrate, (cmd: NarrateCommand) => handleNarration(cmd))

  setStatus('Waiting for Claude…')
}

void init()
export {}
