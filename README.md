# HexaView — Full-Stack Financial Market Terminal

HexaView is a TradingView-inspired real-time financial market terminal featuring:
- **Live Candlestick Charting & Technical Overlays**: Multi-timeframe (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`) BTC/USDT charting with SMA 50 and **HexaScript v1** (`calculate SMA|EMA <period>`).
- **Accounts & Saved Workspaces**: Full user registration, scrypt authentication, bearer sessions, and optimistic-concurrency workspace persistence (`GET/POST/PUT/DELETE /workspaces`).
- **Always-On Price Alerts**:
  - **Cloud Backend Mode (`server/`)**: Background `AlertWorker` (`server/src/alert-worker.ts`) streams live Binance trades (`wss://data-stream.binance.vision/ws/btcusdt@aggTrade` + REST fallback), evaluates one-shot crossings via `AlertEngine` (`server/src/alert-engine.ts`), updates `price_alerts`, and writes durable notifications to `alert_outbox`.
  - **Browser Storage Fallback Mode**: Works out-of-the-box on static GitHub Pages (`localStorage`) for accounts, saved layouts, and active-tab price alerts even before a backend URL is configured, with an in-app **Configure Backend Host** switcher.

## 1. Local Full-Stack Quickstart (Docker Compose)

```bash
# Start PostgreSQL/TimescaleDB + Fastify API + Always-On AlertWorker on port 4000
docker compose up --build -d

# Start the Next.js frontend connected to localhost:4000
NEXT_PUBLIC_API_URL=http://localhost:4000 npm install
NEXT_PUBLIC_API_URL=http://localhost:4000 npm run dev
```

## 2. Deploying the Backend Host (Render or Railway)

Because GitHub Pages only hosts static files, deploy `server/` to a free or starter Node + PostgreSQL host:

- **Render (1-Click Blueprint)**:
  1. Push these updated files to `https://github.com/nore0135/HEXAVIEW`.
  2. In Render, click **New + → Blueprint** and select your `nore0135/HEXAVIEW` repository.
  3. Render automatically reads `render.yaml`, provisions the `hexaview-db` PostgreSQL database, builds `server/Dockerfile`, runs SQL migrations (`AUTO_MIGRATE=true`), and starts the API + `AlertWorker`.
- **Railway**:
  1. Create a new project from `nore0135/HEXAVIEW` with a PostgreSQL plugin.
  2. Railway reads `railway.json` and `server/Dockerfile`. Set `DATABASE_URL`, `ALLOWED_ORIGINS=https://nore0135.github.io`, and `AUTO_MIGRATE=true`.

## 3. Connecting GitHub Pages to Your Backend Host

1. Copy your deployed backend URL (e.g. `https://hexaview-api.onrender.com`).
2. In your GitHub repo (`nore0135/HEXAVIEW`), go to **Settings → Secrets and variables → Actions → Variables** and create a repository variable:
   - Name: `NEXT_PUBLIC_API_URL` (or `API_URL`)
   - Value: `https://hexaview-api.onrender.com`
3. Re-run the **Deploy HexaView to GitHub Pages** workflow (or paste the URL directly into the live site using the **Configure Backend Host** button in the top bar).

## Continuation review — 30 October 2026

The uploaded chart, browser-mode workspace/alert interface, backend switcher and hosting files are retained.

- Browser-profile password verifiers now use salted PBKDF2-SHA256 (600,000 iterations). Existing reversible verifiers are upgraded after a successful login. Profiles already signed in need to sign out and back in to upgrade. Local storage is still editable by anyone with browser access; these profiles are a device-local convenience, not secure cloud authentication.
- Alert candidates remain in an in-memory retry queue until the database transaction commits. Failed writes are logged and retried on subsequent ticks or periodic synchronization. Database-cancelled alerts do not emit successful notifications. This prevents loss during a transient database failure while the process stays alive; it does not provide crash-safe market replay.
- GitHub Actions accepts either `API_URL` (preferred) or `NEXT_PUBLIC_API_URL`.

Validation: 12 frontend unit tests, 8 backend tests, static Next.js export and backend TypeScript compilation passed. Worker tests use mocked database responses. No real-database, sustained-feed, deployment-provider or browser interaction tests were performed.

Remaining backend checks before relying on alerts: ordered exchange event IDs and gap recovery, avoiding REST/WebSocket sample ordering conflicts, durable recovery after worker restart, bounded notification backpressure, and verification that the selected host keeps the worker running. No cloud backend deployment is confirmed by this review.
