# SectorTV

Live sports streaming platform built with **SvelteKit**, **ArtPlayer**, and **hls.js**. Auto-scrapes channel lists from [xyzstreams.st](https://xyzstreams.st), resolves protected HLS sources server-side, and serves them through a clean player UI with admin controls, ads, and FIFA World Cup schedule.

**Production:** [tv.sector.web.id](https://tv.sector.web.id)

---

## Features

### Viewer

- Multi-channel live player with auto channel-hopping on failure
- HLS playback via **hls.js** (PNG-wrapped segment unwrap for TikTok CDN)
- FIFA World Cup 2026 schedule, countdown, and standby screen
- Watermark overlay (position configurable)
- Announcement modal (once / daily / always)
- Pre-roll ads, top & bottom banner slots
- Chromecast support
- Mobile-first layout with bottom navigation
- Live viewer presence counter
- Dark / light theme

### Admin (`/admin`)

- **Channel** — auto-sourced channels (enable/disable per stream) + manual channels
- **Pengaturan** — source slug, mode (auto / manual / both), watermark, announcements
- **Iklan** — pre-roll, banner top/bottom (image or embed code)
- **Statistik** — ad clicks & popular channels (requires KV)

---

## How it works

```mermaid
flowchart LR
  subgraph scrape [Auto pipeline]
    A[xyzstreams.st page] --> B[parseStreams]
    B --> C{classify}
    C -->|Server 2 direct URL| D[probe + liveCheck]
    C -->|Server 1 streamId| E[embedresolve]
    E --> F[vinix signed m3u8]
    D --> G[/live/name.m3u8]
    F --> G
  end
  subgraph play [Playback]
    G --> H[hlsproxy]
    H --> I[ArtPlayer + hls.js]
  end
  subgraph store [Persistence]
    J[(Vercel KV)] --- K[config + resolveMap + stats]
  end
  scrape --> store
  play --> store
```

### Server 1 vs Server 2

| | Server 1 | Server 2 |
|---|---|---|
| Source format | `{ type: "embed", streamId: "fox-usa" }` | `{ type: "hls", file: "https://…" }` |
| Resolution | Fetch embed page → deobfuscate JS → signed vinix URL | Direct probe / live check |
| Playback URL | `/live/fox-usa.m3u8` (proxied) | `/live/stream-N.m3u8` (proxied) |
| Referer | `player.xyzstreams.st` | xyzstreams origin |

Proxied URLs hide upstream tokens and enforce a **whitelist** — only streams discovered during scrape are resolvable (not an open proxy).

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | [SvelteKit 2](https://kit.svelte.dev/) + Svelte 5 |
| Player | [ArtPlayer 5](https://artplayer.org/) + [hls.js](https://github.com/video-dev/hls.js/) |
| Hosting | [Vercel](https://vercel.com/) (Node.js 24 runtime) |
| Storage | Vercel KV (Upstash Redis) or local `data/config.json` |
| Styling | Vanilla CSS, container queries, PWA manifest |

---

## Quick start

### Requirements

- **Node.js 24.x**
- npm

### Install & run

```bash
git clone https://github.com/your-org/sectortv.git
cd sectortv
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Admin panel: [http://localhost:5173/admin/login](http://localhost:5173/admin/login)  
Default password (change in production): `admin123`

### Build

```bash
npm run build
npm run preview
```

---

## Environment variables

Copy `.env.example` to `.env` (local) or set in Vercel project settings.

| Variable | Required | Description |
|---|---|---|
| `ADMIN_PASSWORD` | **Yes** (prod) | Admin login password |
| `ADMIN_SECRET` | Recommended | Extra entropy for session cookie signing |
| `KV_REST_API_URL` | Prod | Upstash Redis URL (auto-injected by Vercel KV integration) |
| `KV_REST_API_TOKEN` | Prod | Upstash Redis token |
| `PROXY_BASE` | Optional | Cloudflare Worker base URL for external HLS proxy |

Without KV, config and stats fall back to `data/config.json` (dev only — Vercel filesystem is ephemeral).

---

## Deploy to Vercel

1. Import the repo in [Vercel](https://vercel.com/new).
2. Add **Vercel KV** (or Upstash Redis) integration.
3. Set `ADMIN_PASSWORD` and optionally `ADMIN_SECRET`.
4. Deploy.

```bash
npx vercel deploy --prod
```

Custom domain example: `tv.sector.web.id`

---

## API

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/streams` | Public | Active channel list + ads/watermark/announcement config |
| `GET /live/[name].m3u8` | Public | Proxied HLS manifest (whitelist only) |
| `POST /api/presence` | Public | Viewer heartbeat → online count |
| `POST /api/track` | Public | Analytics beacon (channel picks, ad clicks) |
| `GET /api/admin/auto` | Admin | Full auto channel list with enable state |
| `GET /api/admin/stats` | Admin | Ad & channel statistics |

---

## Project structure

```
src/
├── routes/
│   ├── +page.svelte          # Home — player, channel list, schedule
│   ├── admin/                # Admin panel + login
│   ├── api/                  # REST endpoints
│   └── live/[name]/          # HLS manifest proxy
├── lib/
│   ├── server/
│   │   ├── auto.js           # Scrape, classify, cache pipeline
│   │   ├── embedresolve.js   # Server 1 embed → vinix URL
│   │   ├── hlsproxy.js       # Manifest/segment proxy
│   │   ├── store.js          # Config persistence
│   │   └── kv.js             # Redis client
│   ├── parse.js              # xyzstreams HTML parser
│   ├── fifa.js               # Schedule helpers
│   └── components/           # Schedule, Flag
static/                       # Favicon, watermark, PWA manifest
```

---

## Admin modes

| Mode | Behavior |
|---|---|
| `auto` | Channels from configured xyzstreams slug only |
| `manual` | Admin-added URLs only |
| `both` | Manual channels + auto channels merged |

Set the source slug in admin (e.g. `worldcup26-2-0714`) or a full event page URL.

---

## Notes

- First `/api/streams` request after cold start can take **20–40s** while streams are scraped and probed; results are cached 30s per instance.
- Auto channel disable uses a unique `disableId` (`server::file`) so duplicate channel names toggle independently.
- `resolveMap` entries are persisted to KV so `/live/*.m3u8` works across Vercel serverless instances.
- Stream content is provided by third parties; this project is a playback shell only.

---

## License

Private project. All rights reserved unless otherwise specified.
