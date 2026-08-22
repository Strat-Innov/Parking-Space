# Phase 1 Report — Repository Abstraction (Prisma only)

**Branch:** `claude/parkspace-phase1-repository` (from `claude/parkspace-phase0-tests`)
**Scope:** introduce the data-access boundary. Prisma remains the active — and
only — implementation. No SharePoint code exists.

**Result: 222 tests pass. The 207 Phase 0 contract tests are byte-identical —
not one was edited.**

---

## 1. Final test count

| | |
|---|---|
| Phase 0 contract tests | **207 — all passing, all unedited** |
| New repository tests | **15** |
| **Total** | **222 passing, 14 files, ~16s** |

`git diff claude/parkspace-phase0-tests -- tests/` reports **no changes**; the
only addition is the new `tests/data/` directory. The contract held without
negotiation.

`npm run typecheck` exits 0. `npm run build` succeeds, and every route still
reports as `ƒ (Dynamic) server-rendered on demand`, exactly as before.

### The 15 new tests, and why they exist

Phase 1 moved the transaction boundary out of the workflow functions and into
the repository. **The 207 behavioural tests cannot see that boundary** — from a
caller's side, a rollback and a rejected precondition look identical. So the new
tests assert at the database level that a failed transition leaves nothing
behind:

- A plan that throws writes neither the field change nor an event.
- **A committed update is rolled back when the event append fails** (forced with
  an FK violation on `actorId`).
- **A failing `andThen` step rolls back the first step too** — this is exactly
  what WF04 → WF06 and WF05 → WF06 depend on.
- `create` + failing `andThen` leaves no request and no events at all.
- The atomic numeric delta increments rather than overwriting.
- `TransitionReads` rate resolution and conflict detection, including
  `excludeRequestId`.
- `deleteWithEvents` / `deleteWithAttributionCleared` remove or null out
  everything together, and leave the account intact when they cannot complete.
- `resolveRequesterForSubmission` reuses a staff account and creates a
  `REQUESTER` row otherwise.

**These tests were verified to be non-vacuous.** Temporarily removing
`prisma.$transaction` from `transition` makes exactly the two rollback tests
fail and no others. A test that cannot fail proves nothing, so it was checked
rather than assumed.

The same discipline covers the hand-written domain types: `type-parity.ts`
asserts at compile time that every domain type still matches the Prisma model
field-for-field. Changing `rejectionCount` to `string` was confirmed to break
`tsc`. Without it, a drifted type would lie while every test still passed.

---

## 2. Every production file changed

**39 modified, 5 added, 1,094 lines of new data layer.**

### Added — `src/lib/data/`
| File | Lines | Purpose |
|---|---|---|
| `types.ts` | 326 | Hand-written domain records, hydrated projections, write inputs |
| `repositories.ts` | 216 | The interfaces, the transition primitive, `TransitionReads` |
| `prisma-repositories.ts` | 477 | The only file in the app that issues Prisma queries |
| `type-parity.ts` | 53 | Compile-time proof the domain types match the schema |
| `index.ts` | 22 | `repos` — the single entry point |

### Modified — library layer (6)
`workflows.ts` (rewritten against the primitive), `access-workflows.ts`
(rewritten), `guest.ts`, `accountDeletion.ts`, `auth.ts` (one call),
`dashboard.ts` (type import only).

### Modified — API routes (26)
All of `api/accounts/*` (9), `api/auth/*` (5), `api/parking-spaces/*` (5),
`api/rate-table/*` (2), `api/requests/*` (3), `api/access-requests/*` (2).

### Modified — server components (7)
`dashboard`, `requests/[id]`, `access/[id]`, `access/dashboard`, `accounts`,
`rate-table`, `parking-locations`.

### Untouched, verified by diff
- **`src/components/` — all 31 client components: zero changes.**
- **`prisma/schema.prisma` — zero changes.** `prisma/seed.ts` — zero changes.
- **`package.json` — zero changes. No dependency added or removed.**
- `src/lib/{types,validation,access-validation,access-types,email,url,password,signup,emailVerification,api-helpers}.ts`, `src/lib/pdf/*` — untouched.

---

## 3. Every remaining direct Prisma call site

**Application code: none.** `grep` for `prisma.*`, `@prisma/client`, and
`@/lib/prisma` across `src/` returns nothing outside the two files below.

