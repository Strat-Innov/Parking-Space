# Parking Pro Inc. Request Automation

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

Visit `http://localhost:3000`. Submit a request via the public
`/requests/new` form (no login — see below), then log in as each staff role
in turn to walk it through the lifecycle. `npm run db:seed` creates one demo
account per role (password for all: `demo1234`) — type these in manually,
the login page no longer has a quick-fill list:

| Role | Email |
|---|---|
| Prepared By | `prepared@parking.local` |
| Validated By | `validator@parking.local` |
| Parking Management | `parkingmgmt@parking.local` |

See [`ACCOUNTS.md`](./ACCOUNTS.md) for how real accounts get created,
confirmed, and managed in production — self-service signup, email
invites, the Developer admin role, and multi-role login are all build-time
additions layered on top of the architecture doc's role model, not
described there.

**Prepared By** marks the request ready, **Validated By** approves it, then
**Prepared By** confirms payment and **Parking Management** assigns a slot —
independently, in any order, still the same BR-006 guarantee (see the
Cashier note below for why payment confirmation moved to Prepared By).
Requestors never log in; submission and status are handled entirely through
the public form and its guest account (see below), consistent with BR-003.

These same accounts also work the parallel **Parking Access** (RFID/Card/Metal
Tag enrollment) system — see below — the "System" selector on the login
page just picks which dashboard you land on first, it's not a separate
login.

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

## Parking Access (RFID/Card/Metal Tag enrollment)

A second, parallel request type — under the same ownership as Parking
Space, sharing its staff accounts/roles, but **not** in `ARCHITECTURE.md`
(which only describes Parking Space) and **not** the same data model or
workflow. It digitizes a different paper form, "Enrollment for Parking
ACCESS" (PPI Form2_Rev4_7), whose process is a simple linear flow rather
than Parking Space's fork-join structure:

```
Submitted -> Processed (Parking Management validates/endorses and issues
the access in one combined step) -> Completed (client confirmed receipt)
```

(or `Cancelled` from either non-terminal state). Public intake is
`/access/new` (no login, same guest-account pattern as `/requests/new` —
see `src/lib/guest.ts`, shared by both). Staff work it from
`/access/dashboard` and `/access/[id]`; only **Parking Management** has
anything to actually do (AWF02/AWF03), but every role can view it. Own
Prisma models (`AccessRequest`, `AccessRequestEvent`), own lib
(`src/lib/access-types.ts`, `access-validation.ts`, `access-workflows.ts`),
own API routes under `/api/access-requests`.

**The login/system selector is a display choice, not a permission
boundary** — the same Prepared By / Validated By / Parking Management
accounts work both systems. Picking "Parking Space" or "Parking Access" at
login (or the "Switch to..." link in the nav bar once logged in) only
decides which dashboard you land on first.

**The "APPROVED BY: Requestor's Authorized Approver Only" line is a
captured name field, not a workflow gate** — that's someone at the
*client's* company approving, and there's no login system for external
companies to actually gate on. `approverName` is optional plain text on
the intake form, informational only.

Both public forms (`/requests/new`, `/access/new`) cross-link to each other
via `RequestTypeLinks` at the top, in case someone lands on the wrong one
(e.g. the wrong QR code).

### Design decisions not fully pinned by the doc

- **Export** (`GET /api/requests/export`, build-time addition — not in the
  doc): every request detail page has its own PDF/CSV/XLSX download
  (no role/isActionable/filter scoping — if you can see the page, you can
  export it); the dashboard's "Other Requests" table additionally supports
  search (by company) and filters (Status, Service Type) client-side, with
  the same three export formats scoped to whatever's currently filtered.
  Either way the export always re-queries the DB server-side rather than
  trusting rows already in the browser. CSV is hand-rolled, XLSX uses
  `exceljs` (kept as a `serverExternalPackages` entry in `next.config.js` —
  see below).
- **PDF export is a real fillable form** (`src/lib/pdf/buildFillableForm.ts`,
  `pdf-lib`), not flattened/static text — every value sits in an actual
  AcroForm text field, editable afterward in any PDF viewer. It replicates
  the original paper "PARKING SPACE REQUEST FORM" (PPI.SOF002_Rev.1) this
  system automates — one page per request, same section layout and field
  labels — adapted where our data model doesn't carry a 1:1 equivalent: no
  Contact Number field exists in this build, the form's "Slot/s" charging
  column is relabeled "Month/s" to match this system's actual
  Hourly/Daily/Monthly service types instead of the original's separate
  concept, and the old "PPISOF.PC-####" numbering is replaced by the
  request's real `id` plus a generated-on timestamp. This replaced an
  earlier `@react-pdf/renderer` attempt that rendered correctly locally but
  500'd once deployed to Vercel (its dependency tree — a pdfkit fork,
  fontkit, a separate layout/reconciler — didn't reliably survive being
  bundled for a serverless function) — `pdf-lib` is a single small package
  with no such issue.
