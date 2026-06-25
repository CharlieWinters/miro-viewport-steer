#!/usr/bin/env node
// Synthesize narration on the Claude Code side and write it to public/audio/,
// which the dev server hosts. Prints JSON { audioUrl, file } on stdout.
//
// Usage:  node scripts/tts.mjs "text to speak" [voiceId]
//
// Key: ELEVENLABS_API_KEY env var, or a line in .env.local:
//        ELEVENLABS_API_KEY=sk_...
// Audio base URL (where the dev server is reachable by the display):
//        VS_AUDIO_BASE env var, default http://localhost:3000
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function loadKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY
  const envPath = join(ROOT, '.env.local')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*ELEVENLABS_API_KEY\s*=\s*(.+?)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '')
    }
  }
  return null
}

async function main() {
  const text = process.argv[2]
  const voiceId = process.argv[3] || process.env.VS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'
  if (!text) {
    console.error('usage: node scripts/tts.mjs "text" [voiceId]')
    process.exit(2)
  }
  const key = loadKey()
  if (!key) {
    console.error('No ElevenLabs key. Put ELEVENLABS_API_KEY in .env.local or the environment.')
    process.exit(1)
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })
  if (!res.ok) {
    console.error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`)
    process.exit(1)
  }

  const id = randomUUID()
  const outDir = join(ROOT, 'public', 'audio')
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `${id}.mp3`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))

  const base = (process.env.VS_AUDIO_BASE || 'http://localhost:3000').replace(/\/$/, '')
  console.log(JSON.stringify({ audioUrl: `${base}/audio/${id}.mp3`, file }))
}

main().catch((e) => {
  console.error(String(e))
  process.exit(1)
})
