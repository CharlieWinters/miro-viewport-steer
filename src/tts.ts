// ElevenLabs text-to-speech. Called from the panel (a user-gesture context),
// so audio playback is allowed. Returns an object URL for an <audio> element.
import { settings } from './shared'

const API = 'https://api.elevenlabs.io/v1/text-to-speech'

export class TtsError extends Error {}

/**
 * Synthesize `text` to speech and return a playable blob URL.
 * Throws TtsError if no key is set or the API call fails, so the caller can
 * fall back to showing the text (Story 04 acceptance criterion).
 */
export async function synthesize(text: string, voiceId?: string): Promise<string> {
  const key = settings.elevenKey
  if (!key) throw new TtsError('No ElevenLabs API key configured')
  const voice = voiceId || settings.voiceId

  let res: Response
  try {
    res = await fetch(`${API}/${voice}`, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    })
  } catch (e) {
    throw new TtsError(`Network error calling ElevenLabs: ${(e as Error).message}`)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new TtsError(`ElevenLabs ${res.status}: ${detail.slice(0, 200)}`)
  }

  const blob = await res.blob()
  return URL.createObjectURL(blob)
}
