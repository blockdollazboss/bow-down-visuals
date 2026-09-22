# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._
[credentials redacted — rotate this password in Supabase]
## User preferences

- For e2e/manual testing, reuse a single existing test account (same email/password) instead of creating a new email/password per test run.- Persistent QA test account (Supabase, email-confirmed, 500 credits): [credentials redacted — rotate this password in Supabase]. Use this for all future e2e tests instead of creating new accounts. Clean up any test projects/data created under it after each test run, but do not delete the account itself.
- Persistent QA test account (Supabase, email-confirmed, 500 credits): [credentials redacted — rotate this password in Supabase]. Use this for all future e2e tests instead of creating new accounts. Clean up any test *projects*/data created under it after each test run, but do not delete the account itself.
- For real (non-mocked) Runway clip generation smoke tests on the QA account, project `827d6f8b-98b3-4bb3-a075-50a2c687f3a7` ("QA Chain Test 1783354402234") is a small 2-scene project good for cheap end-to-end verification (2 clips = 10 credits). When browser-based `runTest()` waits are unreliable for multi-minute real generation, drive the flow directly via API (`/api/generate-runway-clip` submit+poll, `/api/generated-clips` save, `/api/projects/:id/scene-clip` attach, `PATCH /api/projects/:id` to set `approved`) using the QA account's Supabase access token instead.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
