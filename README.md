# Viewport Steer

A Miro Web SDK app that lets a remote operator (Claude, prompted via glasses/phone)
know what each viewer sees, steer a meeting-room display's viewport, and narrate
the board with audio — with no backend.

Built from the 4 user stories on board `uXjVHBmVTDU=`.

## Architecture

- **Headless iframe** (`index.html` → `src/headless.ts`) runs on every board open.
  It broadcasts this client's viewport + selection (`board_context`), applies
  incoming `steer` commands to its own viewport, and exposes a `window.vs`
  control API for the operator.
- **Panel** (`app.html` → `src/panel.ts`) is the UI + audio surface. It plays
  `narrate` commands via ElevenLabs TTS (with pause/skip and a text fallback),
  and holds settings: "don't move my view", voice id, API key, display name.
- **No backend.** All coordination rides Miro's realtime events
  (`miro.board.events.broadcast` / `.on`). Realtime events are **app-scoped** —
  see the controller note below.

### Message protocol (one realtime channel)

| event | direction | effect |
|-------|-----------|--------|
| `realtime_event:board_context` | viewer → all | publish viewport `{x,y,width,height}` + visible item ids + selection |
| `realtime_event:steer` | controller → display | `viewport.set` (800 ms animated) to a rect or items' bounding box |
| `realtime_event:narrate` | controller → display | speak text via ElevenLabs in the panel |

## How the operator (Claude) controls it

Realtime events only reach other clients **of the same app**, so the operator
cannot broadcast from the host board console. Instead, drive a browser that has
this app open on the board and call into the app iframe:

```js
// executed inside the app's headless iframe context (browser automation)
window.vs.contexts()                        // what each viewer currently sees
window.vs.steer({ itemIds: ['<frameId>'] }) // zoom the display to a frame
window.vs.steer({ viewport: { x, y, width, height } })
window.vs.narrate('Here is the architecture diagram…')
```

## Setup

1. `npm install`
2. Register the app at <https://miro.com/app/settings/user-profile/apps> → **Create new app**.
   In **App settings → App Manifest**, paste `app-manifest.yaml`, then **Install app**.
3. `npm run dev` (serves at `http://localhost:3000`; matches `sdkUri`).
4. Open a board on the dev team and click the app icon → the panel opens.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and publishes `dist/` on push to `main`.
After the first deploy, set `sdkUri` in the manifest (and the dashboard) to
`https://<user>.github.io/miro-viewport-steer/`.

> GitHub Pages hosts the app fine; the only limitation is that Pages-hosted apps
> can't be submitted to the Miro Marketplace.

## Status

- ✅ Builds, type-checks, dev server serves both entries.
- ⏳ **Not yet verified against a live board** — needs the dashboard registration
  above. The realtime broadcast plumbing (steer/narrate reaching peers) and the
  ElevenLabs playback path should be exercised on a real board before relying on
  them. The app-scoping of `window.vs` is the highest-risk assumption to confirm.
