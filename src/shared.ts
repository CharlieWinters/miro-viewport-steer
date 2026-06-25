// Shared protocol, settings, and helpers for the headless + panel iframes.
// Both iframes are the same app on the same board, so they share localStorage
// (same origin) and the realtime events channel.

export type Rect = { x: number; y: number; width: number; height: number }

// Realtime event names. NOTE: despite the `realtime_event:`/`experimental:`
// prefixes in the SDK type definitions, the runtime `events.on()` rejects any
// name containing a colon ("invalid custom event at name") and only accepts a
// plain, prefix-free name. (Verified empirically against the live SDK.)
export const EV = {
  /** A viewer publishes its own viewport + selection so the controller knows what each user sees. */
  boardContext: 'board_context',
  /** Controller -> display: pan/zoom to a rect or set of items. */
  steer: 'steer',
  /** Controller -> display: speak this text via ElevenLabs TTS. */
  narrate: 'narrate',
} as const

export type BoardContext = {
  userId: string
  name?: string
  viewport: Rect
  visibleIds: string[]
  selectionIds: string[]
  ts: number
}

export type SteerCommand = {
  /** Target a single user by id, or null/omit to steer every client. */
  targetUserId?: string | null
  /** Explicit destination rect. Takes precedence over itemIds. */
  viewport?: Rect
  /** Frame/item ids to focus; their bounding box becomes the destination. */
  itemIds?: string[]
  animationDurationInMs?: number
  ts: number
}

export type NarrateCommand = {
  id: string
  text: string
  /** ElevenLabs voice id; falls back to the receiver's configured voice. */
  voiceId?: string
  ts: number
}

// --- Settings (localStorage, shared across both iframes on this origin) ---

const KEYS = {
  dontMoveMyView: 'vs.dontMoveMyView',
  voiceId: 'vs.voiceId',
  elevenKey: 'vs.elevenKey',
  userName: 'vs.userName',
} as const

export const settings = {
  get dontMoveMyView(): boolean {
    return localStorage.getItem(KEYS.dontMoveMyView) === '1'
  },
  set dontMoveMyView(v: boolean) {
    localStorage.setItem(KEYS.dontMoveMyView, v ? '1' : '0')
  },
  get voiceId(): string {
    return localStorage.getItem(KEYS.voiceId) || DEFAULT_VOICE_ID
  },
  set voiceId(v: string) {
    localStorage.setItem(KEYS.voiceId, v)
  },
  get elevenKey(): string {
    return localStorage.getItem(KEYS.elevenKey) || ''
  },
  set elevenKey(v: string) {
    localStorage.setItem(KEYS.elevenKey, v)
  },
  get userName(): string {
    return localStorage.getItem(KEYS.userName) || ''
  },
  set userName(v: string) {
    localStorage.setItem(KEYS.userName, v)
  },
}

// ElevenLabs "Rachel" — a sensible default voice.
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'

/** Trailing debounce: fire `fn` once activity stops for `ms`. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

/** Bounding box of several rects, or null if empty. */
export function boundingBox(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x - r.width / 2)
    minY = Math.min(minY, r.y - r.height / 2)
    maxX = Math.max(maxX, r.x + r.width / 2)
    maxY = Math.max(maxY, r.y + r.height / 2)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Do two rects (center-anchored items vs. top-left viewport) overlap? */
export function intersects(item: Rect, viewport: Rect): boolean {
  const left = item.x - item.width / 2
  const right = item.x + item.width / 2
  const top = item.y - item.height / 2
  const bottom = item.y + item.height / 2
  return (
    right >= viewport.x &&
    left <= viewport.x + viewport.width &&
    bottom >= viewport.y &&
    top <= viewport.y + viewport.height
  )
}

/** Are two viewports effectively the same (sub-pixel + zoom tolerant)? */
export function sameViewport(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return false
  const eps = 1
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.height - b.height) < eps
  )
}
