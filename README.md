# Station Report — Weather

A weather app with a real backend: an Express API that proxies and caches
upstream weather data, plus a static frontend that only ever talks to
its own origin. No API keys are ever sent to the browser.

```
weather-app/
├── src/
│   ├── server.js              # Express app: security, CORS, rate limiting, routing
│   ├── routes/
│   │   ├── weather.js         # GET /api/weather?lat=&lon=
│   │   ├── geocode.js         # GET /api/geocode?q=
│   │   ├── reverse.js         # GET /api/reverse?lat=&lon=
│   │   └── health.js          # GET /api/health
│   ├── services/
│   │   ├── weatherProvider.js # Provider abstraction (open-meteo / openweather)
│   │   └── ttlCache.js        # In-memory TTL cache
│   └── middleware/
│       ├── asyncHandler.js
│       └── errorHandler.js
├── public/                    # Static frontend (served by Express)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── package.json
├── .env.example
├── Dockerfile
└── README.md
```

## Why a backend at all

The first version of this app called Open-Meteo directly from the browser.
That works, but it isn't a real production shape:

- **No secret storage.** If you ever want a commercial provider (OpenWeather,
  Tomorrow.io, etc.) the API key has to live somewhere other than client-side
  JS. This backend keeps it in an environment variable, read only on the server.
- **No control over upstream load.** Every visitor hitting the third-party API
  directly means you can't cache, rate-limit, or swap providers without
  shipping a new frontend build.
- **No abstraction.** `src/services/weatherProvider.js` normalizes whatever
  the upstream returns into one stable shape. You can switch
  `WEATHER_PROVIDER=open-meteo` to `openweather` (or add a third provider) and
  the frontend and routes don't change at all.

## Run it locally

```bash
npm install
cp .env.example .env
npm start          # http://localhost:3000
# or, for auto-restart on file changes:
npm run dev
```

## Configuration

All configuration is via environment variables — see `.env.example` for the
full list with defaults. The important ones:

| Variable | Purpose |
|---|---|
| `WEATHER_PROVIDER` | `open-meteo` (default, no key needed) or `openweather` |
| `OPENWEATHER_API_KEY` | Required only if `WEATHER_PROVIDER=openweather` |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list |
| `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_MS` | Per-IP request budget on `/api/*` |
| `WEATHER_CACHE_TTL_SECONDS` / `GEOCODE_CACHE_TTL_SECONDS` | How long responses are cached in memory |

## API

- `GET /api/weather?lat=<num>&lon=<num>` → normalized current + hourly + daily forecast
- `GET /api/geocode?q=<string>` → `{ results: [{ name, admin1, country, latitude, longitude, ... }] }`
- `GET /api/reverse?lat=<num>&lon=<num>` → `{ name, admin1, country }`
- `GET /api/health` → `{ status, uptimeSeconds, provider, env }`

All routes validate their inputs and return structured JSON errors
(`{ "error": { "message": "..." } }`) with an appropriate HTTP status —
no stack traces or upstream internals ever reach the client.

## Production hardening already in place

- **Security headers** via `helmet`, with a `Content-Security-Policy` that
  only allows same-origin scripts/styles (plus Google Fonts).
- **Rate limiting** on `/api/*` per IP, so a burst of traffic can't exhaust
  your upstream provider's quota.
- **In-memory response caching** with sane TTLs — most repeat requests never
  hit the upstream API at all.
- **CORS allow-list** instead of `*`.
- **Structured error handling** — a single `errorHandler` middleware, no
  leaked stack traces, server-side logging of 5xx errors via `morgan`.
- **Graceful shutdown** on `SIGTERM`/`SIGINT` so in-flight requests finish
  before the process exits (important for zero-downtime deploys).
- **`trust proxy` set** so rate limiting sees the real client IP behind a
  load balancer.

## What to add before a real launch

This is a solid foundation, not a finished checklist. Depending on your
scale and requirements you'll likely also want:

- **Shared cache** (Redis) instead of in-memory, once you run more than one
  instance — otherwise each instance has its own cold cache.
- **Structured logging + monitoring** (e.g. pino + a log aggregator, plus
  metrics/alerting on error rate and upstream latency).
- **HTTPS termination** — typically handled by your platform (Render, Fly,
  Railway) or a reverse proxy (nginx/Caddy) in front of this app; the app
  itself speaks plain HTTP.
- **CI** to run linting/tests on every push before deploying.
- **A paid weather provider with an SLA** if uptime matters — the provider
  abstraction is already there for this (`WEATHER_PROVIDER=openweather`).

## Deploying

Any Node-friendly host works. Two common paths:

**Docker:**
```bash
docker build -t station-report .
docker run -p 3000:3000 --env-file .env station-report
```

**Platform-as-a-service (Render, Railway, Fly.io, etc.):** point it at this
repo, set the environment variables from `.env.example` in the dashboard,
build command `npm install`, start command `npm start`.
