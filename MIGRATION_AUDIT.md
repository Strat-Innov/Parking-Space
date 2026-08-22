# Parkspace Migration Audit — Read-Only Report

**Scope:** `Strat-Innov/Parking-Space` @ `main`
**Objective under audit:** preserve the existing Parkspace application and user
experience; migrate only the persistence/deployment layer from
Neon + Prisma + Vercel toward SharePoint + Microsoft Graph + GitHub Pages, with
the minimum necessary code changes.

**Nothing in the application was modified.** This document is the only file added.

---

## 0. Executive summary

The application is **100% server-rendered and server-authenticated**. There is no
standalone client bundle that merely talks to an API — the server *is* the app:

| Metric | Count |
|---|---|
| API route files (`src/app/api/**/route.ts`) | 38 |
| HTTP handlers across them | 43 |
| `page.tsx` files | 14 (11 server components, 3 client) |
| Client components (`"use client"`) | 31 |
| Prisma call sites (`prisma.*` / `tx.*`) | 104 |
| `prisma.$transaction` blocks | 14 (12 interactive, 2 array-form) |
| Total TS/TSX LOC (`src` + `prisma`) | ~7,450 |

The three target changes are **not** of equal difficulty:

1. **Neon → SharePoint** is a real but tractable data-layer swap. The schema is
   already SharePoint-shaped (see §7): all enums are plain strings, IDs are
   opaque, and the audit design explicitly cites Microsoft Lists version history
   as its origin.
2. **Prisma → Microsoft Graph** is mechanical for reads/writes but has **three
   hard semantic gaps**: no multi-item transactions, no relational joins, and
   list-view threshold/OData filter limits. See §5.
3. **Vercel → GitHub Pages is the blocker, and it is not a deployment change —
   it is an architecture change.** GitHub Pages serves static files only. There
   is no runtime that can hold `SESSION_SECRET`, run `bcrypt.compare`, sign a
   JWT, call Resend, or generate an Excel/PDF server-side. Adopting it means
   converting the entire app from server-rendered Next.js to a client-side SPA
   and replacing the whole authentication system. See §6 and §10.

**Recommendation before any code is written:** treat GitHub Pages as a separate,
later decision from SharePoint. The SharePoint/Graph migration can be done on
Vercel first with the UI untouched, keeping one variable moving at a time. If
GitHub Pages is a hard requirement, §10 lists the four things that must be
resolved by an architecture decision first — anonymous public intake being the
one with no static-only answer.

---

## 1. All Prisma usage

**Client construction:** `src/lib/prisma.ts` — a single global singleton
(`globalForPrisma`), the standard Next.js dev-HMR guard. One import site to
replace with a Graph-backed data layer.

**Generation:** `package.json` → `"build": "prisma generate && next build"`,
plus `db:push`, `db:seed`, `db:reset` scripts and a `prisma.seed` hook.

**41 files import Prisma**, in three distinct tiers:

| Tier | Files | What they do |
|---|---|---|
| Data/workflow layer | `src/lib/{workflows,access-workflows,auth,guest,accountDeletion,prisma}.ts` | All business-rule writes, all transactions |
| API routes | 30 of 38 route files | Thin: auth check → zod parse → workflow call → JSON |
| Server components | 8 page files (`dashboard`, `requests/[id]`, `access/[id]`, `access/dashboard`, `accounts`, `parking-locations`, `rate-table`) | **Query Prisma directly at render time** |

That third tier matters most: pages like `src/app/dashboard/page.tsx:75` call
`prisma.parkingRequest.findMany({ include: { requester: … } })` inside the React
component. There is no API layer between the UI and the database for reads —
adding one is unavoidable work in any GitHub Pages scenario.

**Operations used** (by model/method, `prisma.*` and `tx.*` combined):

