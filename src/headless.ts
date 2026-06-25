// Headless iframe: runs on every board open (it is the only iframe that
// receives icon:click). Responsibilities:
//   - open the panel when the toolbar icon is clicked
//   - broadcast this client's viewport + selection (Story 01 / 02)
//   - apply incoming steer commands to this client's viewport (Story 03)
import {
  EV,
  type Rect,
  type BoardContext,
  type SteerCommand,
  type NarrateCommand,
  settings,
  debounce,
  intersects,
  sameViewport,
} from './shared'

const board = (window as unknown as { miro: { board: any } }).miro.board

const BROADCAST_INTERVAL_MS = 500 // poll viewport at the debounce cadence
const DEFAULT_STEER_ANIMATION_MS = 800 // Story 03 acceptance criterion

let me = { id: 'unknown', name: '' }
let lastSentViewport: Rect | null = null

// Latest context broadcast by each viewer (including this client). The
// controller reads this via window.vs.contexts() to know what everyone sees.
const contexts = new Map<string, BoardContext>()

// Same-origin relay from this headless iframe to the panel (audio surface).
const narrateRelay = new BroadcastChannel('vs-narrate')

// Cache of all board items, refreshed lazily — avoids a full board.get() on
// every broadcast just to compute which items are visible.
let itemCache: Array<{ id: string } & Rect> = []
let itemCacheAt = 0
const ITEM_CACHE_TTL_MS = 5000

async function refreshItemCache(): Promise<void> {
  const now = Date.now()
  if (now - itemCacheAt < ITEM_CACHE_TTL_MS && itemCache.length) return
  try {
    const items = await board.get()
    itemCache = items
      .filter((i: any) => typeof i.x === 'number' && typeof i.width === 'number')
      .map((i: any) => ({ id: i.id, x: i.x, y: i.y, width: i.width, height: i.height }))
    itemCacheAt = now
  } catch {
    // leave the previous cache in place on transient failures
  }
}

async function buildContext(viewport: Rect): Promise<BoardContext> {
  await refreshItemCache()
  const visibleIds = itemCache.filter((i) => intersects(i, viewport)).map((i) => i.id)
  let selectionIds: string[] = []
  try {
    const sel = await board.getSelection()
    selectionIds = sel.map((i: any) => i.id)
  } catch {
    /* selection is best-effort */
  }
  return {
    userId: me.id,
    name: settings.userName || me.name,
    viewport,
    visibleIds,
    selectionIds,
    ts: Date.now(),
  }
}

const broadcastContext = debounce(async (viewport: Rect) => {
  const ctx = await buildContext(viewport)
  try {
    await board.events.broadcast(EV.boardContext, ctx)
    lastSentViewport = viewport
  } catch (e) {
    console.warn('[vs] board_context broadcast failed', e)
  }
}, BROADCAST_INTERVAL_MS)

async function pollViewport(): Promise<void> {
  try {
    const vp = (await board.viewport.get()) as Rect
    if (!sameViewport(vp, lastSentViewport)) broadcastContext(vp)
  } catch {
    /* viewport read can fail during navigation; ignore this tick */
  }
}

async function applySteer(cmd: SteerCommand): Promise<void> {
  // Per-user opt-out (Story 03 acceptance criterion).
  if (settings.dontMoveMyView) {
    console.log('[vs] steer ignored — "don\'t move my view" is on')
    return
  }
  // Targeted steer: ignore if it is not addressed to this client.
  if (cmd.targetUserId && cmd.targetUserId !== me.id) return

  // Prefer viewport.zoomTo(items) when we have itemIds — it lets Miro handle
  // framing natively, which works more reliably on interactive displays and
  // non-standard aspect ratios than manual bounding-box math + viewport.set().
  if (cmd.itemIds?.length) {
    const items: any[] = []
    for (const id of cmd.itemIds) {
      try {
        const it = await board.getById(id)
        if (it) items.push(it)
      } catch {
        /* skip missing items */
      }
    }
    if (items.length) {
      try {
        await board.viewport.zoomTo(items)
        return
      } catch (e) {
        console.warn('[vs] viewport.zoomTo failed, falling back to viewport.set', e)
      }
    }
  }

  // Fallback: explicit viewport rect (or zoomTo failed).
  const dest: Rect | null = cmd.viewport ?? null
  if (!dest) {
    console.warn('[vs] steer had no resolvable destination', cmd)
    return
  }
  try {
    await board.viewport.set({
      viewport: dest,
      padding: { top: 80, bottom: 80, left: 80, right: 80 },
      animationDurationInMs: cmd.animationDurationInMs ?? DEFAULT_STEER_ANIMATION_MS,
    })
  } catch (e) {
    console.warn('[vs] viewport.set failed', e)
  }
}

