# Deployment

## What has to run

| Process | Command | Notes |
| --- | --- | --- |
| Web | `npm run start` | Stateless, scale freely |
| Worker | `npm run worker:start` | Executes runs; needs the model API keys |
| Postgres | — | Application data **and** the pg-boss queue |

With `RUN_QUEUE_ENABLED="true"` the web tier never executes an agent, so it can
be restarted or redeployed mid-run without losing anything. See
[durable-runs.md](durable-runs.md).

## Docker

One image serves both roles — same code, different command:

```bash
export AUTH_SECRET=$(openssl rand -base64 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)
export OPENAI_API_KEY=sk-...

docker compose -f docker-compose.prod.yml up --build
```

The web container runs `prisma db push` on boot, then serves on
<http://localhost:3000>. Scale the executor independently:

```bash
docker compose -f docker-compose.prod.yml up --scale worker=3
```

Building two images would mean building the same codebase twice and keeping
them in lockstep. The cost is that the image ships devDependencies, because the
worker runs through `tsx`; at this size that is a better trade than an extra
compile step.

## Health check

`GET /api/health` — unauthenticated, leaks nothing:

```json
{ "status": "ok", "database": true, "providersConfigured": true, "queueEnabled": true, "time": "..." }
```

Returns **503** when the database is unreachable, so an orchestrator stops
routing traffic to a broken instance instead of serving error pages.

## Serverless (Vercel and friends)

The web tier deploys unchanged. The worker does **not**: it is a long-lived
process and a serverless platform will kill it. Run it on anything that keeps a
container alive (Fly, Railway, Render, ECS, a VM) pointed at the same database.

If you deploy web-only with `RUN_QUEUE_ENABLED="false"`, runs execute inside the
request process and will be cut off by the platform's function timeout. That is
fine for a demo, not for real work.

## Before going live

- [ ] `AUTH_SECRET` and `ENCRYPTION_KEY` generated with `openssl rand -base64 32` and stored in a secret manager.
- [ ] `ENCRYPTION_KEY` backed up — losing it makes every stored user API key unreadable.
- [ ] `MAX_RUN_COST_USD` set to something you are willing to pay per run.
- [ ] `HTTP_TOOL_ALLOWED_HOSTS` reviewed; empty means the HTTP tool refuses everything.
- [ ] `prisma migrate deploy` instead of `db push` once you start tracking migrations.
- [ ] Database backups enabled — run history and memory live there.

## CI

`.github/workflows/ci.yml` runs typecheck, unit tests, lint and a production
build on every push and pull request. No database is contacted: `prisma
generate` reads the schema file and the build only needs environment validation
to pass.