- `user`: findUnique ×15, update ×10, create ×4, findMany ×2, delete ×2, upsert, findUniqueOrThrow
- `parkingRequest`: update ×12, findUniqueOrThrow ×8, findMany ×5, findUnique ×4, count ×2, findFirst ×2, create, delete
- `parkingSpace`: findMany ×5, findUnique ×3, createMany ×2, create, update, updateMany, delete, findFirst, count
- `rateTableEntry`: findMany ×2, findFirst, findUnique, create, createMany, updateMany, delete, count
- `accessRequest`: findUnique ×3, findMany ×2, update ×3, create
- `requestEvent` / `accessRequestEvent`: create, deleteMany

**No raw SQL.** `grep` for `$queryRaw` / `$executeRaw` returns nothing — every
access goes through the typed client. This is the single most favourable fact in
the repo for a Graph migration: there is no SQL to port.

**Prisma types leak into UI code.** `src/lib/dashboard.ts:1` and
`src/app/dashboard/page.tsx:9` import `type { ParkingRequest }` from
`@prisma/client`. `src/lib/workflows.ts:1` imports `Prisma` for
`Prisma.TransactionClient`. These type imports need a hand-written replacement
interface, but are otherwise free to migrate.

---

## 2. All Neon / PostgreSQL dependencies

- `prisma/schema.prisma:15` — `datasource db { provider = "postgresql", url = env("DATABASE_URL") }`
- `DATABASE_URL` is the only DB env var (`.env.example:4`)
- `@prisma/client ^5.19.1` + `prisma ^5.19.1` (dev)
- **No Neon-specific SDK** (`@neondatabase/serverless`, driver adapters, or
  pooler config) is used — it is plain Postgres over the Prisma client. Neon is
  a hosting choice, not a code dependency.

**Postgres-specific schema features** that have no direct SharePoint equivalent:

| Feature | Location | Migration note |
|---|---|---|
| `String[]` scalar array | `User.roles` | SharePoint multi-choice column, or JSON in a text column |
| `@default(cuid())` | every model | SharePoint assigns its own integer `Id`; cuid must become a stored `ExternalId` text column or be dropped (see §7) |
| `@updatedAt` | `ParkingRequest`, `AccessRequest` | SharePoint has native `Modified`; drop the column |
| `{ increment: 1 }` atomic update | `workflows.ts:263` (`rejectionCount`) | **No atomic increment in Graph** — becomes read-modify-write, needs ETag |
| `_count` aggregate select | `accountDeletion.ts:33` | No aggregate joins in Graph; becomes N filtered count queries |
| FK referential integrity | 20+ relations | **Not enforced by SharePoint lookups** — orphan prevention becomes app logic |

---

## 3. All Next.js server / API routes

All 38 route files are App Router `route.ts` handlers. Grouped by concern:

**Auth (8)** — `login` (POST), `logout` (POST), `verify-email` (GET),
`accept-invite` (POST), `invite-info` (GET), `change-password` (POST),
`resend-confirmation` (POST).

**Accounts (9)** — `accounts` (GET/POST), `signup` (POST), `invite` (POST),
`[id]/role`, `[id]/activate`, `[id]/deactivate`, `[id]/reactivate`,
`[id]/delete` (all POST).

**Parking Space requests (12)** — `requests` (GET/POST), `requests/[id]` (GET),
`[id]/prepare`, `[id]/decision`, `[id]/payment`, `[id]/slot`, `[id]/edit`,
`[id]/cancel`, `[id]/delete`, `[id]/revert-phase` (POST), `requests/export` (GET).

**Parking Access requests (5)** — `access-requests` (GET/POST),
`access-requests/[id]` (GET), `[id]/process`, `[id]/complete`, `[id]/cancel`.

**Reference data (4)** — `rate-table` (GET/POST), `rate-table/[id]/delete`,
`parking-spaces` (GET/POST), `parking-spaces/bulk`, `parking-spaces/locations`
(GET), `parking-spaces/[id]/remove`, `[id]/delete`.

