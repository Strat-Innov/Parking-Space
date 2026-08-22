# Phase 0 Report — Behaviour Characterisation Tests

**Branch:** `claude/parkspace-phase0-tests` (from `main`)
**Scope:** test infrastructure only. No production code, schema, authentication,
UI, or API behaviour was modified. No repository abstraction was introduced. No
SharePoint code exists.

**Verification:** `git status src prisma` is clean. The only tracked files
changed are `package.json` (four added scripts, two added devDependencies),
`package-lock.json`, and `.gitignore` (two ignore entries).

---

## 1. Test framework selected, and why

**Vitest 2.1.9**, with `vite-tsconfig-paths`, running against **a real
PostgreSQL 16 database**.

| Decision | Reason |
|---|---|
| Vitest | The framework Next.js itself documents for this project's version — `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`. Native TypeScript and ESM, no Babel/ts-jest layer, and it starts fast enough that the suite is usable as a change-by-change safety net. |
| `vite-tsconfig-paths` | The codebase imports through the `@/*` alias defined in `tsconfig.json`. This resolves it without duplicating the mapping in a second config. |
| `environment: "node"` | These tests exercise server-side workflow and persistence code, not React components. jsdom would add cost and buy nothing. |
| **Real Postgres, not a mock or in-memory shim** | The entire point of Phase 0 is to characterise what the application *actually does*. Mocking Prisma would characterise the mock. Transaction semantics, the `String[]` array column, `{ increment: 1 }`, and foreign-key enforcement are exactly the behaviours the SharePoint migration puts at risk — all four are invisible to a mock. |
| `fileParallelism: false` | Every file shares the one database and truncates between tests. |
| Nothing mocked, anywhere | Tests call the real `submitRequest`, `wf03Decide`, `resolveGuestRequesterId`, and the real login route, through the real Prisma client. |

### Safety against destroying a real database

The suite truncates all seven tables before each test, so it has three
independent guards:

1. `TEST_DATABASE_URL` is a **different variable** from the app's
   `DATABASE_URL` and is **never defaulted** — missing means the run fails at
   config load. Verified: removing it produces
   `TEST_DATABASE_URL is not set…` and the run aborts.
2. `tests/helpers/db.ts` refuses to truncate unless the database name matches
   `/test/i`.
3. `scripts/test-db-push.mjs` applies the same check before pushing schema.

`.env.test` is gitignored, so a real connection string cannot be committed.

---

## 2. Tests created

**207 tests across 13 files**, plus three helpers and a CI workflow.

| File | Tests |
|---|---|
| `tests/workflows/wf01-submit.test.ts` | 14 |
| `tests/workflows/wf02-prepare.test.ts` | 13 |
| `tests/workflows/wf03-decide.test.ts` | 17 |
| `tests/workflows/wf04-wf05-wf06.test.ts` | 27 |
| `tests/workflows/availability.test.ts` | 12 |
| `tests/workflows/revert-and-cancel.test.ts` | 17 |
| `tests/workflows/access-workflows.test.ts` | 27 |
| `tests/lib/auth-and-login.test.ts` | 16 |
| `tests/lib/validation.test.ts` | 22 |
| `tests/lib/dashboard-actionable.test.ts` | 13 |
| `tests/lib/compute-totals.test.ts` | 12 |
| `tests/lib/account-deletion.test.ts` | 10 |
| `tests/lib/guest.test.ts` | 7 |

Supporting files: `tests/helpers/{db,setup,factories}.ts`, `tests/README.md`,
`vitest.config.mts`, `.env.test.example`, `scripts/test-db-push.mjs`,
`.github/workflows/ci.yml`.

Added scripts: `npm test`, `npm run test:watch`, `npm run test:db:push`,
`npm run typecheck`.

---

## 3. Business behaviours covered

**Parking Space workflows**
- **WF01** — creation, immediate routing to `In Preparation`, and **both**
  event rows (`Item created`, then `Routed for review`) asserted explicitly, so
  collapsing the two-step transition later is a visible failure rather than a
  silent migration side effect.
- **WF02** — Prepared By edit inside the `In Preparation` window; total
  recomputation on service-type change; endorsement to `Pending Approval` with
  `preparedById` stamped; refusal after the window closes.
- **WF03** — approval path with `Post-Approval` stage and validator stamp;
  rejection path; role and status guards.
- **WF04** — payment confirmation, receipt/pay-date/actor recording, double
  confirmation refused, and non-interference with the slot track.
- **WF05** — slot assignment, the `"<location> — <slot>"` snapshot, inactive and
  unknown space refusals, double assignment refused, non-interference with the
  payment track.
- **WF06** — completion join in **both track orders**.

**Business rules**
- **BR-001/BR-002** — no backdating; no same-day requests, including the
  calendar-day rule that rejects a start time later *today*.
- **BR-003** — `dateOfRequest` set server-side; edits anchor their date rules to
  the **original** request date, not to "now" (tested with a backdated request
  where the two answers differ).
