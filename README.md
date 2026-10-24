# TradeWise

TradeWise is a paper-trading simulator. All balances and trades are virtual; it does not connect to a broker or place real orders. The local quote feed is synthetic and exists for development and learning.

## Requirements

- Node.js 20.19 or newer and npm
- Docker Compose for the local PostgreSQL and MinIO services

## Local setup

```powershell
Copy-Item .env.server.example .env
Copy-Item .env.client.example client/.env
docker compose up -d
npm install
npm run migrate:up
```

```powershell
npm run dev
```

Open <http://localhost:5173>. The API listens on port 3000, the synthetic feed on 4000, PostgreSQL on 5432, and MinIO on 9000 (console: 9001). The API creates its upload bucket when it starts, so wait for MinIO to become ready first.

The scaffold uses npm workspaces (`shared/`, `server/`, and `client/`). Root scripts include `dev`, `build`, `test`, `lint`, `seed`, `repl`, `migrate:up`, and `migrate:down`. Migration 002 adds accounts, instruments, candles, fills, ledger, events, risk, and watchlist tables while preserving existing API tables and data. `npm run migrate:down` rolls back one migration and drops its new trading-domain tables. Set `SEED_EMAIL`, `SEED_DISPLAY_NAME`, and `SEED_PASSWORD` in `.env` before running `npm run seed`; the command creates one regular local account and preserves credentials if that email already exists.

New accounts receive **100,000,000 paise (₹1,000,000)** in virtual cash. Local credentials in `.env.server.example` are for development only; set a unique `JWT_SECRET` and service credentials before deployment. Keep `.env` out of version control.

## Useful commands

```powershell
npm run typecheck
npm test
npm run build
Invoke-RestMethod http://localhost:3000/api/v1/health
```

Use `npm run migrate:up` to apply pending migrations and `npm run migrate:down` to revert the latest migration.

Interactive API documentation is at <http://localhost:3000/api/docs>.

## API

- `GET /api/v1/health`
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/auth/me/avatar` (JPEG, PNG, or WebP; 2 MB maximum; stored in MinIO)
- `GET /api/quotes` and `GET /api/quotes/ws`
- `GET /api/wallet`, `GET /api/portfolio`
- `POST /api/orders`, `GET /api/orders`, `GET /api/trades`
- `GET /api/admin/users` (admin role only)

Administrators also see a read-only user directory in the dashboard, backed by this endpoint.

Authenticated endpoints require a bearer token in the `Authorization` header. Requests and responses use Zod schemas exported from `shared/`. Order execution is a pure TypeScript matching function; PostgreSQL transactions lock and update the wallet/position together with the order and trade records. Paise values remain safe integers in application code and are stored as `NUMERIC(20,0)` in PostgreSQL.

The synthetic feed exposes quotes over HTTP and WebSocket at port 4000. API clients can subscribe to its validated updates at `/api/quotes/ws`. No market prices are embedded in the React client.