Notable properties:

- **No `middleware.ts`.** Every route authorises itself by calling
  `requireSession()` / `requireRole(...)` directly. Good news: the authorisation
  rules are explicit and local, not hidden in a matcher config.
- **No route segment config anywhere** — no `export const dynamic`, `revalidate`,
  `runtime`, or `generateStaticParams`. Every page is implicitly dynamic because
  it reads cookies.
- `POST` is used for deletes and state changes throughout (not `DELETE`/`PATCH`),
  so the client-side call surface is uniform and easy to redirect.
- **Two routes do server-only heavy lifting**: `requests/export/route.ts`
  (ExcelJS workbook + `pdf-lib` fillable form, 205 lines) and
  `src/lib/pdf/buildFillableForm.ts` (210 lines).

---

## 4. All authentication mechanisms

Everything lives in `src/lib/auth.ts` (81 lines) — small, and entirely
server-dependent.

| Mechanism | Implementation | Survives static hosting? |
|---|---|---|
| Password check | `bcryptjs` `compare` against `User.passwordHash` (`auth.ts:78`) | **No** — hashes must never reach the browser |
| Session token | `jose` `SignJWT` HS256 signed with `SESSION_SECRET` (`auth.ts:26`) | **No** — a symmetric secret cannot ship in a static bundle |
| Session transport | `httpOnly`, `sameSite: lax`, `secure` cookie `parking_session`, 8h TTL (`auth.ts:33`) | **No** — `httpOnly` requires a server to set it |
| Authorisation | `requireRole(...roles)` against `session.role`, called in every route/page | Yes, logic is portable; source of truth changes |
| Multi-role login | `User.roles String[]`; login returns `{ multiRole: true, roles }` and the client re-submits with `selectedRole` (`api/auth/login/route.ts:48-64`) | Logic portable |
| Email confirmation | `crypto.randomBytes(32)` token + 24h expiry, stored on `User` (`emailVerification.ts`) | Needs a server or Power Automate |
| Staff invite | Same, 7-day TTL, `hasPassword=false` placeholder until accepted | Replaced by Entra invitation |
| Domain allowlist | `ALLOWED_SIGNUP_EMAIL_DOMAINS`, default `filinvestcity.com,parkingproinc.com` (`signup.ts`) | Replaced by tenant membership |
| Deactivation | `User.active` flag checked at login | Replaced by Entra account state |
| Anonymous intake | `resolveGuestRequesterId()` creates a `REQUESTER` row with an unusable hash (`guest.ts`) | **No** — see §10.1 |

**The whole identity system is a local user table.** Migrating to SharePoint
effectively forces Entra ID (MSAL browser auth, PKCE), because Graph calls need
an Entra token regardless. That is architecturally *better*, but it deletes or
rewrites 8 auth routes and 5 UI flows — so it is a **user-experience change**,
not just a persistence change. This is the largest single conflict with the
"preserve the existing user experience" constraint and should be an explicit,
signed-off decision rather than an implementation detail.

---

## 5. All environment variables

| Variable | Used at | Purpose | Post-migration |
|---|---|---|---|
| `DATABASE_URL` | `schema.prisma:16` | Postgres connection | **REPLACE** — SharePoint site/list IDs |
| `SESSION_SECRET` | `auth.ts:11` | HS256 session signing | **REMOVE** — Entra issues tokens |
| `RESEND_API_KEY` | `email.ts:9` | Transactional email | **REPLACE** — Power Automate / Graph `sendMail` |
| `EMAIL_FROM` | `email.ts:20` | Verified sender | Keep concept, new home |
| `ALLOWED_SIGNUP_EMAIL_DOMAINS` | `signup.ts:8` | Public signup allowlist | **REMOVE** — tenant membership |
| `APP_URL` | `url.ts:6` | Absolute base for email links | Keep (GitHub Pages URL) |
| `VERCEL_URL` | `url.ts:7` | Vercel auto-injected fallback | **REMOVE** |
| `NODE_ENV` | `auth.ts:36`, `prisma.ts:7` | cookie `secure`, HMR guard | Framework-level, no action |