async function init(): Promise<void> {
  try {
    const info = await board.getUserInfo()
    me = { id: info.id, name: info.name ?? '' }
  } catch {
    /* anonymous fallback keeps broadcasting working */
  }

  board.ui.on('icon:click', async () => {
    await board.ui.openPanel({ url: 'app.html' })
  })

  await board.events.on(EV.steer, (cmd: SteerCommand) => {
    void applySteer(cmd)
  })

  // Track every viewer's context so the controller can query it.
  await board.events.on(EV.boardContext, (ctx: BoardContext) => {
    contexts.set(ctx.userId, ctx)
  })

  // The headless iframe is the reliable realtime receiver. The panel (the audio
  // surface) gets narrate commands cross-user unreliably, so relay them to it
  // over a same-origin BroadcastChannel. The panel dedups by command id.
  await board.events.on(EV.narrate, (cmd: NarrateCommand) => {
    // Auto-open the panel so the user sees "Claude wants to talk to you".
    void board.ui.openPanel({ url: 'app.html' }).catch(() => {})
    try {
      narrateRelay.postMessage(cmd)
    } catch (e) {
      console.warn('[vs] narrate relay failed', e)
    }
  })

  exposeControllerApi()

  // Kick off viewport broadcasting.
  void pollViewport()
  setInterval(pollViewport, BROADCAST_INTERVAL_MS)

  console.log('[vs] headless ready', me)
}

// Control surface for the operator (Claude driving this browser via
// automation). Realtime events are app-scoped, so steer/narrate MUST be
// broadcast from inside this app iframe — calling these from the host board
// console would not reach other clients of this app.
// One stop on a guided tour: optionally move the view, optionally say something,
// then dwell before the next stop.
type TourStep = {
  itemIds?: string[]
  viewport?: Rect
  text?: string
  /** Pre-synthesized clip URL (from scripts/tts.mjs). */
  audioUrl?: string
  animationDurationInMs?: number
  dwellMs?: number
}

/** Broadcast a steer with only the keys that are defined (broadcast rejects undefined). */
function sendSteer(cmd: Omit<SteerCommand, 'ts'>): Promise<void> {
  const payload: SteerCommand = { ts: Date.now() }
  if (cmd.targetUserId != null) payload.targetUserId = cmd.targetUserId
  if (cmd.viewport) payload.viewport = cmd.viewport
  if (cmd.itemIds) payload.itemIds = cmd.itemIds
  if (cmd.animationDurationInMs != null) payload.animationDurationInMs = cmd.animationDurationInMs
  return board.events.broadcast(EV.steer, payload)
}

function sendNarrate(text: string, audioUrl?: string): Promise<void> {
  const payload: NarrateCommand = { id: crypto.randomUUID(), text, ts: Date.now() }
  if (audioUrl !== undefined) payload.audioUrl = audioUrl
  return board.events.broadcast(EV.narrate, payload)
}

function exposeControllerApi() {
  ;(window as any).vs = {
    me: () => me,
    /** Latest known context per viewer: what each user has in view. */
    contexts: () => [...contexts.values()].sort((a, b) => b.ts - a.ts),
    /** Pan/zoom one viewer (or all, if targetUserId omitted) to items or a rect. */
    steer: (cmd: Omit<SteerCommand, 'ts'>) => sendSteer(cmd),
    /** Speak on the display panel. Pass a pre-synthesized audioUrl; text is the fallback/caption. */
    narrate: (text: string, audioUrl?: string) => sendNarrate(text, audioUrl),
    /**
     * Run a guided tour: for each stop, move the view (if given), narrate (if
     * given), then wait dwellMs before the next. Audio length varies, so set
     * dwellMs per stop to roughly match the narration.
     */
    tour: async (steps: TourStep[]) => {
      for (const s of steps) {
        if (s.itemIds || s.viewport) {
          await sendSteer({
            itemIds: s.itemIds,
            viewport: s.viewport,
            animationDurationInMs: s.animationDurationInMs ?? DEFAULT_STEER_ANIMATION_MS,
          })
        }
        if (s.text || s.audioUrl) await sendNarrate(s.text ?? '', s.audioUrl)
        await new Promise((r) => setTimeout(r, s.dwellMs ?? 5000))
      }
      return 'tour complete'
    },
  }
}

void init()
export {}
