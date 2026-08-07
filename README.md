# Parking Space Request Automation

A working implementation of the frozen architecture in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) (`Parking_Request_Architecture_Revised.md`):
a fork-join request lifecycle where **Payment** and **Slot Assignment** are
independent parallel tracks (BR-006), joined only by a single completion
workflow (BR-007), on top of a strict `Status` / `Approval Stage` separation
(BR-008).

The source document was written against Microsoft Lists + Power Automate,
but explicitly left the implementation platform open (Section 6: "a
Microsoft Lists capability question, not an architecture question"). This
build targets a standalone full-stack web app instead — Next.js
(TypeScript, App Router) + Prisma + SQLite — so the whole thing runs with
no external services.

## Stack

- **Next.js 14** (App Router) — server components for pages, route handlers for the API
- **Prisma + SQLite** — swap to Postgres by changing `DATABASE_URL` and the `datasource` provider in `prisma/schema.prisma` (fields are plain strings, not native enums, specifically so this swap doesn't require a schema rewrite)
- **jose + bcryptjs** — signed httpOnly session cookies, hashed passwords (no third-party auth provider)
- **zod** — request validation
- **Tailwind CSS** — styling

## Getting started

```bash
npm install
cp .env.example .env        # edit SESSION_SECRET if you want a real one
npm run db:push             # creates prisma/dev.db from schema.prisma
npm run db:seed             # seeds one demo user per role + starter rate table
npm run dev
```

Visit `http://localhost:3000`. Demo accounts (password for all: `demo1234`):

| Role | Email |
|---|---|
| Requester | `requester@parking.local` |
| Prepared By | `prepared@parking.local` |
| Validated By | `validator@parking.local` |
| Cashier | `cashier@parking.local` |
| Parking Management | `parkingmgmt@parking.local` |

Log in as **Requester** to submit a request, then walk it through the
lifecycle by logging in as each role in turn: **Prepared By** marks it ready,
**Validated By** approves it, then **Cashier** and **Parking Management**
can each act in any order — that independence is the whole point of BR-006.

## How the architecture doc maps to code

| Doc section | Code |
|---|---|
| Section 2 — Status Lifecycle | `Status` enum in `src/lib/types.ts`; no `Rejected` value, matching the doc's "Rejected is deliberately removed as a Status value" |
| Section 3 — WF01–WF06 | `src/lib/workflows.ts` — one function per workflow, each the sole writer of its documented transition |
| Section 4 — Approval Stage / `Current Owner` removal | `ApprovalStage` enum in `src/lib/types.ts`; no `currentOwner`/`currentAction` columns exist in `prisma/schema.prisma` |
| Section 5 — Data model | `prisma/schema.prisma`, `ParkingRequest` model, field-by-field per the doc's disposition table |
| Section 6 — Forms | `src/components/NewRequestForm.tsx` — one form for all Service Types, no per-type branching |
| Section 7 — Rate Table | `RateTableEntry` model (append-only) + `resolveCurrentRate()` in `src/lib/workflows.ts`, called from WF03 at the moment of approval |
| Section 8 — Audit fields | Current-value fields live on `ParkingRequest`; the append-only `RequestEvent` table is this build's substitute for Microsoft Lists' native version history (which isn't automatic outside SharePoint) |
| Section 9 — BR-001..BR-008 | Enforced in `src/lib/workflows.ts` and role checks in `src/app/api/**/route.ts`; see inline comments referencing each BR |

### Design decisions not fully pinned by the doc

- **BR-006 independence** is enforced structurally: `wf04ConfirmPayment` and
  `wf05AssignSlot` each only read/write their own track and then hand off to
  `wf06CheckCompletion` — neither ever reads the other's status directly.
- **Rate Table append-only integrity**: rather than closing out an old row's
  `effectiveEndDate` on insert (which would technically be an edit to an
  existing row), "current rate" is resolved as the newest row whose
  `effectiveStartDate` has passed. Existing rows are never written to again
  after creation.
- **Cancellation** permissions aren't specified in the doc beyond "reachable
  from any non-terminal state." This build allows the owning requester or
  any staff role to cancel, while a request is not yet `Completed` or
  `Cancelled`.

## Moving to Postgres

1. In `prisma/schema.prisma`, change `provider = "sqlite"` to `provider = "postgresql"`.
2. Set `DATABASE_URL` to a Postgres connection string.
3. Run `npx prisma db push` (or set up migrations with `npx prisma migrate dev`).

No application code changes are required — the schema deliberately avoids
SQLite-only constructs.