**Critical constraint:** on GitHub Pages, *every* value in the bundle is public.
No client secret, no Resend key, no app-only Graph credential can exist. Only
delegated (signed-in user) Graph access is possible. This directly determines
§10.1.

---

## 6. All Vercel-specific functionality

Genuinely small — the app is not deeply coupled to Vercel:

- `src/lib/url.ts:7` — `process.env.VERCEL_URL` fallback (3 lines).
- `next.config.js:7` — `serverExternalPackages: ["exceljs"]`, a bundling
  workaround for Vercel serverless, per its own comment.
- No `vercel.json`, no `@vercel/*` package, no Edge Config, no Vercel KV/Blob,
  no cron config, no image optimisation.
- Comments in `schema.prisma:5` and `email.ts:11` reference Vercel but are prose.

**The coupling is to "a Node.js server", not to Vercel.** Moving to Azure Static
Web Apps, Azure App Service, or any Node host would be a near-zero-code change.
Only GitHub Pages — which has no server at all — forces the rewrite.

---

## 7. All database tables / models

Six models. Full column detail is in `prisma/schema.prisma`; this is the
migration-relevant shape.

### 7.1 `User` (identity + attribution)
`id, name, email @unique, passwordHash, role, roles String[], createdAt,`
`emailVerifiedAt?, emailVerificationToken? @unique, emailVerificationTokenExpiresAt?,`
`hasPassword, active` — plus **12 inbound relations** (requester, preparedBy,
validatedBy, rejectedBy, cashier, assignedBy, rate/space creator, and 5 access
relations).

Splits cleanly in two on migration: the *identity* half (password, tokens,
active, verification) → Entra ID; the *attribution* half (display name, role,
FK target) → an Entra object-ID reference on each item. Do not carry
`passwordHash` or the token columns into SharePoint.

### 7.2 `ParkingRequest` (the core entity, ~45 columns)
Sections map to the architecture spec: intake (§5), lifecycle `status` (§2),
`approvalStage` (§4), the two BR-006 parallel tracks (`paymentStatus`,
`slotStatus`), WF02–WF06 actor/date stamps, rejection audit (§8), the WF03 rate
snapshot (§7: `rateVersionId`, `rateAmountSnapshot`, `rateSnapshotDate`,
`totalPaymentDue`), and computed `totalHours/Days/Months`.

**~45 columns is close to comfortable limits for a SharePoint list view**, and
`ParkingRequest` is the list that will grow past the 5,000-item list view
threshold first. Index `Status`, `RequiredStartDate`, `EndDate`,
`ParkingSpaceId` at creation time — retrofitting an index above the threshold is
painful.

### 7.3 `RateTableEntry` (append-only)
`serviceType, chargingModel, rateAmount, effectiveStartDate, effectiveEndDate?,`
`createdById?`. **Never edited after creation** — a rate change is a new row.
"Current rate" = latest row with `effectiveStartDate <= now`
(`workflows.ts:56`). Enforce append-only in SharePoint with item-level
permissions, not just convention.

### 7.4 `ParkingSpace` (mutable inventory, soft-delete)
`location, slotNumber, isActive, createdById?`. Removal is soft so historical
assignments keep a valid pointer. Availability is **derived**, never a column —
see §8.

### 7.5 `RequestEvent` / 7.6 `AccessRequestEvent` (append-only audit)
`requestId, workflow (WF01..WF06 / AWF01..), fromStatus, toStatus, actorId,`
`note, createdAt`.