- **BR-004** — rejection returns the **same item** to `In Preparation` /
  `Prepared By`, increments `rejectionCount` across repeated loops, records
  reason/actor/date, requires a reason, and never takes a rate snapshot.
- **BR-006** — payment and slot tracks are independent; either order completes;
  neither touches the other; one Approved request is simultaneously actionable
  for two different roles.
- **BR-007** — completion produces **exactly one** event, and it is a `WF06`
  event. A direct database query asserts **no** event with
  `toStatus = "Completed"` and `workflow != "WF06"` exists.
- **Section 2** — `Rejected` is never written as a resting `Status`.

**Rate table (Section 7)**
- Snapshot taken at WF03 approval, not at submission.
- Resolution picks the latest `effectiveStartDate <= now`; a future-dated rate
  is ignored.
- A newer rate added **after** approval does not alter the existing snapshot.
- `totalPaymentDue` = rate × units, rounded to two decimals.
- Missing rate for the service type → 409 with the specific message.
- The snapshot id and amount appear in the WF03 event note.

**Derived parking-space availability**
- Overlapping windows on one space → 409.
- Non-overlapping and exactly-adjacent windows → allowed.
- A `Cancelled` request releases the space.
- `findLockedSpaceIds` — overlap detection, `excludeRequestId`, unassigned
  requests ignored, cancelled bookings ignored, per-space not per-location.
- **The `ParkingSpace` row is never mutated by an assignment** — asserted
  directly, as the guard against a SharePoint design introducing an
  `IsAssigned` column.

**Parking Access (AWF01–AWF03 + cancel)** — submission and its single `AWF01`
event; blank optionals normalised to null; combined process step recording all
issuance fields; required series/receipt refs; completion with recipient name;
cancellation from both non-terminal states; terminal-state refusals; all event
rows.

**Developer revert** — all three revertible statuses, including that reverting
`Approved` strips the rate snapshot and both tracks while reverting `Completed`
keeps payment and slot intact; refusal from `In Preparation` and `Cancelled`;
role guard; `DEV_REVERT` event.

**Cancellation** — permitted roles, Prepared By refused, terminal states
refused, row retained for audit, `CANCEL` event records the prior status.

**Guest submissions** — first-time creation as `REQUESTER`; email lowercased;
repeat and case-insensitive reuse; unusable bcrypt password hash that matches
nothing; left unverified so it cannot log in.

**Accounts** — history breakdown counts workflow involvement; attribution-only
relations (rate/space authorship) excluded from the blocking set; multi-type
history message; attribution nulling leaves reference rows intact while deleting
the user; the database refuses to delete an account still referenced by a
request.

**Authentication (refusal paths)** — correct/incorrect password; case-insensitive
email; identical non-enumerating 401 for wrong password and unknown email;
`REQUESTER` and retired `CASHIER` refused; unconfirmed account 403 with the
`unconfirmed` flag; deactivated account 403.

**Multi-role** — the `multiRole` prompt for accounts holding several roles; that
the password is not re-requested at that step; 403 for a role the account does
not hold; `roles` defaults to `[]` and stores multiple values.

**Validation schemas** — intake and access schemas: required fields, email
format, enum membership, date coercion, quantity coercion and positivity, and
the Transfer conditional requiring both transfer fields.

**Every error assertion checks both the HTTP status and the message text**,
because both reach the user through `handleApiError`.

---

## 4. Behaviours NOT yet covered

Stated plainly, because an overstated safety net is worse than a small one.

| Not covered | Why, and what it would take |
|---|---|
| **Successful login / session creation** | `createSession()` needs `SESSION_SECRET` **and** a Next.js request scope for `cookies()`. Only the refusal branches return before that point. Needs a request-scope harness. |
| **All other API route handlers (42 of 43)** | Every one calls `requireSession()`/`requireRole()`, which read cookies. Same blocker. The workflow layer beneath them is covered instead. |
| **Server components** | The 7 pages that query Prisma at render time are `async` Server Components; Vitest does not support them (stated in the Next.js Vitest guide). Needs E2E. |
| **React components** | All 31 client components. Deliberately out of scope — Phase 1 does not touch them. |
| **Export routes** | CSV/XLSX/PDF generation (`requests/export`, `buildFillableForm`) — output-format characterisation, not data-layer behaviour. |
| **Email sending** | `email.ts`, verification/invite token issuance and consumption. Needs a Resend fake. |
| **Concurrency** | No test yet forces two simultaneous transitions on one request. **This becomes essential in Phase 3** — it is the behaviour ETag CAS must reproduce. |
| **`parking-spaces/bulk`, `locations` (`distinct`), account activate/deactivate/role routes** | Route-level, same cookie blocker. |
| **Seed script** | `prisma/seed.ts` is unexercised. |

**Coverage shape:** the domain layer — `workflows.ts`, `access-workflows.ts`,
`guest.ts`, `accountDeletion.ts`, `dashboard.ts`, `validation.ts`,
`access-validation.ts` — is well covered. That is deliberate: it is exactly the
code Phase 1 rewires and Phase 3 reimplements. The HTTP and React layers are
not, and Phase 1 does not change them.