- **WF04 owner is Prepared By, not Cashier** — this one actively overrides
  the doc's Section 3 table (`WF04 Owner: Cashier`), a deliberate later
  decision rather than a gap the doc left open. There's no more standalone
  Cashier role or dashboard queue; `wf04ConfirmPayment` now requires
  `PREPARED_BY` and is a plain field edit (Official Receipt Reference + Pay
  Date, both directly editable) on the request's Payment Track card once
  `Status = "Approved"` — no separate action panel, no intermediate
  "Pending" step. BR-006 independence is unaffected: WF04 and WF05
  (`wf05AssignSlot`, still Parking Management) still never read each
  other's track, they're just no longer split across two different staff
  roles. The underlying `cashierId`/`cashier` column and relation names are
  unchanged (no schema migration needed) — they simply record whichever
  Prepared By staffer confirmed the payment now. `CASHIER` stays a valid
  historical value (removed from `ROLES`/`ROLE_LABELS`, blocked at login)
  purely so old `RequestEvent` rows display correctly in the Timeline.
- **BR-006 independence** is enforced structurally: `wf04ConfirmPayment` and
  `wf05AssignSlot` each only read/write their own track and then hand off to
  `wf06CheckCompletion` — neither ever reads the other's status directly.
- **Parking Location inventory** (`ParkingSpace` model, `/parking-locations`,
  build-time addition — not in the doc): the doc's `Assigned Slot` field was
  originally just free text typed in at WF05. It's now backed by a real
  space inventory that Prepared By, Validated By, and Parking Management can
  add to or remove from (unlike the Rate Table, this list isn't
  append-only — removal is a soft `isActive` flag, blocked only while a
  space has a current or upcoming booking, so past assignments keep a valid
  reference). "Assigned or not" is deliberately not a static column on a
  space; availability is derived per request by checking for any other
  non-cancelled booking whose date range overlaps the request being
  assigned (`findLockedSpaceIds` in `src/lib/workflows.ts`), so a space is
  only locked for the exact period it's actually booked. WF05's UI now
  offers only the spaces free for that request's dates, grouped so ones
  matching the requestor's `Preferred Parking Location` sort first —
  Parking Management can still pick a different available space for
  convenience if the exact preference is booked.
- **Rate Table append-only integrity**: rather than closing out an old row's
  `effectiveEndDate` on insert (which would technically be an edit to an
  existing row), "current rate" is resolved as the newest row whose
  `effectiveStartDate` has passed. Existing rows are never written to again
  after creation.
- **Cancellation** permissions aren't specified in the doc beyond "reachable
  from any non-terminal state." This build allows any staff role other than
  Prepared By to cancel (Prepared By prepares/edits or endorses a request —
  cancelling it isn't their call), while a request is not yet `Completed` or
  `Cancelled`. Requestors never log in, so there's no self-service cancel
  path — they'd need to ask staff.
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
- **Accounts, roles, and authentication are entirely build-time additions**
  — the architecture doc doesn't cover login at all. `REQUESTER` and
  `CASHIER` are the only roles the doc implies; every account-management
  feature (self-service signup with email confirmation, staff invites,
  the `DEVELOPER` admin role, multi-role login) was added afterward. Full
  writeup in [`ACCOUNTS.md`](./ACCOUNTS.md) rather than duplicated here.

## Deploying to Vercel

1. **Storage tab → Create Database** (Postgres, Neon-backed) on your Vercel project, or connect an external Postgres (Neon/Supabase) — either way you end up with a connection string.
2. **Settings → Environment Variables** on the Vercel project: add `DATABASE_URL` (that connection string) and `SESSION_SECRET` (any long random string — `openssl rand -base64 32`) for the Production environment. See [`ACCOUNTS.md`](./ACCOUNTS.md#environment-variables) for the additional email-related variables (`RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`, `ALLOWED_SIGNUP_EMAIL_DOMAINS`) needed for self-service signup and staff invites to actually send mail. Redeploy after adding any of these (env var changes don't apply to an already-running deployment).
3. From a machine with `npm`/Node, point a local `.env` at that same `DATABASE_URL` and run `npm run db:push && npm run db:seed` once, to create the tables and demo users in the production database. (Prisma connects directly over the network — this doesn't need to run inside Vercel.) Since then, every further schema change has been applied by hand as raw SQL in Neon's SQL Editor rather than re-running `db:push` — see [`ACCOUNTS.md`](./ACCOUNTS.md#schema-migration-history) for the exact statements, in order, if you need to reproduce this database from scratch.

Without step 2, every request that touches the database fails with a 500 —
there's no `DATABASE_URL` for Prisma to connect to. Without step 3, login
fails with "Internal server error" because the tables/users don't exist yet
even though the connection itself works.