`schema.prisma:214` says it outright: *"Microsoft Lists gives native per-item
version history for free; outside SharePoint that isn't automatic, so this table
is the explicit substitute."* **Migration decision required:** keep the explicit
event lists (portable, queryable, matches the current Timeline UI exactly), or
drop them for native version history (loses the `workflow`/`note` semantics and
the Timeline component). **Recommendation: keep the event lists.** They cost two
extra lists and preserve the UI verbatim; version history is a different shape
and would force a UI rewrite for no functional gain.

### 7.7 `AccessRequest` (parallel request type, ~30 columns)
Simpler single-track lifecycle: Submitted → Processed → Completed / Cancelled.
No fork-join, no rate snapshot. Migrates the same way, with less risk.

### 7.8 Proposed Prisma → SharePoint list mapping

Presented as a **proposal for deliberate review, not something to auto-create.**

| Prisma model | SharePoint list | Key column decisions |
|---|---|---|
| `User` | *(none — Entra ID)* + optional `StaffRoles` list | Identity → Entra. `role`/`roles` → Entra security groups **or** a small `StaffRoles` list keyed by Entra object ID. A list is easier to administer in-app; groups are the tenant-standard. Pick one deliberately. |
| `ParkingRequest` | `ParkingRequests` | `ExternalId` (Text, indexed) preserves cuids; Person columns for the 6 actor FKs; Lookup → `ParkingSpaces`; Lookup → `RateTable` |
| `RateTableEntry` | `RateTable` | Append-only via item-level permissions; `EffectiveStartDate` indexed |
| `ParkingSpace` | `ParkingSpaces` | `IsActive` Yes/No; unique-ish `Location`+`SlotNumber` enforced in app code (SharePoint has no composite unique) |
| `RequestEvent` | `RequestEvents` | Lookup → `ParkingRequests`; Person → actor; append-only |
| `AccessRequest` | `AccessRequests` | Same pattern as `ParkingRequests` |
| `AccessRequestEvent` | `AccessRequestEvents` | Lookup → `AccessRequests` |

**Three mapping decisions that must be made by a human, not inferred:**

1. **Identity — Person column vs. Text object ID.** Person columns give
   pickers and profile cards for free but break for anonymous/guest requesters
   (§10.1) and complicate Graph filtering. Text object IDs are uniform but lose
   the native UX.
2. **cuid vs. SharePoint integer Id.** Keeping cuids in an `ExternalId` column
   preserves every existing URL (`/requests/<cuid>`) and makes data migration
   idempotent. Dropping them means rewriting all ID handling and losing existing
   links. **Recommendation: keep cuids.**
3. **Lookup columns vs. denormalised text.** Lookups enforce a weak relation but
   count toward the 12-lookup-per-view limit and cannot be filtered across in
   Graph the way a SQL join can. Every place the code does `include: { … }`
   (dashboard, detail pages, export) becomes a second query + client-side join
   either way.

---

## 8. All workflows that depend on the database

`src/lib/workflows.ts` (544 lines) and `src/lib/access-workflows.ts` (152 lines)
are the business core. Each workflow is one interactive transaction that reads
the item, checks status + role, writes the item, and appends an event row.

| Workflow | DB dependency | Graph migration risk |
|---|---|---|
| **WF01 Submit** (`workflows.ts:135`) | create request → event → immediate update to `In Preparation` → event | **High** — 4 writes, no transaction. Partial failure leaves an item with no routing or no audit row |
| **WF02 Prepare / Edit** (`:182`, `:216`) | read + status guard + update + event | Medium — needs ETag optimistic concurrency |
| **WF03 Decide** (`:235`) | read + **rate resolution query** + update + event | **High** — the rate snapshot must be atomic with the approval, and `resolveCurrentRate` is a `findFirst` + `orderBy desc` (`:56`) which becomes a Graph `$filter` + `$orderby` + `$top=1` on an **indexed** column or it fails above threshold |
| **WF04 Confirm Payment** (`:326`) | update + event + **calls WF06** | High — 3+ writes, cross-track |
| **WF05 Assign Slot** (`:399`) | space lookup + **overlap conflict query** + update + event + **calls WF06** | **Highest** — see below |
| **WF06 Completion** (`:303`) | re-read + conditional update + event | High — the BR-007 join point; must not double-fire |
| **DEV Revert Phase** (`:452`) | read + wide field-clearing update + event | Medium |
| **Cancel** (`workflows.ts:526`, `access-workflows.ts:138`) | read + guard + update + event | Medium |
| **AWF01/02/03 + Cancel** (`access-workflows.ts:42,82,115,138`) | same create/update + event shape | Medium |

