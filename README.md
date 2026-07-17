# AI Engineering Manager

> Personal AI Engineering Manager · Tech Lead · Codebase Archaeologist

A monorepo implementing the architecture in [`plan.md`](plan.md): a Next.js 15 app
shell with an interactive Architecture Map, a streaming AI chat backed by a 5‑phase
"Token Burner" pipeline, a Tree‑sitter AST ingestion pipeline, BullMQ workers, two
Kafka microservices, and a Drizzle/pgvector data layer.

## Live only — no mock fallback

Every data path is backed by a **real implementation**; there are no fixtures. The
web app requires a configured `.env` (`DATABASE_URL` throws if absent) and runs
against real Postgres, the recursive‑CTE blast radius, NVIDIA (OpenAI‑compatible)
LLM synthesis, Elasticsearch full‑text, and GitHub OAuth — the chat trace shows a
green **`live · <model>`** badge when retrieval hits the DB. Surfaces with no data
yet render empty states rather than fabricated data.

```bash
pnpm install --filter web        # install just the web app (no native infra deps)
pnpm dev                         # http://localhost:3000  (requires .env — see below)
```

## Full local bring‑up (live mode)

Everything is configured in `.env`. The wired stack:

| Layer | Provider (in this repo's `.env`) |
|---|---|
| Postgres + pgvector | Docker, host port **55432** (avoids native PG on 5432/5433) |
| Redis | Docker, 6379 |
| Elasticsearch | Docker, 9200 |
| LLM + embeddings | **NVIDIA NIM** — `meta/llama-3.3-70b-instruct`, `baai/bge-m3` (1024‑d) |
| Kafka | **Aiven**, mTLS (`ca.pem` / `service.cert` / `service.key`) |
| Object storage | Filebase (S3‑compatible) |
| Auth | Better Auth + GitHub OAuth |

```bash
pnpm infra:up        # redis + pgvector postgres (55432) + elasticsearch
pnpm db:push         # create schema; then HNSW/trigram indexes (see packages/db)
pnpm db:seed         # ingest THIS repo's TypeScript → real AST graph in Postgres
pnpm infra:es        # create + (the seed script also bulk-loads sample) ES indices
pnpm infra:kafka     # provision Aiven topics over mTLS
pnpm auth:migrate    # create Better Auth user/session/account/verification tables
pnpm dev             # http://localhost:3000  → now fully live
```

> **GitHub sign‑in:** the GitHub App must have callback URL
> `http://localhost:3000/api/auth/callback/github` registered. Set
> `AUTH_ENFORCE=true` in `.env` to require sign‑in before `/app/*` (default: open).

Then open:

| Route | What it shows |
|---|---|
| `/` | Landing page |
| `/auth/login` → `/onboarding` | Auth + 4‑step onboarding wizard |
| `/app/dashboard` | Sprint overview, PR risk radar, activity feed |
| `/app/chat` | Streaming AI chat with live pipeline trace + retrieved context |
| `/app/map` | Interactive AST graph with one‑click **blast radius** |
| `/app/repos` | Repository indexing status |

`⌘K` / `Ctrl‑K` opens the command palette. Toggle light/dark from the top bar.

## Monorepo layout

```
apps/
  web/             Next.js 15 app (runnable centrepiece)
  kafka-webhook/   Microservice 1 — webhook ingestion → Kafka
  kafka-telemetry/ Microservice 2 — Kafka consumer → BullMQ / Elasticsearch
packages/
  db/              Drizzle schema, client, org RBAC guards (Postgres + pgvector)
  ast-parser/      Tree-sitter extraction + deterministic UUIDv5 identity
  queue/           BullMQ queues, fan-out/fan-in ingestion workers, crons
  integrations/    GitHub, Linear, Slack, Elasticsearch clients
  mastra-agents/   Token Burner pipeline, recursive-CTE blast radius, agents
  config/          Shared tsconfig base
```

The web app (`apps/web`) is self‑contained and talks to infra through its own
server modules in `apps/web/src/server/` (`db.ts`, `llm.ts`, `search.ts`,
`graph.ts`). The Kafka apps + `packages/queue` workers are the async ingestion
path for production webhooks and are run separately:

```bash
pnpm --filter @repo/queue worker     # BullMQ ingestion workers
pnpm --filter kafka-webhook dev      # webhook → Kafka producer (mTLS)
pnpm --filter kafka-telemetry dev    # Kafka consumer → BullMQ / Elasticsearch
```

## LLM provider

The pipeline uses the **OpenAI‑compatible** endpoint at `OPENAI_BASE_URL`
(NVIDIA NIM here) via `OPENAI_API_KEY`. Swap models with `LLM_MODEL` /
`EMBED_MODEL` in `.env`. To use Anthropic instead, point these at the Anthropic
SDK or set `ANTHROPIC_API_KEY` and adjust `apps/web/src/server/llm.ts`.

## Key technologies

Next.js 15 · React 19 · Tailwind CSS v4 · Framer Motion · @xyflow/react ·
Postgres + pgvector (recursive‑CTE blast radius) · Elasticsearch · NVIDIA NIM
(OpenAI‑compatible) · BullMQ + Redis · Aiven Kafka (mTLS) · Tree‑sitter ·
Better Auth + GitHub OAuth.
