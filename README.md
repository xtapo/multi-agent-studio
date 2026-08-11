# Multi-Agent Studio

![CI](https://github.com/xtapo/multi-agent-studio/actions/workflows/ci.yml/badge.svg)

Build, connect and run teams of AI agents that collaborate on a single task.

Create specialists (Researcher, Analyst, Writer, Critic…), wire them into a graph on a
node canvas, pick an execution strategy, hit **Run**, and watch every step arrive live —
with inputs, prompts, tool calls, structured outputs, token usage, latency and cost.

---

## Highlights

- **5 execution strategies** — Sequential, Parallel, Supervisor, Router, Debate.
- **Node-based workflow builder** — React Flow canvas, agent library, per-node inspector.
- **Realtime execution viewer** — Server-Sent Events with a resumable cursor.
- **Durable runs** — optional pg-boss queue + standalone worker, so a deploy never kills a run.
- **Structured output** — JSON Schema validation with an automatic model-repair loop.
- **Sandboxed tool registry** — 6 built-in tools, permission enforced at call time.
- **Guardrails** — max steps / tool calls / tokens / cost / timeout, per run.
- **Bring your own key** — personal provider keys, AES-256-GCM encrypted, never readable back.
- **Full observability** — every agent step persisted; analytics page for cost and failure rate.
- **Provider abstraction** — OpenAI, Anthropic and any OpenAI-compatible endpoint (Ollama, vLLM, OpenRouter, Azure).
- **No chain-of-thought exposure** — only a concise reasoning summary is stored and shown.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, shadcn-style components |
| Canvas | `@xyflow/react` (React Flow 12) |
| Backend | Next.js Route Handlers, Zod validation |
| Database | PostgreSQL 16 + Prisma 5 |
| Auth | Auth.js v5 (credentials, JWT sessions) |
| Queue | pg-boss (Postgres-backed), optional |
| Realtime | Server-Sent Events over a persisted event log |
| LLM | OpenAI · Anthropic · any OpenAI-compatible server (pluggable `LLMProvider`) |
| Tests / CI | Vitest · GitHub Actions (typecheck, test, lint, build) |

---

## Getting started

### 1. Requirements

- Node.js 20+
- Docker (for Postgres) — or any Postgres 14+ instance
- An OpenAI API key, **or** a local model server (see [docs/custom-models.md](docs/custom-models.md))

### 2. Install

```bash
git clone https://github.com/xtapo/multi-agent-studio.git
cd multi-agent-studio
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Generate the two secrets and paste them into `.env`:

```bash
# AUTH_SECRET
openssl rand -base64 32

# ENCRYPTION_KEY (AES-256-GCM, 32 bytes, base64)
openssl rand -base64 32
```

Then set `OPENAI_API_KEY` (or `CUSTOM_LLM_BASE_URL`). Everything else has a working default.

### 4. Database

```bash
npm run db:up      # starts Postgres on localhost:5433 via Docker Compose
npm run db:push    # applies the Prisma schema
npm run db:seed    # demo user, tool catalogue, 5 workflow templates
```

### 5. Run

```bash
npm run dev
```

Open <http://localhost:3000> and sign in with:

```
demo@multiagent.studio / demo12345
```

Or create your own account from the sign-in screen.

For production-grade execution, set `RUN_QUEUE_ENABLED="true"` and start the worker in a
second process — see [docs/durable-runs.md](docs/durable-runs.md):

```bash
npm run worker
```

Or bring up the whole stack (Postgres + web + worker) with Docker — see
[docs/deployment.md](docs/deployment.md):

```bash
docker compose -f docker-compose.prod.yml up --build
```

---

## First run in 60 seconds

1. **Dashboard → Start from template → Research Team.**
2. The canvas opens with four wired agents. Click any node to inspect it.
3. Hit **Run**, enter a task, e.g.
   *“Compare managed Postgres options for a 500GB analytics workload and recommend one.”*
4. You land on the run page and watch each agent complete in real time.

---

## Architecture

```
User task
   ↓
Route handler  POST /api/workflows/:id/run      → returns runId immediately (202)
   ↓
Run orchestrator  src/lib/orchestration/runner.ts
   → in-process (dev)  |  pg-boss → src/worker.ts (production)
   ↓
Workflow engine  src/lib/orchestration/engine.ts
   → strategy: sequential | parallel | supervisor | router | debate
   ↓
Context builder  → only what the node's ContextPolicy allows
   ↓
Agent executor   src/lib/agents/agent-executor.ts
   → LLM provider → tool loop → JSON validation → repair → retry
   ↓
Shared state + persisted RunEvent log
   ↓
SSE  GET /api/runs/:id/events?after=<seq>  → realtime UI
```

### Key design decisions

| Decision | Why | Trade-off |
| --- | --- | --- |
| Custom orchestration instead of LangGraph | The graph semantics are ~400 readable lines; strategies stay explicit and debuggable | We maintain scheduling ourselves |
| Run returns `runId` immediately, work continues in the background | No hanging HTTP request; the UI can reconnect at any time | Needs a durable event log (we have one) |
| pg-boss instead of Redis/SQS | Runs are low-volume and expensive; Postgres is already there | Lower throughput ceiling than Redis |
| Failed runs are never auto-retried | A retry re-spends money and can duplicate tool side effects | The user must restart the run |
| User keys carried by `AsyncLocalStorage` | Credentials reach the provider layer without touching five domain signatures | Ambient state, so it must never be logged |
| SSE over WebSocket | One-directional, works through the same Route Handler, resumable via `?after=` cursor | No client→server push (not needed) |
| Events persisted before streaming | Reload or reconnect replays perfectly; no lost updates | One extra write per event |
| Per-node `ContextPolicy` | Prevents uncontrolled prompt growth and error propagation | Slightly more configuration surface |
| Full graph replace on save | Simple, transactional, no client-side diffing bugs | Larger payload per save |
| Tool permission checked in the registry, not the prompt | A model that hallucinates a tool call simply gets rejected | — |

---

## Project structure

```
prisma/
  schema.prisma            Full data model
  seed.ts                  Demo workspace + templates
src/
  worker.ts                Standalone run worker (durable execution)
  app/
    (app)/                 Authenticated shell: dashboard, agents, workflows, runs, analytics, tools, settings
    api/                   REST route handlers
    sign-in/               Auth screens
  components/
    agents/                Agent Builder
    workflows/builder/     React Flow canvas, agent library, node inspector
    runs/                  Timeline, step cards, SSE hook
    settings/              Personal API key management
    ui/                    Design-system primitives
  lib/
    agents/                Prompts, context builder, agent executor
    orchestration/         Engine, strategies, graph, budget, event bus, state, runner
    providers/             LLMProvider abstraction (OpenAI, Anthropic, custom), pricing, credential context
    tools/                 Tool registry + 6 built-in tools
    memory/                Three-tier memory store
    validation/            JSON Schema validator + Zod API contracts
    templates/             5 workflow templates
  server/
    queue/                 pg-boss instance, run queue, crash recovery
    repositories/          Prisma data access
    services/              Business logic used by routes and server components
    auth.ts                Auth.js configuration
  types/                   Domain types (agent, workflow, run, tool, llm)
docs/                      Custom models, durable runs, API keys, deployment
tests/                     Vitest unit tests
```

---

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` `POST` | `/api/agents` | List / create agents |
| `GET` `PATCH` `DELETE` | `/api/agents/:id` | Read / update / delete an agent |
| `POST` | `/api/agents/:id/duplicate` | Duplicate an agent |
| `GET` `POST` | `/api/workflows` | List / create workflows |
| `GET` `PATCH` `DELETE` | `/api/workflows/:id` | Read / update graph / delete |
| `POST` | `/api/workflows/:id/run` | Start a run → `202 { runId }` |
| `GET` | `/api/workflows/:id/validate` | Graph validation issues |
| `POST` | `/api/workflows/:id/duplicate` | Duplicate a workflow |
| `POST` | `/api/workflows/:id/save-as-template` | Save the graph as a reusable template |
| `GET` `POST` | `/api/templates` | List / instantiate templates |
| `GET` | `/api/runs` | Run history |
| `GET` `DELETE` | `/api/runs/:id` | Run detail / cancel |
| `GET` | `/api/runs/:id/events` | SSE stream (`?after=<seq>`) |
| `GET` | `/api/tools` | Tool catalogue |
| `GET` | `/api/models` | Available models per provider |
| `GET` | `/api/analytics` | Aggregated metrics (`?days=30`) |
| `GET` `POST` `DELETE` | `/api/settings/keys` | Personal provider keys (metadata only on read) |
| `GET` | `/api/health` | Unauthenticated probe; 503 when the database is down |

All routes except `/api/health` are workspace-scoped and require a session. Write routes
are rate limited.

---

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `AUTH_SECRET` | yes | `openssl rand -base64 32` |
| `AUTH_URL` | yes | `http://localhost:3000` in dev |
| `ENCRYPTION_KEY` | yes | base64 32-byte key for AES-256-GCM. **Back this up** — losing it makes stored user keys unreadable |
| `OPENAI_API_KEY` | one of | |
| `OPENAI_BASE_URL` | no | For Azure or an OpenAI-compatible gateway |
| `ANTHROPIC_API_KEY` | no | Enables Claude models |
| `CUSTOM_LLM_BASE_URL` | one of | Local / self-hosted OpenAI-compatible server — see [docs/custom-models.md](docs/custom-models.md) |
| `CUSTOM_LLM_MODELS` | no | `qwen2.5:14b=Qwen2.5 14B,llama3.1:8b` |
| `TAVILY_API_KEY` | no | Enables real web search; otherwise the tool degrades gracefully |
| `HTTP_TOOL_ALLOWED_HOSTS` | no | Allowlist for the HTTP tool (SSRF protection) |
| `MAX_AGENT_STEPS` | no | Default 20 |
| `MAX_TOOL_CALLS` | no | Default 40 |
| `MAX_RUN_TOKENS` | no | Default 200000 |
| `MAX_RUN_COST_USD` | no | Default 2 |
| `RUN_TIMEOUT_MS` | no | Default 600000 |
| `RUN_QUEUE_ENABLED` | no | `true` to execute runs in the worker process. Default `false` |
| `RUN_WORKER_CONCURRENCY` | no | Default 2 |
| `RUN_STALE_AFTER_MS` | no | Interrupted runs reaped after this long. Default 900000 |
| `RUN_CANCEL_POLL_MS` | no | Cross-process cancel poll. Default 3000 |

**Provider keys never reach the browser.** They are read server-side only; user-supplied
keys are encrypted with AES-256-GCM before hitting the database and are never returned by
any endpoint.

---

## Scripts

```bash
npm run dev          # dev server
npm run worker       # run worker (watch mode)
npm run worker:start # run worker (production)
npm run build        # prisma generate + next build
npm run start        # production server
npm run db:up        # start Postgres (Docker Compose)
npm run db:push      # sync schema
npm run db:migrate   # create a migration
npm run db:studio    # Prisma Studio
npm run db:seed      # seed demo data
npm run test         # Vitest
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
```

---

## Execution strategies

| Mode | Behaviour |
| --- | --- |
| **Sequential** | Topological order from the entry node; each agent sees the previous output. |
| **Parallel** | Independent nodes in the same layer run concurrently; a partial failure doesn't kill the layer. |
| **Supervisor** | The supervisor returns `{ action: delegate \| retry \| finish }` each round, delegates to workers, reviews results and decides when to stop (bounded by `MAX_AGENT_STEPS`). |
| **Router** | The entry router returns `{ route, reason, confidence }`; the engine follows the branch whose node `routeKey` matches. Low confidence falls back to the default branch. |
| **Debate** | Proponent → Opponent → Judge → Synthesizer, with asymmetric visibility so the opponent argues against a real position. |

---

## Safety and guardrails

- Tool calls are resolved through the registry; a call to a non-whitelisted tool is rejected before execution.
- The HTTP tool honours a host allowlist; the code executor runs in a constrained sandbox with a timeout.
- Every run carries a `BudgetTracker`: steps, tool calls, tokens, cost and wall-clock time. Exceeding any limit aborts the run cleanly with a `BUDGET_EXCEEDED` error.
- Invalid structured output triggers validate → repair prompt → retry, then marks the agent failed rather than passing malformed data downstream.
- Stored user API keys are write-only: no endpoint returns one in plaintext, not even to its owner.
- Only a short, non-sensitive reasoning summary is persisted — never raw chain-of-thought.

---

## Documentation

- [docs/custom-models.md](docs/custom-models.md) — Ollama, vLLM, LM Studio, OpenRouter, Azure.
- [docs/durable-runs.md](docs/durable-runs.md) — queue mode, the worker, crash recovery, cancellation.
- [docs/api-keys.md](docs/api-keys.md) — bring-your-own-key: storage, delivery, failure modes.
- [docs/deployment.md](docs/deployment.md) — Docker, scaling the worker, health checks, go-live checklist.

---

## Extending

**Add a model provider** — implement `LLMProvider` in `src/lib/providers/`, add pricing to
`pricing.ts`, register it in `registry.ts`. Nothing else changes.

**Add a tool** — implement `AgentTool` in `src/lib/tools/builtin/`, register it in
`registry.ts`. It appears in the Agent Builder automatically.

**Add an execution strategy** — add a file under `src/lib/orchestration/strategies/`, export
it from `STRATEGIES` in `engine.ts`, add the enum value to the Prisma schema.

**Swap the queue** — `startRunWorker` in `src/server/queue/run-queue.ts` is the only place a
BullMQ or SQS implementation has to touch.

---

## License

MIT