### The two queries that need the most care

**Date-range overlap (WF05).** `findConflictingBooking` (`workflows.ts:363`) and
`findLockedSpaceIds` (`workflows.ts:384`) filter on
`parkingSpaceId` + `slotStatus = Assigned` + `status != Cancelled` +
`requiredStartDate < end` + `endDate > start`. In Graph this is a multi-clause
OData `$filter` on a large list — **every one of those columns must be indexed**,
and SharePoint restricts filtering on non-indexed columns above 5,000 items.
`findLockedSpaceIds` is called to build a dropdown, so it runs on a UI path.

**Availability is derived, not stored** (`schema.prisma:194` says so
explicitly). Do **not** let a SharePoint design "simplify" this into an
`IsAssigned` Yes/No column on `ParkingSpaces` — that would silently change the
business rule from "booked for this window" to "booked forever", which is exactly
the kind of accidental rule change this audit exists to prevent.

### Atomicity: the unavoidable gap

**SharePoint/Graph has no multi-item transaction.** All 14 `$transaction` blocks
lose their guarantee. Mitigations, in order of preference:

1. **ETag optimistic concurrency** (`If-Match` on the item update) for the
   read-check-write races — directly replaces the transaction's isolation for
   single-item guards.
2. **Write the item first, event second**, and treat a missing event as a
   recoverable audit gap rather than a corrupt state.
3. **Compensating writes** for the genuinely multi-item cases (WF01's
   create-then-route; WF04/WF05 → WF06 chains).
4. **Graph `$batch`** groups requests but is *not* transactional — do not treat
   it as one.

`rejectionCount: { increment: 1 }` (`workflows.ts:263`) has no atomic
equivalent and becomes an ETag-guarded read-modify-write.

---

## 9. All components that directly access backend APIs

31 client components make **31 `fetch()` calls**, all to same-origin `/api/*`
paths, all with `router.refresh()` on success to re-render the server component
that owns the data. Full list:

`AccountDeleteAction`, `AccountActivateAction`, `AccountDeactivateAction`,
`EditRoleAction`, `CreateAccountForm`, `InviteStaffForm`, `ChangePasswordForm`,
`DeleteRateEntryAction`, `RateTableForm`, `ParkingSpaceForm`,
`ParkingSpaceList` (×2), `DeleteRequestAction`, `CancelRequestAction`,
`RevertPhaseAction`, `RequestActions`, `RequestDetailsForm` (×3),
`PaymentConfirmForm`, `SlotAssignForm`, `DownloadMenu`,
`CancelAccessRequestAction`, `AccessCompleteForm`, `AccessProcessForm`,
`AccessRequestForm`, `UserMenu`, plus pages `login` (×2), `signup`,
`accept-invite` (×2).

**This is the good news.** Every one is the same shape:

```ts
const res = await fetch("/api/…", { method: "POST", body: JSON.stringify(…) });
if (!res.ok) { setError((await res.json()).error); return; }
router.refresh();
```

If the data layer keeps the *same* request/response contract, **all 31 call
sites can stay byte-identical** — only the module behind the URL changes. That
is the cheapest possible migration path and should be a hard design constraint
on whatever replaces the routes.

**The `router.refresh()` pattern is the catch.** It depends on server components
re-fetching. In an SPA there is no server render to refresh; each of these 31
sites needs a client-side refetch (SWR/React Query/manual state) instead. Under
"preserve the UX", this is invisible to users but touches every component.

