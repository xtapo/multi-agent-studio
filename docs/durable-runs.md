# Durable runs

A multi-agent run is minutes long and costs real money. Losing one to a deploy
is not acceptable in production, so execution can be moved out of the web
process entirely.

## Two modes

| | `RUN_QUEUE_ENABLED=false` (default) | `RUN_QUEUE_ENABLED=true` |
| --- | --- | --- |
| Who executes | The Next.js process, fire-and-forget | `npm run worker`, a separate process |
| Survives a restart | No | Yes |
| Setup | None | One extra process |
| Good for | Local development | Production |

Both modes call the **same** `executeRun`. Only the dispatch line in
`startWorkflowRun` differs, so behaviour, events and the UI are identical.

## Enabling it

```bash
# .env
RUN_QUEUE_ENABLED="true"
RUN_WORKER_CONCURRENCY="2"
```

Two processes:

```bash
npm run dev       # terminal 1 - web
npm run worker    # terminal 2 - executor
```

In production: `npm run start` and `npm run worker:start`, scaled separately.
The worker is the process that needs the model API keys and the generous CPU
time; the web tier only reads the database.

## Why pg-boss

We already run Postgres. Workflow runs are low-volume, long-lived and
expensive — the bottleneck is model latency, not queue throughput. Adding Redis
or SQS would buy throughput we do not need and one more service to operate.
pg-boss delivers the property that matters, *the job survives a restart*, with
zero new infrastructure. It creates its own `pgboss` schema on first start; no
Prisma migration is involved.

If you later outgrow it, `startRunWorker` is the only file a BullMQ or SQS
implementation has to replace.

## Failed jobs are not retried automatically

`retryLimit: 0`, on purpose. Re-running a half-finished multi-agent job would
re-spend money on model calls and could duplicate tool side effects such as HTTP
writes. Instead the run is marked failed and the user decides. Explicit and
cheap beats automatic and surprising.

## Crash recovery

If a worker dies mid-run, its row is left `RUNNING` with nobody driving it. On
startup and then every 60s, the worker sweeps for runs that are `RUNNING` or
`QUEUED` with no `RunEvent` written for `RUN_STALE_AFTER_MS` (default 15
minutes) and closes them as failed with a clear message.

The last event is used as the liveness signal rather than `startedAt`, so a
legitimately slow run is never reaped while it is still making progress.

## Cancellation across processes

`DELETE /api/runs/:id` runs in the web process and cannot reach the worker's
in-memory `AbortSignal`. The database row is the only thing both processes
share, so an executing run polls its own status every `RUN_CANCEL_POLL_MS`
(default 3s) and aborts its `BudgetTracker` when it sees `CANCELLED`. Cancel
latency is therefore up to ~3s, which is nothing next to a single model call.

## Operational notes

- The worker prints a warning if `RUN_QUEUE_ENABLED` is false — it would
  otherwise sit idle while the web process quietly executes everything.
- A run cancelled while still queued is skipped when the worker picks it up.
- Jobs expire slightly after `RUN_TIMEOUT_MS`, so a wedged worker eventually
  releases its lock instead of holding it forever.
- Completed jobs are archived after 24h and purged after 7 days.
