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
(TypeScript, App Router) + Prisma + Postgres.

## Stack

- **Next.js 16** (App Router) — server components for pages, route handlers for the API
- **Prisma + Postgres** — fields are plain strings rather than native Prisma enums, validated in code (`src/lib/types.ts`) instead
- **jose + bcryptjs** — signed httpOnly session cookies, hashed passwords (no third-party auth provider)
- **zod** — request validation
- **Tailwind CSS** — styling

## Getting started

You need a Postgres database, even for local dev — get a free one from
[Neon](https://neon.tech), [Supabase](https://supabase.com), or Vercel's
Storage tab, or run one locally with Docker
(`docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres`).

```bash
npm install
cp .env.example .env        # set DATABASE_URL to your Postgres connection string, and SESSION_SECRET to a real random value
npm run db:push             # creates tables from schema.prisma
npm run db:seed             # seeds one demo user per role + starter rate table
npm run dev
```

Visit `http://localhost:3000`. Demo accounts (password for all: `demo1234`):

| Role | Email |
|---|---|
| Requestor | `requester@parking.local` |
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
| Section 6 — Forms | `src/components/RequestDetailsForm.tsx` — one shared form for all Service Types (used for both create and edit), no per-type branching |
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
  from any non-terminal state." This build allows the owning requestor or
  staff roles other than Prepared By to cancel (Prepared By prepares/edits
  or endorses a request — cancelling it isn't their call), while a request
  is not yet `Completed` or `Cancelled`.
- **Prepared By can edit the intake fields** the requestor submitted, while
  `Status = "In Preparation"` (`updateRequestDetails` in
  `src/lib/workflows.ts`, `POST /api/requests/[id]/edit`). This is not a
  BR-003 violation — BR-003 revokes the *requestor's* edit rights on
  submission; it says nothing about staff correcting typos or missing
  details during preparation. Locked the moment the item is endorsed for
  validation (WF02) or moves beyond, same as every other field past its
  owning stage. The Approval card (Validated By's decision fields) is
  hidden from Prepared By's view of a request — that belongs to WF03, a
  stage they hand off to, not one they need visibility into.
- **Public submission + `Full Name`**: the doc assumed an authenticated
  "Parker" submitting through Microsoft Lists (Section 5's field list has no
  personal-name field, only Company Name). Once submission needed to be a
  public, QR-code-reachable form for external companies with no account
  (`/requests/new`), a `Full Name` field was added — Company Name alone
  doesn't say who to actually contact. Anonymous submissions get a
  lightweight "guest" `User` row (found-or-created by email) with an
  unusable random password hash, purely to satisfy the `requesterId`
  foreign key — never a real login-capable account, consistent with
  BR-003's "requester loses all access on submission."

## Deploying to Vercel

1. **Storage tab → Create Database** (Postgres, Neon-backed) on your Vercel project, or connect an external Postgres (Neon/Supabase) — either way you end up with a connection string.
2. **Settings → Environment Variables** on the Vercel project: add `DATABASE_URL` (that connection string) and `SESSION_SECRET` (any long random string — `openssl rand -base64 32`) for the Production environment. Redeploy after adding them (env var changes don't apply to an already-running deployment).
3. From a machine with `npm`/Node, point a local `.env` at that same `DATABASE_URL` and run `npm run db:push && npm run db:seed` once, to create the tables and demo users in the production database. (Prisma connects directly over the network — this doesn't need to run inside Vercel.)

Without step 2, every request that touches the database fails with a 500 —
there's no `DATABASE_URL` for Prisma to connect to. Without step 3, login
fails with "Internal server error" because the tables/users don't exist yet
even though the connection itself works.