---

## 10. Anything that prevents GitHub Pages deployment

GitHub Pages serves static files. It has no Node runtime, no request handling, no
secrets, no cookie-setting. Blockers, ordered by severity:

### 10.1 BLOCKER — Anonymous public intake has no static-only solution
`/requests/new` and `/access/new` accept submissions from people with **no
account** (`src/lib/guest.ts` creates a guest `REQUESTER` row). A static page
cannot write to SharePoint without a credential, and a static page cannot hold a
credential. Options, none free:

| Option | Cost |
|---|---|
| Power Automate HTTP-triggered flow as the write endpoint | Keeps anonymity; adds a Power Platform dependency and a URL that must be treated as a secret-bearing endpoint (SAS in query string) |
| Azure Function / Static Web Apps API proxy | Cleanest; but then you are not on GitHub Pages for this path |
| Require Entra sign-in to submit | **Changes the user experience and the business rule** — contradicts BR-003's public-submission model |

**This decision must be made before any code is written.** It determines whether
GitHub Pages is viable at all.

### 10.2 BLOCKER — 43 API handlers have no runtime
`output: 'export'` refuses to build with any `route.ts` present. All 43 must be
deleted and their logic moved into the browser (or into Power Automate flows).

### 10.3 BLOCKER — 11 server components query the database at render time
Static export cannot run `cookies()` (`auth.ts:32,43,48`) or a database query
during render. Every server page becomes a client component with a loading state.
`redirect("/login")` (10 sites) becomes client-side routing; `notFound()`
(2 sites) becomes a client 404.

### 10.4 BLOCKER — Session authentication cannot exist
`SESSION_SECRET`, `bcrypt.compare`, `SignJWT`, and the `httpOnly` cookie all
require a server (§4). Replacement is MSAL browser auth against Entra ID, with
tokens in memory/session storage — **a strictly different security model** (no
`httpOnly` protection) that should be reviewed on its own terms.

### 10.5 Dynamic routes cannot be pre-rendered
`/requests/[id]` and `/access/[id]` take arbitrary cuids. `generateStaticParams`
would have to enumerate every request at build time — impossible for live data.
These become client-side routes, and GitHub Pages needs a `404.html` SPA
fallback for deep links to work at all.

### 10.6 Project-site base path
GitHub Pages project sites serve from `https://<org>.github.io/<repo>/`, so
`basePath` + `assetPrefix` must be set (neither is configured today) — unless a
custom domain is used. Every hardcoded absolute path breaks otherwise.

### 10.7 Email cannot be sent
`RESEND_API_KEY` cannot ship in a static bundle. Confirmation, invite, and
resend flows need Power Automate or Graph `sendMail` under the signed-in user.

### 10.8 Exports — actually fine
`exceljs` and `pdf-lib` both run in the browser. The 205-line export route and
the 210-line `buildFillableForm` can move client-side largely intact, and
`next.config.js`'s `serverExternalPackages` workaround becomes unnecessary. This
is the one server-side feature that migrates cleanly.

---

## Migration classification

### KEEP — no change required
```
UI            All 31 client components; Tailwind config; globals.css;
              ThemeProvider/ThemeToggle; StatusBadge; Nav; Timeline; SettingsModal
Forms         RequestDetailsForm, AccessRequestForm, ParkingSpaceForm,
              RateTableForm, SlotAssignForm, PaymentConfirmForm, and every
              *Action component — including their fetch() call sites, IF the
              data layer preserves the request/response contract (§9)
Validation    src/lib/validation.ts, access-validation.ts (zod) — pure
Types         src/lib/types.ts, access-types.ts — enum constants, ROLE_LABELS
Rules         computeTotals, monthsBetween, validateIntakeFields (BR-001/002),
              unitsFor, isActionable (dashboard.ts), parking-date-helpers.ts
Docs          ARCHITECTURE.md is the frozen spec — the migration's correctness
              baseline, not a change target
Exports       pdf/buildFillableForm.ts, ExcelJS/CSV builders (browser-capable)
```

