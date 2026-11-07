# LendLoop

> Borrow what you need. Lend what you don't.

LendLoop is a neighborhood tool-lending board. Neighbors list tools they're willing to lend, request to borrow for a date range, and approve, decline or close out loans. n8n handles the notifications and the daily overdue reminders.

**Stack:** Next.js 15 (App Router) · Clerk · Convex · n8n · TypeScript

---

## Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Local setup](#local-setup)
4. [Environment variables](#environment-variables)
5. [Roles and access control](#roles-and-access-control)
6. [n8n integration design](#n8n-integration-design)
7. [Security and data-minimization decisions](#security-and-data-minimization-decisions)
8. [Testing](#testing)
9. [What I'd change for production](#what-id-change-for-production)

---

## Features

| Area | What's there |
|---|---|
| Public page (`/`) | Tagline, a live read-only list of **available** tools (name and category only, no owner data), and a Clerk "Sign in to lend or borrow" button |
| Browse (`/tools`) | Every tool with its availability (Available, booked from X, On loan until Y, Overdue), filterable by category; request to borrow with a date range and an optional note |
| My listings (`/listings`) | Create, edit and delete your own tools (name, category, condition, description) |
| My requests (`/requests`) | Your borrow requests with status; cancel while pending |
| Incoming (`/incoming`) | Requests for your tools: approve, decline, mark returned |
| Admin (`/admin`) | All loans (filter by status), remove any listing, mark or unmark Trusted Lender, and an **Automation health** panel (failed or retrying webhooks with a Retry button, failed n8n executions) |
| Automation activity (bonus) | Each loan shows its latest automation events, e.g. "⚡ Reminder sent 2 days ago" or "⚡ Notification failed 5 min ago" |

Business rules enforced on the server:

- You can't borrow your own tool.
- Dates can't be in the past; a loan lasts at most 30 days and can be booked at most 180 days ahead.
- No overlapping approved loans. Approving a request auto-declines pending requests that overlap it, and those borrowers are notified.
- Deleting a listing cancels its open requests and notifies the borrowers. Owners can't delete a tool that's currently out.

## Architecture

```
                    ┌──────────────────────────┐
  Browser ─────────▶│ Next.js (App Router)     │  Clerk session → JWT ("convex" template)
                    │  - middleware: route gate│
                    └────────────┬─────────────┘
                                 │ Convex client (WebSocket, JWT attached)
                                 ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ Convex                                                                        │
│  queries/mutations ── requireViewer / requireAdmin / ownership checks         │
│        │  same transaction                                                    │
│        ▼                                                                      │
│  webhookDeliveries (outbox) ──scheduler──▶ webhooks.deliver (action)          │
│                                             HMAC-sign, POST, backoff retries  │
│  HTTP actions (*.convex.site), HMAC-verified:                                 │
│    GET  /n8n/overdue-loans       POST /n8n/automation-events                  │
│    POST /n8n/workflow-errors                                                  │
└──────────────┬─────────────────────────────────────────────▲──────────────────┘
               │ signed POST (N8N_WEBHOOK_SECRET)            │ signed calls (LENDLOOP_API_SECRET)
               ▼                                             │
┌───────────────────────────────────────────────────────────────────────────────┐
│ n8n                                                                           │
│  01 Loan event notifications: Webhook → verify HMAC → compose → notify (mock) │
│                               → signed write-back → 200 / 502 + fail          │
│  02 Daily overdue reminders:  Schedule 09:00 UTC → signed GET → per loan:     │
│                               remind (mock) → signed idempotent write-back    │
│  03 Error handler:            Error Trigger → scrub → signed POST to Convex   │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Repository layout

```
app/                     Next.js routes: public page + (app)/ signed-in area
components/              UI pieces (LoanList, pills, AsyncButton, Convex/Clerk provider)
convex/
  schema.ts              users, tools, loans, webhookDeliveries, automationEvents, workflowErrors
  lib/auth.ts            getViewer / requireViewer / requireAdmin — every function goes through these
  lib/hmac.ts            signing + constant-time verification (shared scheme for both directions)
  lib/outbox.ts          enqueueLoanEvent: minimal payload, written in the same transaction
  users.ts tools.ts loans.ts   public API (each function checks auth itself)
  webhooks.ts            delivery action, retry/backoff, admin health + manual retry
  automation.ts          internal: overdue query, idempotent write-backs, error log
  http.ts                n8n-facing HTTP endpoints
  seed.ts                demo data (internal only)
n8n/workflows/*.json     exported workflows (no secrets)
n8n/generate_workflows.py  source for the workflow JSON, so the embedded JS is reviewable
tests/backend.test.ts    RBAC, business rules, idempotency, HMAC, signed endpoints
docker-compose.yml       self-hosted n8n
```

## Local setup

**Prerequisites:** Node 20+, a Clerk account, a Convex account, and n8n (Cloud, or Docker for self-hosted).

### 1. App and Convex

```bash
npm install
cp .env.local.example .env.local
npx convex dev            # log in, create a project; writes CONVEX_DEPLOYMENT + NEXT_PUBLIC_CONVEX_URL
```

### 2. Clerk

1. Create a Clerk application and copy the keys into `.env.local` (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`).
2. In Clerk, go to **JWT Templates → New → Convex**. Keep the name `convex`. Make sure the claims include `name` and `email` (the Convex preset includes them).
3. Copy the template's **Issuer** URL, then:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-instance>.clerk.accounts.dev
```

### 3. Shared secrets (one per direction)

```bash
npx convex env set N8N_WEBHOOK_SECRET  "$(openssl rand -hex 32)"   # Convex → n8n
npx convex env set LENDLOOP_API_SECRET "$(openssl rand -hex 32)"   # n8n → Convex
npx convex env list   # copy the two values for the n8n step
```

### 4a. n8n Cloud

1. **Variables** (Overview → Variables), using the values from step 3:
   `LENDLOOP_N8N_WEBHOOK_SECRET`, `LENDLOOP_API_SECRET`, and `LENDLOOP_CONVEX_SITE_URL` (your `https://<deployment>.convex.site`).
   n8n Cloud blocks `$env` in Code nodes, so the workflows read `$vars` first and fall back to `$env`.
2. **Import** the three files in `n8n/workflows/` (Workflow menu → Import from file). Import `03-error-handler.json` first.
3. In each of workflows 01 and 02, check **Settings → Error workflow** is set to *LendLoop – Error handler* (re-select it if the ID changed on import).
4. **Activate** workflows 01 and 02. Don't activate 03: Error Trigger workflows run when another workflow fails, not by activation.
5. Point Convex at the production webhook URL:

```bash
npx convex env set N8N_LOAN_EVENTS_WEBHOOK_URL https://<you>.app.n8n.cloud/webhook/lendloop-loan-events
```

### 4b. Self-hosted n8n (Docker)

```bash
cp .env.n8n.example .env.n8n      # fill in the secrets from step 3 + N8N_ENCRYPTION_KEY
docker compose up -d
docker compose exec n8n n8n import:workflow --separate --input=/workflows
docker compose exec n8n n8n update:workflow --id=LendLoopLoanEvents --active=true
docker compose exec n8n n8n update:workflow --id=LendLoopOverdueReminders --active=true
docker compose restart n8n        # then create the owner account at http://localhost:5678
```

A Convex **cloud** deployment can't reach `localhost:5678`. Either use n8n Cloud, or expose n8n with a tunnel (e.g. `cloudflared tunnel --url http://localhost:5678`) and use that URL for `N8N_LOAN_EVENTS_WEBHOOK_URL`. A **local** Convex backend (`CONVEX_AGENT_MODE=anonymous npx convex dev`) can call `http://localhost:5678/...` directly. n8n reaches it at `http://host.docker.internal:3211`.

### 5. Run it

```bash
npm run dev                      # terminal 1 (convex dev keeps running in terminal 2)
npx convex run seed:demo         # optional demo tools from two fictional neighbors
```

Sign in once, then make yourself an admin. Roles are deliberately not changeable from the UI:

```bash
npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
```

### Trying the automations

- **Notification:** request a seeded tool. The n8n execution log shows `[LendLoop notify] to=p***@example.com …`, and the loan shows "⚡ Notification sent just now".
- **Overdue reminder:** `npx convex run seed:overdueLoan`, then run workflow 02 manually ("Run now (testing)"). Run it again: no second reminder is sent that day.
- **Failure path:** set `LENDLOOP_SIMULATE_FAILURE=true` (as an n8n Variable or env var) and create a request. n8n retries internally, records `failed` on the loan, and answers 502. Convex backs off and retries (10 s, 1 min, 5 min, 30 min). The error workflow logs the failed execution into Admin → Automation health. Turn the flag off, and the next retry upgrades the record to `sent`.

## Environment variables

| Where | Name | Purpose |
|---|---|---|
| Next.js `.env.local` | `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT` | Written by `npx convex dev` |
| | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk |
| Convex (`npx convex env set`) | `CLERK_JWT_ISSUER_DOMAIN` | Issuer of the Clerk `convex` JWT template |
| | `N8N_LOAN_EVENTS_WEBHOOK_URL` | n8n production webhook URL for workflow 01 |
| | `N8N_WEBHOOK_SECRET` | Signs Convex → n8n webhooks |
| | `LENDLOOP_API_SECRET` | Verifies n8n → Convex calls |
| n8n (Variables on Cloud, `.env.n8n` when self-hosted) | `LENDLOOP_N8N_WEBHOOK_SECRET` | = Convex `N8N_WEBHOOK_SECRET` |
| | `LENDLOOP_API_SECRET` | = Convex `LENDLOOP_API_SECRET` |
| | `LENDLOOP_CONVEX_SITE_URL` | `https://<deployment>.convex.site` |
| | `LENDLOOP_WEBHOOK_PATH` (optional) | Only needed if the webhook path changes |
| | `LENDLOOP_SIMULATE_FAILURE` (optional) | `true` to exercise the failure path |
| | `N8N_ENCRYPTION_KEY` (self-hosted) | Encrypts n8n credentials at rest |

Nothing secret is committed: `.env*` files are git-ignored, and the workflow JSON only contains variable *names*.

## Roles and access control

Authorization lives in Convex functions. The UI and the Next.js middleware only shape the experience.

- **Identity** comes from the Clerk JWT that Convex verifies (`convex/auth.config.ts`).
- **Role** comes from our `users` table, never from the client or Clerk public metadata. `users.store` upserts name and email but never touches `role` or `trustedLender`. Changing a role is an `internalMutation` you can only run from the CLI or dashboard.
- Every public function starts with `requireViewer`, `requireAdmin`, or an explicit ownership check (`lib/auth.ts`). Errors are typed `ConvexError({code, message})`, so the UI can show a friendly message.

| Action | user | admin |
|---|---|---|
| Create a listing | ✔ | ✔ |
| Edit a listing | own only | own only (admins moderate by removing, not by rewriting) |
| Delete or remove a listing | own only (not while on loan) | any |
| Request to borrow | not your own tool | not your own tool |
| Approve, decline, mark returned | lender of that loan only | lender of that loan only |
| Cancel a request | borrower of that loan only | borrower of that loan only |
| View loans | ones you're party to | all |
| Mark Trusted Lender | ✘ | ✔ |
| Change roles | ✘ | ✘ (CLI only) |

Admins can't approve or return on behalf of a lender. That keeps the loan agreement strictly between the two neighbors, and the admin powers limited to what the brief asks for.

## n8n integration design

### Signing (both directions)

```
X-LendLoop-Timestamp: <unix seconds>
X-LendLoop-Signature: v1=<hex HMAC-SHA256(secret, `${timestamp}.${METHOD}.${path}.${rawBody}`)>
```

- **Method and path are signed**, so a captured signature can't be replayed against another endpoint.
- **Timestamps outside ±5 minutes are rejected**, which limits replay.
- **Constant-time comparison** is used on both sides (`crypto.timingSafeEqual` in n8n, a manual XOR loop in Convex).
- **The raw body is verified.** n8n's webhook has "Raw body" enabled, so the bytes Convex signed are the bytes n8n checks.
- **Each direction has its own secret.** Leaking the n8n-side verification secret doesn't let anyone write into Convex, and the reverse holds too.
- **Rejections return a bare 401.** The reason only goes to the server log.

### Workflow 1: Loan event notifications

1. A mutation changes a loan's status and, **in the same transaction**, inserts a `webhookDeliveries` row (transactional outbox) and schedules `webhooks.deliver`. If the mutation rolls back, nothing is sent. If it commits, delivery is guaranteed to be attempted.
2. `deliver` signs the body and POSTs it with a 10 s timeout. Any non-2xx response or network error triggers exponential backoff with jitter (10 s, 1 min, 5 min, 30 min, 5 attempts). After that the row is marked `failed`, logged, and shown in Admin → Automation health with a Retry button.
3. n8n verifies the signature (401 if invalid), then **drops everything except the fields the message needs**. It composes the text per event type, sends it (a mock channel that logs a masked email, with 3 in-node retries), and writes the result back to Convex.
4. **Who gets notified:** a request or cancellation goes to the lender; approved, declined and returned go to the borrower.
5. **Response:** 200 if the notification went out. Otherwise 502, so Convex retries, and the execution is failed on purpose so the error workflow records it.

### Workflow 2: Daily overdue reminders

- A Schedule Trigger runs at 09:00 UTC. There's also a manual trigger for testing.
- A signed `GET /n8n/overdue-loans` returns approved loans past their end date, **excluding loans that already got a successful reminder today**, with only the borrower's first name and email, the tool name, the end date and days overdue.
- Each loan gets a reminder with in-node retries. The outcome goes back via `POST /n8n/automation-events` with `idempotencyKey = reminder:<loanId>:<YYYY-MM-DD>`.
- If any reminder failed, the run ends with Stop and Error, so the error workflow fires. A partial failure is never silent.

### Idempotency

- `automationEvents.idempotencyKey` is unique per logical event: `notification:<eventId>` or `reminder:<loanId>:<date>`.
- The first write inserts a row. Repeats update the same row and bump `attempts`.
- **A `sent` row is final.** A late `failed` retry can't downgrade it.
- `eventId` is deterministic (`<type>:<loanId>:<updatedAt>`), so a redelivered webhook maps to the same key.
- `workflowErrors` is keyed by n8n `executionId`.
- HTTP Request nodes retry up to 5 times. Duplicate write-backs get `200 {result:"duplicate"}`, not an error.

### Failure visibility

- **Convex side:** `webhookDeliveries.status` (`retrying` or `failed`) plus `lastError` and logs.
- **n8n side:** workflows 01 and 02 set `errorWorkflow = LendLoop – Error handler`. That workflow scrubs email addresses from the error text and signs a report to `/n8n/workflow-errors`. Failed executions are kept (`saveDataErrorExecution: all`).
- **Admin UI:** both sources show up under Admin → Automation health. Per-loan activity also shows `failed` events.

## Security and data-minimization decisions

- **Least data on every surface:**
  - Public page: tool name and category, and only for tools available now.
  - Signed-in neighbors: each other's **first name** and the Trusted Lender badge. Never emails.
  - Admins: emails, because user management needs them.
- **Webhook payloads** carry the recipient's first name and email, the actor's first name, the tool name, dates and status. No tool descriptions (which might contain things like door codes; a test asserts this), no counterpart email, no internal user IDs. n8n then strips headers and everything unused before the message step.
- **The overdue endpoint** returns only what a reminder needs, and **the n8n logs** mask emails (`p***@example.com`).
- **The error reporter** replaces email addresses with `[email]` and truncates messages before sending them to Convex.
- **Input validation:**
  - Convex validators (`v.union` literals) for enums, plus length limits and ISO date checks in mutations.
  - HTTP endpoints cap bodies at 8 KB, parse defensively, and validate every field. `normalizeId` stops arbitrary strings from becoming IDs.
- **Machine endpoints** live only on the Convex HTTP router and need HMAC. The internal functions they call aren't reachable from clients.
- **Secrets** live only in Convex env, n8n Variables or env, and git-ignored `.env*` files. The compose file binds n8n to `127.0.0.1` and sets an encryption key for n8n credentials.
- **Soft deletes** keep loan history intact for disputes and audits.
- **Security headers** are set in `next.config.ts`: `nosniff`, `DENY` framing, and a strict referrer policy. The `X-Powered-By` header is removed.

## Testing

```bash
npm test            # convex-test + vitest: 11 tests
npm run typecheck
```

The tests cover:

- Anonymous access limited to the public list.
- Ownership checks on edit, delete, approve, cancel and return.
- Admin-only functions, and that `store` can't escalate a role.
- Double-booking and auto-decline, and date validation.
- Minimal webhook payloads.
- Idempotent write-backs, including no downgrade from `sent`.
- Signed HTTP endpoints: no signature, a forged signature, and a valid one.
- HMAC tamper, path and replay checks.

I also ran everything end to end against a local Convex backend and the Docker n8n:

- A signed request created an outbox row, which was delivered, verified, notified and written back as `sent`.
- Unsigned or forged calls to n8n and Convex got 401.
- The reminder workflow ran twice and sent exactly one reminder.
- A simulated outage produced a 502 from n8n, a `retrying` outbox row, a `failed` activity entry on the loan, and a failed-execution entry in `workflowErrors`.

## What I'd change for production

1. **Real notification channels.** Replace the mock Code nodes with Send Email (SES or Postmark) and Slack nodes using n8n credentials. Add per-user notification preferences and unsubscribe links.
2. **Stronger dedupe on the n8n side.** Today a redelivered webhook can resend a notification before the write-back dedupes the record. I'd check `eventId` against Convex (or n8n's Remove Duplicates across executions) before sending.
3. **Key management.** Keep secrets in a secrets manager and rotate them. Support two active secrets during rotation (`v1=` already allows versioned signatures). Use separate keys per environment.
4. **Scale.**
   - Paginate the browse, admin and overdue queries. Today they use `take(500)`.
   - Denormalize tool availability onto the tool, or add a `loans.by_tool_status_start` index, instead of computing it per request.
   - Process overdue loans in batches.
5. **Time zones.** Store each neighborhood's time zone and compute "today" and the reminder schedule in it, instead of UTC.
6. **Observability.** Ship Convex and n8n logs to a central store. Alert when deliveries fail or when the daily reminder run doesn't happen (a dead-man's switch). Add metrics on delivery latency and retries.
7. **n8n hosting.** If self-hosted: queue mode with Postgres and Redis, workers, TLS behind a reverse proxy, SSO, and the newer task runners. Keep workflows in source control via n8n's Git integration.
8. **Abuse controls.** Rate-limit request creation per user (e.g. `@convex-dev/rate-limiter`), add a cap on open requests, and add a report-listing flow for moderation.
9. **Roles and audit.** Keep an audit log of admin actions (removals, trust changes), maybe add an admin UI for role management with a two-person rule, and sync deactivated Clerk users via Clerk webhooks.
10. **Privacy.** Data-retention jobs for old loans and automation logs, account deletion that cascades or anonymizes, and a privacy notice.
11. **Testing and CI.** Add Playwright end-to-end tests for the main flows, a CI pipeline (typecheck, tests, build), and a contract test that keeps `n8n/generate_workflows.py` and `convex/lib/hmac.ts` on the same signing scheme.