| Location | Why it remains |
|---|---|
| `src/lib/data/prisma-repositories.ts` | **This is the implementation.** Every Prisma query in the application lives here, which is the point of the phase. Phase 3 adds a sibling file; this one stays as the fallback. |
| `src/lib/prisma.ts` | The `PrismaClient` singleton with its dev-HMR guard. Consumed only by the repository implementation. Unchanged. |
| `src/lib/data/type-parity.ts` | A **type-only** import of the generated models, for the compile-time parity check. No runtime code, no queries. |
| `prisma/seed.ts` | A standalone dev script, not part of the application runtime. Out of Phase 1's scope; it would be migrated or replaced alongside the Phase 4 data migration. |
| `tests/**` (25 call sites) | **Deliberate.** The tests verify results *below* the abstraction — asserting on the database directly is what makes them a check on the repository rather than a restatement of it. Migrating them to `repos` would weaken them into tautologies. |

---

## 4. No SharePoint dependencies

Confirmed by grep for `sharepoint`, `microsoft-graph`, `msal`, `@azure`,
`graph.microsoft` across `src/` and `package.json`:

- **Zero packages added.** `package.json` is byte-identical to Phase 0.
- **Zero SharePoint code.** The only matches are comments explaining what the
  boundary is *for*, plus a pre-existing comment in `Timeline.tsx`.
- No env var, config, or client for Graph exists.
- `repos` resolves to `prismaRepositories` unconditionally — there is no
  backend switch yet, because there is nothing to switch to.

---

## 5. UI and API contracts unchanged

**UI:** all 31 client components untouched. The 7 server components remain
server components — no loading states, no client refetching, `router.refresh()`
works exactly as before. Only their data-fetching lines changed.

**API:** all 43 handlers keep their paths, methods, status codes and response
bodies. Two spots needed care and got it:

- `POST /api/accounts` previously used a Prisma `select` to return exactly five
  fields. The repository returns the full record, so the route now **projects
  explicitly** — the response still carries `{id, name, email, role, createdAt}`
  and can never widen to include `passwordHash`.
- `GET /api/parking-spaces/locations` used Prisma's `distinct`. It is now
  `listDistinctActiveLocations()`, returning the same `{ locations: string[] }`.

The 31 client `fetch()` call sites are untouched, which is the practical proof
the contracts held.

---

## 6. Design decisions worth your review

### 6.1 One `plan` step, not the doc's separate `guard` / `mutate` / `event`
`MIGRATION_ARCHITECTURE.md` §1.3 proposed three separate callbacks. Implementing
it revealed that **WF05's preconditions need database reads** — the space lookup
(404) and the overlap check (409) — and those reads must happen *inside* the
transaction, or two concurrent assignments to the same space stop being
serialised. A sync `guard` cannot do that, and splitting "throws" across two
callbacks makes the failure path harder to follow.

So the spec is a single `plan(current, reads)` that both validates and returns
`{ patch, event }`. `TransitionReads` is a **fixed, named set** of exactly the
three lookups the workflows need — not a general query handle — so it stays
implementable on a backend without transactions. The architecture document
should be updated to match.

### 6.2 The atomic increment was preserved, not flattened
`rejectionCount: { increment: 1 }` could have become `current.rejectionCount + 1`
and every test would still pass. It was kept as a first-class `NumericDelta` in
the patch type, because flattening it would silently weaken concurrent-update
behaviour — invisible in tests, real in production.

### 6.3 cuid generation still belongs to Prisma
The architecture document notes the data layer must own cuid generation once
Prisma is gone. Phase 1 **deliberately does not do that**: Prisma's
`@default(cuid())` still generates them, so ID behaviour is bit-for-bit
unchanged. Introducing app-side generation now would be a behaviour change with
no benefit until Phase 3. `create()` returning a record with an id is an
interface contract; how the id is produced is an implementation detail, so the
SharePoint implementation can own it without any interface change.

### 6.4 `RateTableRepository` has no `update()`
The rate table is append-only (Section 7). The interface simply does not expose
a way to modify a row, which turns a documented convention into something the
type system enforces.

### 6.5 WF01 stayed two steps; the asymmetric cancellation stayed asymmetric
Both preserved as instructed, and both are pinned by tests. `access-workflows.ts`
now carries an explicit comment recording that the missing role check on access
cancellation is deliberate, so a future reader does not "fix" it.

---

## Nothing was blocked

No behaviour proved impossible to preserve through the abstraction, so there was
nothing to stop and report. The one design mismatch (§6.1) was in the proposed
*interface shape*, not in any application behaviour.

Prisma remains fully in place and is the only implementation. The next phase can
add `SharePointRepositories` beside it behind the same interfaces, with these
222 tests as the arbiter.