### MODIFY — same behaviour, new plumbing
```
Data access   Replace the prisma singleton with a Graph-backed repository that
              exposes the same call shapes; 104 call sites follow mechanically
Workflows     workflows.ts / access-workflows.ts: keep every guard, status
              check, and rule verbatim; replace $transaction with ETag
              optimistic concurrency + compensating writes (§8)
Authorization requireSession/requireRole keep their logic; the session's source
              becomes an Entra token instead of a signed cookie
Reads         The 8 server components' direct Prisma queries become explicit
              data-layer calls (a prerequisite for any SPA move)
Joins         Every `include: {…}` becomes a second query + client-side join
API contract  Keep the URL shapes and JSON error format even if the
              implementation moves — this is what protects the 31 fetch sites
url.ts        Drop VERCEL_URL; APP_URL becomes the Pages URL
```

### REPLACE — different technology, same outcome
```
Neon Postgres      → SharePoint lists (7 lists, §7.8)
Prisma client      → Microsoft Graph SDK (delegated auth only)
Prisma migrations  → Provisioned list/column definitions (PnP or scripted Graph)
prisma/seed.ts     → A seeding script writing via Graph
bcrypt + jose      → MSAL / Entra ID (PKCE, no client secret)
httpOnly cookie    → Entra token (security model change — review it)
Resend             → Power Automate or Graph sendMail
Vercel             → GitHub Pages (only after §10.1–10.4 are resolved)
RequestEvent       → Keep as lists (recommended) — native version history is a
                     different shape and would force a Timeline UI rewrite
```

### REMOVE — only what is provably unnecessary
```
process.env.VERCEL_URL fallback           url.ts:7 — proven Vercel-only
serverExternalPackages: ["exceljs"]       next.config.js:7 — a Vercel bundling
                                          workaround, per its own comment
User.passwordHash / hasPassword           only if Entra ID fully owns identity
emailVerificationToken(+ExpiresAt)        only if Entra owns verification
ALLOWED_SIGNUP_EMAIL_DOMAINS + signup.ts  only if tenant membership replaces it
SESSION_SECRET                            only once cookie sessions are gone
@updatedAt columns                        SharePoint `Modified` is native
```

**Nothing else should be removed.** In particular: do not remove the derived
availability check (§8), the append-only rate table (§7.3), the event lists
(§7.5), or the WF06 single-writer rule for `Completed` (BR-007) — each encodes a
business rule that a "simplifying" SharePoint design would silently break.

---

## Recommended sequencing

1. **Decide §10.1 (anonymous intake) and §4 (identity model).** Both change the
   user experience. Neither is an implementation detail. Nothing should be coded
   until they are settled.
2. **Extract the data layer behind an interface, still on Prisma/Vercel.** Move
   the 8 server components' direct queries behind it. Zero behaviour change,
   fully testable, and it is the prerequisite for everything after.
3. **Provision the 7 SharePoint lists** from the §7.8 mapping — reviewed
   column by column against `schema.prisma`, with the indexes from §8 created
   up front.
4. **Implement the Graph repository** behind the same interface. Run both
   implementations against the same workflow tests.
5. **Swap identity to Entra ID.** Still on Vercel, so one variable moves.
6. **Only then** evaluate GitHub Pages against §10.2–10.6 — with the knowledge
   that Azure Static Web Apps solves §10.1 and §10.7 for roughly the same
   hosting cost, and is worth reconsidering at that point.
7. **Copilot Studio** attaches to the SharePoint lists once they are the source
   of truth — it is a consumer of step 3, not a migration dependency.

---

*Read-only audit. No application code, schema, or configuration was modified.*