---

## 5. Baseline test results

```
 ✓ tests/workflows/wf04-wf05-wf06.test.ts    (27 tests) 1339ms
 ✓ tests/workflows/access-workflows.test.ts  (27 tests)  769ms
 ✓ tests/workflows/wf03-decide.test.ts       (17 tests)  718ms
 ✓ tests/workflows/revert-and-cancel.test.ts (17 tests)  803ms
 ✓ tests/lib/auth-and-login.test.ts          (16 tests) 2336ms
 ✓ tests/workflows/wf01-submit.test.ts       (14 tests)  300ms
 ✓ tests/workflows/wf02-prepare.test.ts      (13 tests)  420ms
 ✓ tests/lib/dashboard-actionable.test.ts    (13 tests)  198ms
 ✓ tests/workflows/availability.test.ts      (12 tests)  766ms
 ✓ tests/lib/compute-totals.test.ts          (12 tests)  192ms
 ✓ tests/lib/validation.test.ts              (22 tests)  297ms
 ✓ tests/lib/account-deletion.test.ts        (10 tests)  313ms
 ✓ tests/lib/guest.test.ts                   ( 7 tests)  905ms

 Test Files  13 passed (13)
      Tests  207 passed (207)
   Duration  13.94s
```

`npm run typecheck` (`tsc --noEmit`) also exits 0 with the test files included.

**Zero failures. No test was weakened, skipped, or marked `todo` to get green,
and no production behaviour was adjusted to satisfy a test.** Every assertion
describes what the application already did.

One test was **removed** during development rather than left passing: a
"single-role account is not prompted for a role" case that appeared to pass but
actually did so vacuously — it reached `createSession`, got a 500, and found
`multiRole` undefined in an error body. It is replaced by a comment marking the
path as uncovered (§4).

---

## 6. Findings that conflict with MIGRATION_ARCHITECTURE.md

Four, none fatal; two need the document corrected.

### 6.1 `next lint` no longer exists — the repo's only quality script is broken
`MIGRATION_ARCHITECTURE.md` §12.4 says to run "`next lint` and `tsc --noEmit` in
CI". **`next lint` was removed in Next.js 16** (confirmed in
`node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md`:
*"Starting with Next.js 16, `next lint` is removed"*). Running `npm run lint`
today fails with `Invalid project directory provided, no such directory: …/lint`
— the CLI reads `lint` as a path.

So `"lint": "next lint"` in `package.json` has been dead since the Next 16
upgrade. **I did not fix it** — migrating to the ESLint CLI means choosing and
configuring a flat config, which is beyond "do not modify production behaviour"
and deserves its own change. The CI workflow added here runs **typecheck +
tests** only. Recommend a separate small PR for the ESLint CLI migration; a
codemod exists.

### 6.2 "API contract tests for all 43 handlers" is harder than the doc implies
§12.4 lists this as routine. In practice every handler calls
`requireSession()`/`requireRole()` → `cookies()` from `next/headers`, which
throws outside a request scope. Only branches returning *before* the session
call are reachable, which is why exactly one handler
(`POST /api/auth/login`) is partly covered and the other 42 are not at all. Route-level coverage needs a request-scope harness — a real cost that
should be planned, not assumed. The workflow layer beneath the routes is fully
covered and is what Phases 1 and 3 actually change.

### 6.3 Access cancellation is open to **all** staff roles — Parking Space's is not
`cancelRequest` refuses `PREPARED_BY`; `cancelAccessRequest` has **no role check
at all** and accepts every staff role including `PREPARED_BY`. Both behaviours
are now pinned by tests. The architecture document describes the two
cancellation paths as parallel; they are not. A repository or SharePoint
implementation that "harmonises" them would silently change permissions.

### 6.4 Guest resolution reuses **staff** accounts, not just guest rows
`resolveGuestRequesterId` finds-or-creates by email, so when a staff member
submits through the public form, the request is attributed to their existing
staff account — role and name unchanged, no `REQUESTER` row created. Pinned by
test. This makes §1.4's proposed `users.findOrCreateGuest` name misleading, and
it matters for §10: under an identity model where guests and staff come from
different sources, this single-table merge behaviour needs an explicit decision.

### Confirmed *consistent* with the architecture document
- BR-007 holds exactly as described — one `WF06` event, sole writer of
  `Completed`, verified by direct query.
- Availability is genuinely derived; the `ParkingSpace` row is never mutated by
  an assignment.
- The WF01 two-step create-then-route is real and now pinned — the decision not
  to collapse it is enforced by test.
- The rate table behaves append-only; snapshots are immune to later rate rows.
- Prisma generates cuids client-side (all created records carry cuids with no
  database default), confirming the repository layer must own generation.

---

## Recommended next step

Review this suite before Phase 1 begins. Once the boundary is introduced, these
207 tests must pass **unedited** — that is the whole safety mechanism. Any test
requiring modification during Phase 1 marks a behaviour change that needs
explicit sign-off.
