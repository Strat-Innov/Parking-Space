# Parkspace — Data-Access Abstraction Architecture

**Status:** Design only. No application code, no schema change, no UI change.
**Companion:** `MIGRATION_AUDIT.md` (read-only audit of the current state).
**Target:** Vercel stays. Next.js stays. Prisma/Neon is replaced by SharePoint
via Microsoft Graph, behind a repository boundary that both can implement.

**Preservation contract — every item below is a hard constraint on this design:**
WF01–WF06 exactly · Parking Access workflows (AWF01–AWF03 + Cancel) · guest
submissions · cuids and `/requests/<cuid>` URLs · derived parking-space
availability · append-only RateTable · RequestEvent/AccessRequestEvent audit
behaviour · BR-007 (WF06 sole writer of `Completed`) · all existing validation
rules · every API request/response contract · all UI behaviour.

---

## Finding that changes Step 1

**There is no test infrastructure in this repository.** No test runner, no test
files, no `test` script, no `.github/` directory, no CI. The `package.json`
scripts are `dev`, `build`, `start`, `lint`, `db:push`, `db:seed`, `db:reset`.

The stated purpose of Step 1 is *"test that our refactoring hasn't broken
WF01–WF06 before we even touch SharePoint."* That safety net does not exist and
has to be built first. It is the single highest-value piece of work in this
migration, and it must be written **against the current Prisma implementation,
before the boundary is introduced** — otherwise it characterises the refactor
rather than the original. See §12; it becomes Phase 0.

A second finding with design consequences: **Prisma generates `cuid()`
client-side, not in Postgres.** All 7 `@default(cuid())` columns are filled by
Prisma Client. Removing Prisma removes cuid generation, so the repository layer
must own it explicitly (§1.4). This is easy but silently fatal if missed.

---

## 1. Repository interfaces and types

### 1.1 The design problem

12 of the 14 `$transaction` blocks are *interactive* — they take a `tx` handle
and run read → guard → write → append-event inside one transaction. An interface
shaped like `withTransaction(fn)` cannot be honestly implemented on SharePoint,
which has no multi-item transaction. Exposing it would produce an interface that
type-checks and silently loses atomicity.

Looking at what those 12 blocks actually do, they are all the same shape:

```
1. read the request by id
2. guard on status (and role — already checked before the transaction)
3. optionally, one secondary read (rate resolution / space lookup / conflict query)
4. update the request
5. append one event
6. WF04/WF05 only: hand off to WF06, which re-reads and may update + append again
```

So the boundary is not "expose transactions". It is **one guarded-transition
primitive** that both backends can implement honestly — Prisma with a real
transaction, SharePoint with an ETag `If-Match` compare-and-swap — plus ordinary
finders for everything else.

**The existing status guards are the concurrency control.** `wf03Decide` already
refuses unless `status === "Pending Approval"`. Under ETag concurrency, a lost
race produces a 412, the transition re-reads, the guard now sees the wrong
status, and the caller gets exactly the same 409 with exactly the same message it
gets today. No new error path reaches the UI.

### 1.2 Core types

```ts
// Hand-written replacements for the Prisma model types. Field-for-field
// identical to prisma/schema.prisma so that `include`-shaped call sites and
// all UI props keep compiling unchanged.
export interface UserRecord { /* …schema.prisma User… */ }
export interface ParkingRequestRecord { /* …schema.prisma ParkingRequest… */ }
export interface RateTableEntryRecord { /* … */ }
export interface ParkingSpaceRecord { /* … */ }
export interface RequestEventRecord { /* … */ }
export interface AccessRequestRecord { /* … */ }
export interface AccessRequestEventRecord { /* … */ }

// Hydration shapes — the exact projections the current `include:` clauses
// produce, so callers see no difference.
export type NamedRef = { name: string };
export type NamedEmailRef = { name: string; email: string };
export type ActorRef = { name: string; role: string };

export type ParkingRequestWithRequester =
  ParkingRequestRecord & { requester: NamedRef };
export type ParkingRequestDetail = ParkingRequestRecord & {
  requester: NamedEmailRef;
  preparedBy: NamedRef | null;
  validatedBy: NamedRef | null;
  rejectedBy: NamedRef | null;
  cashier: NamedRef | null;
  assignedBy: NamedRef | null;
  rateVersion: RateTableEntryRecord | null;
  events: (RequestEventRecord & { actor: ActorRef | null })[];
};
// …equivalents for AccessRequest, ParkingSpace (+createdBy), RateTableEntry (+createdBy)

// Opaque per-backend concurrency token. Prisma ignores it; SharePoint carries
// the item ETag. Never leaves the data layer.
export type VersionToken = string | null;
export type Versioned<T> = { record: T; version: VersionToken };
```

### 1.3 The guarded-transition primitive

```ts
export type TransitionSpec<T> = {
  /** Runs against the freshly-read record. Throw WorkflowError to abort.
   *  Pure and side-effect free — it is re-run on every concurrency retry. */
  guard: (current: T) => void;
  /** Returns the field patch. Pure; re-run on retry. */
  mutate: (current: T) => Partial<T>;
  /** The audit row, appended after the update succeeds. */
  event: (current: T, updated: T) => NewEventInput;
};

export interface TransitionRunner<T> {
  /** Read → guard → CAS-update → append event. On version conflict, re-read
   *  and retry a bounded number of times; the guard re-runs each attempt, so a
   *  genuinely-lost race surfaces as the caller's normal 409, not a 5xx. */
  transition(id: string, spec: TransitionSpec<T>): Promise<T>;
}
```

WF04 and WF05 each become **two sequential `transition` calls** — their own, then
WF06's — rather than one nested transaction. §8.3 covers what happens if the
process dies between them.

### 1.4 The repository interfaces

```ts
export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByIdOrThrow(id: string): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;          // lowercased by caller today
  findByVerificationToken(token: string): Promise<UserRecord | null>;
  listByRoles(roles: readonly string[]): Promise<UserRecord[]>;    // orderBy createdAt desc
  create(input: NewUserInput): Promise<UserRecord>;                // generates the cuid
  update(id: string, patch: Partial<UserRecord>): Promise<UserRecord>;
  delete(id: string): Promise<void>;
  /** Replaces the `_count` aggregate select in accountDeletion.ts. */
  countWorkflowHistory(userId: string): Promise<Record<string, number>>;
  /** Replaces the two updateMany calls in the account-delete transaction. */
  clearAttributionFor(userId: string): Promise<void>;
  findOrCreateGuest(fullName: string, email: string): Promise<string>;
}

export interface ParkingRequestRepository extends TransitionRunner<ParkingRequestRecord> {
  findById(id: string): Promise<ParkingRequestRecord | null>;
  findDetailById(id: string): Promise<ParkingRequestDetail | null>;
  listAllWithRequester(): Promise<ParkingRequestWithRequester[]>;      // dashboard
  listAllForExport(): Promise<ParkingRequestForExport[]>;              // export route
  countByParkingSpace(parkingSpaceId: string): Promise<number>;
  countByRateVersion(rateVersionId: string): Promise<number>;
  findConflictingBooking(q: BookingWindowQuery): Promise<ParkingRequestRecord | null>;
  findLockedSpaceIds(q: BookingWindowQuery): Promise<Set<string>>;
  findUpcomingBookingForSpace(spaceId: string, from: Date): Promise<ParkingRequestRecord | null>;
  listActiveBookingsFrom(from: Date): Promise<BookingSummary[]>;       // parking-locations page
  create(input: NewParkingRequestInput): Promise<ParkingRequestRecord>;
  deleteWithEvents(id: string): Promise<void>;
}

export interface RateTableRepository {
  listAll(): Promise<(RateTableEntryRecord & { createdBy: NamedRef | null })[]>;
  findById(id: string): Promise<RateTableEntryRecord | null>;
  /** §7 rule: latest effectiveStartDate <= asOf. Never mutates an older row. */
  resolveCurrent(serviceType: string, asOf: Date): Promise<RateTableEntryRecord | null>;
  create(input: NewRateEntryInput): Promise<RateTableEntryRecord>;
  delete(id: string): Promise<void>;
}

export interface ParkingSpaceRepository {
  listAll(): Promise<(ParkingSpaceRecord & { createdBy: NamedRef | null })[]>;
  listActive(): Promise<ParkingSpaceRecord[]>;
  listDistinctActiveLocations(): Promise<string[]>;   // replaces Prisma `distinct`
  findById(id: string): Promise<ParkingSpaceRecord | null>;
  findActiveByLocationAndSlot(location: string, slot: string): Promise<ParkingSpaceRecord | null>;
  findExistingSlotNumbers(location: string, slots: string[]): Promise<Set<string>>;
  create(input: NewSpaceInput): Promise<ParkingSpaceRecord>;
  createMany(inputs: NewSpaceInput[]): Promise<number>;
  update(id: string, patch: Partial<ParkingSpaceRecord>): Promise<ParkingSpaceRecord>;
  delete(id: string): Promise<void>;
}

export interface RequestEventRepository {
  append(input: NewEventInput): Promise<RequestEventRecord>;
  listForRequest(requestId: string): Promise<(RequestEventRecord & { actor: ActorRef | null })[]>;
  deleteForRequest(requestId: string): Promise<void>;
}

export interface AccessRequestRepository extends TransitionRunner<AccessRequestRecord> { /* mirrors ParkingRequestRepository */ }
export interface AccessRequestEventRepository { /* mirrors RequestEventRepository */ }

export interface Repositories {
  users: UserRepository;
  parkingRequests: ParkingRequestRepository;
  requestEvents: RequestEventRepository;
  rateTable: RateTableRepository;
  parkingSpaces: ParkingSpaceRepository;
  accessRequests: AccessRequestRepository;
  accessRequestEvents: AccessRequestEventRepository;
}
```

**Where cuids come from.** `create()` on every repository generates the cuid in
the data layer (`cuid`/`@paralleldrive/cuid2`), matching what Prisma Client does
today. Both implementations use the identical generator, so IDs are
indistinguishable across backends and `/requests/<cuid>` keeps working.

**BR-007 stays enforceable.** `Completed` is written by exactly one code path
(`wf06CheckCompletion`). The repository can additionally reject any `mutate`
returning `status: "Completed"` unless flagged as the WF06 transition — turning a
convention into an invariant the data layer enforces. Recommended, and it changes
no observable behaviour.

---

## 2. Prisma model → SharePoint list

| Prisma model | SharePoint list | Internal name | Notes |
|---|---|---|---|
| `User` | Users | `Users` | Stays app-managed. Identity is **not** moving to Entra in this migration (see §10). |
| `ParkingRequest` | Parking Requests | `ParkingRequests` | ~45 columns; the list that hits the threshold first |
| `RateTableEntry` | Rate Table | `RateTable` | Append-only, enforced by permissions **and** by the repository exposing no `update` |
| `ParkingSpace` | Parking Spaces | `ParkingSpaces` | Soft delete via `IsActive`; **no `IsAssigned` column, ever** |
| `RequestEvent` | Request Events | `RequestEvents` | Append-only; kept as an explicit list, not native version history |
| `AccessRequest` | Access Requests | `AccessRequests` | |
| `AccessRequestEvent` | Access Request Events | `AccessRequestEvents` | Append-only |

All seven live on **one** SharePoint site so a single `Sites.Selected` grant
covers them (§10).

**Why `Users` remains a list rather than becoming Entra ID:** the migration
brief keeps the existing server-side session system, and the app has guest
`REQUESTER` rows created for anonymous submitters who have no tenant identity.
Moving identity to Entra is a separate project with its own UX consequences.
Keeping `Users` as a list is what "change persistence only" actually means here.

**Consequence to accept explicitly:** with app-only Graph auth (§10), every
SharePoint `Created By`/`Modified By` will read as the Parkspace application, not
the human actor. The app's own `RequestEvent.actorId` / `preparedById` /
`validatedById` columns become the *sole* human attribution. This is a real
audit-posture change and should be signed off, not discovered later.

---

## 3. Prisma operation → repository method

Every one of the 104 call sites. Format: current call → replacement.

### 3.1 User (35 sites)
| Current | Repository method | Sites |
|---|---|---|
| `user.findUnique({where:{email}})` | `users.findByEmail` | login, signup, accounts POST, invite, resend-confirmation, guest |
| `user.findUnique({where:{emailVerificationToken}})` | `users.findByVerificationToken` | verify-email, accept-invite, invite-info |
| `user.findUnique({where:{id}})` | `users.findById` | deactivate, reactivate, role, activate, delete |
| `user.findUniqueOrThrow({where:{id}})` | `users.findByIdOrThrow` | change-password |
| `user.findMany({where:{role:{in}}})` | `users.listByRoles` | accounts route, accounts page |
| `user.create` | `users.create` | signup, accounts POST, invite, guest |
| `user.update` | `users.update` | ×10 (password, verification, active, role) |
| `user.delete` | `users.delete` | accounts delete |
| `user.upsert` | `users.create` guarded by `findByEmail` | seed only |
| `_count` select | `users.countWorkflowHistory` | accountDeletion.ts |

### 3.2 ParkingRequest (27 sites)
| Current | Repository method |
|---|---|
| `findMany({orderBy:createdAt desc, include:{requester}})` | `listAllWithRequester` (dashboard, requests GET) |
| `findMany` + preparedBy/validatedBy include | `listAllForExport` |
| `findUnique` + 6 includes + events | `findDetailById` (detail page, requests/[id] GET) |
| `findUnique({where:{id}})` bare | `findById` (delete route) |
| `findUniqueOrThrow` inside tx ×8 | absorbed into `transition()`'s internal read |
| `update` inside tx ×12 | `transition()`'s `mutate` |
| `create` inside tx | `create` |
| `findFirst` overlap query | `findConflictingBooking` |
| `findMany` locked-ids query | `findLockedSpaceIds` |
| `findFirst` upcoming-booking | `findUpcomingBookingForSpace` |
| `findMany` active bookings (parking-locations) | `listActiveBookingsFrom` |
| `count({where:{parkingSpaceId}})` | `countByParkingSpace` |
| `count({where:{rateVersionId}})` | `countByRateVersion` |
| `delete` + `requestEvent.deleteMany` in tx | `deleteWithEvents` |

### 3.3 ParkingSpace (13), RateTableEntry (9), Events (3), AccessRequest (9)
| Current | Repository method |
|---|---|
| `parkingSpace.findMany` + createdBy | `parkingSpaces.listAll` |
| `parkingSpace.findMany({where:{isActive}})` | `parkingSpaces.listActive` |
| `parkingSpace.findMany({distinct:["location"]})` | `parkingSpaces.listDistinctActiveLocations` — **Graph has no DISTINCT**; de-duplicate in memory |
| `parkingSpace.findMany({slotNumber:{in}})` | `parkingSpaces.findExistingSlotNumbers` |
| `parkingSpace.findFirst` duplicate check | `parkingSpaces.findActiveByLocationAndSlot` |
| `parkingSpace.findUnique` ×3 | `parkingSpaces.findById` |
| `create` / `createMany` / `update` / `delete` | same-named methods |
| `updateMany({createdById:null})` ×2 | `users.clearAttributionFor` |
| `rateTableEntry.findMany` + createdBy | `rateTable.listAll` |
| `rateTableEntry.findFirst` + orderBy desc | `rateTable.resolveCurrent` |
| `rateTableEntry.findUnique/create/delete/count` | same-named methods |
| `requestEvent.create` (in tx) | `transition()`'s `event` |
| `requestEvent.deleteMany` | `requestEvents.deleteForRequest` |
| `accessRequest.*` | mirror of the ParkingRequest table above |

---

## 4. API routes and workflows requiring change

**Design goal: zero change to the 31 client `fetch()` call sites and zero change
to every response body.** Under this boundary that holds — all changes are
`prisma.x.y()` → `repos.x.y()` substitutions inside route handlers and lib files.

### 4.1 Mechanical (21 route files)
Swap the import and the call. No logic change, no response change:
all `accounts/*`, all `auth/*`, `rate-table/*`, `parking-spaces` GET/POST,
`parking-spaces/[id]/remove`, `requests` GET, `requests/[id]` GET,
`access-requests` GET, `access-requests/[id]` GET.

### 4.2 Needs real thought (7 sites)
| Site | Why |
|---|---|
| `lib/workflows.ts` | 8 interactive transactions → `transition()`. The bulk of the work, and the highest risk. |
| `lib/access-workflows.ts` | 4 interactive transactions → `transition()` |
| `requests/[id]/delete` | Cascade (events then request) with no transaction — needs ordered deletes + a documented partial-failure state |
| `accounts/[id]/delete` | `_count` aggregate + a 3-statement transaction across 3 lists |
| `parking-spaces/bulk` | `createMany` has no Graph batch-insert equivalent; becomes N creates via `$batch` (non-transactional) |
| `parking-spaces/locations` | `distinct` has no Graph equivalent |
| `requests/export` | Unfiltered fetch-all — the first place paging cost becomes visible (§9) |

### 4.3 Server components (7 files)
`dashboard`, `requests/[id]`, `access/dashboard`, `access/[id]`, `accounts`,
`rate-table`, `parking-locations` currently call Prisma inside the component.
They call `repos.*` instead. **They stay server components on Vercel** — no
loading states, no client refetch, `router.refresh()` keeps working exactly as
today. This is the direct payoff of dropping GitHub Pages.

### 4.4 Explicitly NOT changed
`src/lib/{types,validation,access-validation,access-types,dashboard,parking-date-helpers,password,signup,url,emailVerification,email}.ts`,
`src/lib/pdf/*`, all 31 components, all 14 pages' markup, `api-helpers.ts`,
`auth.ts` except its one `findUnique` (→ `users.findByEmail`), and
`prisma/schema.prisma` — which stays as the Prisma implementation's schema and
the migration's reference document.

---

## 5. Proposed SharePoint columns and types

Type mapping rules:

| Prisma | SharePoint | Caveat |
|---|---|---|
| `String @id @default(cuid())` | Text `ExternalId`, indexed | Uniqueness is **not** enforced by SharePoint — enforce in the repository |
| `String` (short) | Single line of text | **255-char limit** |
| `String` (long) | Multiple lines of text, plain | **Cannot be indexed or filtered** |
| `DateTime` | Date and Time (with time) | Store UTC; confirm the site's regional settings do not shift values |
| `Float` | Number (2 decimals) | Money — never Currency, which carries a locale |
| `Int` | Number (0 decimals) | |
| `Boolean` | Yes/No | |
| `String[]` | Choice (multi-select) | `User.roles` |
| FK `String?` | Text holding the target's cuid | See §7 — text over Lookup, deliberately |

**Fields that must be Multiple-lines-of-text** (free text, plausibly >255 chars,
and therefore permanently unfilterable — verified none of them is ever filtered
on today): `ParkingRequest.purpose`, `ParkingRequest.rejectionReason`,
`RequestEvent.note`, `AccessRequest.remarks`, `AccessRequest.staffRemarks`,
`AccessRequestEvent.note`.

**Every list needs `Title` handled.** SharePoint creates a required `Title`
column. Either make it optional at provisioning time or populate it with
something meaningful (`ExternalId` for the event lists; `CompanyName` for the
request lists) so items are identifiable in the SharePoint UI. Decide once,
apply to all seven.

### 5.1 `ParkingRequests` (abbreviated — full column list mirrors schema.prisma)
`ExternalId` Text\* · `FullName` Text · `CompanyName` Text\* · `EmailAddress` Text ·
`ServiceType` Text\* · `PreferredParkingLocation` Text · `RequestedSlot` Text ·
`DateOfRequest` DateTime · `RequiredStartDate` DateTime\* · `EndDate` DateTime\* ·
`Purpose` **Note** · `Status` Text\* · `ApprovalStage` Text · `PaymentStatus` Text ·
`SlotStatus` Text\* · `PreparedById` Text · `ValidatedById` Text ·
`ApprovalDecision` Text · `ValidatedDate` DateTime · `RejectionCount` Number ·
`RejectionReason` **Note** · `RejectedById` Text · `RejectedDate` DateTime ·
`CashierId` Text · `PayDate` DateTime · `OfficialReceiptReference` Text ·
`AssignedSlot` Text · `ParkingSpaceId` Text\* · `SlotAssignmentDate` DateTime ·
`AssignedById` Text · `TotalHours` Number · `TotalDays` Number · `TotalMonths` Number ·
`RateVersionId` Text\* · `RateAmountSnapshot` Number · `RateSnapshotDate` DateTime ·
`TotalPaymentDue` Number · `CompletedDate` DateTime · `RequesterId` Text\* ·
`CreatedAtApp` DateTime\*
(\* = indexed, §6)

`updatedAt` is **dropped** — SharePoint's native `Modified` covers it. Verify no
UI surface reads it before removing.

**`CreatedAtApp` is deliberately a separate column from SharePoint's `Created`.**
Migrated rows must keep their original Neon `createdAt`; `Created` will be the
import timestamp. Every `orderBy: { createdAt: "desc" }` binds to `CreatedAtApp`.
Missing this silently reorders every dashboard after migration.

The other six lists follow the same mechanical mapping from `schema.prisma`.

---

## 6. Required SharePoint indexes

SharePoint indexes are **single-column**. A multi-clause `$filter` uses one index
and scans the remainder *within that subset* — so the first clause must be the
selective one, and the index must exist before the list crosses 5,000 items
(creating one afterwards is materially harder). There is a per-list cap
(commonly 20) — the plan below stays well under it.

| List | Indexed columns | Driven by |
|---|---|---|
| `ParkingRequests` | `ExternalId`, `Status`, `SlotStatus`, `ParkingSpaceId`, `RequiredStartDate`, `EndDate`, `RateVersionId`, `RequesterId`, `CreatedAtApp` | WF05 overlap query, both count-checks, all `orderBy` |
| `RequestEvents` | `ExternalId`, `RequestId`, `CreatedAtApp` | Timeline fetch, cascade delete |
| `ParkingSpaces` | `ExternalId`, `IsActive`, `Location` | active list, duplicate check, bulk create |
| `RateTable` | `ExternalId`, `ServiceType`, `EffectiveStartDate` | `resolveCurrent` |
| `AccessRequests` | `ExternalId`, `Status`, `RequesterId`, `CreatedAtApp` | dashboard, cancel guard |
| `AccessRequestEvents` | `ExternalId`, `RequestId`, `CreatedAtApp` | Timeline |
| `Users` | `ExternalId`, `Email`, `EmailVerificationToken`, `Role` | login, all token lookups, account lists |

**The WF05 overlap query is the one to design around.** It filters
`ParkingSpaceId` + `SlotStatus` + `Status != Cancelled` + `RequiredStartDate < end`
+ `EndDate > start`. Lead with `ParkingSpaceId` — the most selective by orders of
magnitude, since one space has few bookings. Everything else evaluates within
that handful of rows. Do **not** lead with `SlotStatus`.

---

## 7. Relationships and lookups

**Recommendation: text columns holding the target's cuid, not SharePoint Lookup
columns.**

Rationale — Lookup columns would give weak referential integrity in the
SharePoint UI, but they cost: a 12-lookups-per-view limit that
`ParkingRequests` (6 user FKs + space + rate = 8) comes close to; lookup values
keyed to SharePoint's integer ids, forcing a translation layer that defeats the
cuid-preservation requirement; and a hard block on the list-view threshold
(lookup-column queries fail above it in ways plain text does not). Plain text
columns holding cuids keep the data model identical to today's, keep every FK
value stable across the migration, and keep filtering cheap. The referential
integrity they give up was **already not enforced** — `schema.prisma` has no
`onDelete` anywhere, and `accountDeletion.ts` exists precisely because the app
checks relationships itself.

**Hydration replaces `include`.** For each of the 8 `include:` shapes, the
repository: (1) fetches the primary items; (2) collects the distinct referenced
cuids; (3) batch-fetches those in one filtered call (or from a per-request
cache); (4) stitches the objects in memory into the exact shape the caller
expects. The `requester`/`preparedBy`/`validatedBy` projections are all
`{ name }` or `{ name, email }` from `Users` — a single fetch per page load
covers every user reference on it.

**A per-request user cache is worth building in from the start.** The dashboard
references potentially hundreds of user cuids across ~4 distinct fields; without
caching that is one Graph call per reference.

---

## 8. Transactions, ETags, concurrency

### 8.1 What is actually lost
Nothing that today's code depends on for *correctness of reads* — no query reads
across two models inside a transaction to make a decision. What is lost is
**write atomicity**: item and event row can diverge.

### 8.2 ETag compare-and-swap
Every `transition()` implementation:
1. `GET` the item; capture its ETag.
2. Run `guard` in memory; a violation throws the same `WorkflowError` as today.
3. `PATCH` with `If-Match: <etag>`.
4. On `412 Precondition Failed`: re-read and retry from step 1, bounded (3
   attempts) with jittered backoff. Because the guard re-runs, a genuinely-lost
   race produces the existing 409 message, not a new failure mode.
5. On success, append the event row.

This is a **stronger** guarantee than today for the read-modify-write cases.
`rejectionCount: { increment: 1 }` currently relies on Postgres's atomic
increment; under CAS it becomes read-increment-write, which is safe here and
observably identical.

### 8.3 Where compensation is genuinely needed

**WF01 (create → route → 2 events).** The current code creates the row as
`Submitted`, immediately updates it to `In Preparation`, and logs two events. Its
own comment states a caller *never observes a request resting in "Submitted"*.
**Proposal: create the item once, already in `In Preparation`, then append both
event rows unchanged.** Four writes become three, the intermediate state that
nobody can observe disappears, and the audit trail is byte-identical. This is a
behaviour-preserving simplification — but it is a judgment call about an
unobservable state, so it needs your explicit sign-off rather than being an
implementation detail.

**WF04/WF05 → WF06.** Two sequential transitions. If the process dies between
them, a request sits `Approved` with both tracks confirmed and no `Completed`.
Mitigations, in order of preference:
1. **Make WF06 idempotent** (it already re-reads and no-ops unless
   `Approved` + both tracks) — so simply re-running it repairs the state.
2. **Add a reconciliation sweep** — a Vercel cron that finds `Approved` +
   `Confirmed` + `Assigned` rows and runs WF06. Small, safe, and it preserves
   BR-007 because it calls the same sole writer.
3. Do *not* opportunistically run WF06 on read — that would make a GET mutate
   data and change observable behaviour.

Recommendation: (1) + (2). Decision needed on whether the cron is acceptable.

**Cascade deletes** (`requests/[id]/delete`, `accounts/[id]/delete`). Order
matters: delete events, then the request; clear attribution, then the user. A
mid-sequence failure leaves orphaned-but-harmless rows and the operation is
safely re-runnable. Both are Developer-only, rare, and already guarded.

**`$batch` is not a transaction.** It reduces round trips (up to 20 requests per
batch), nothing more. Use it for `parking-spaces/bulk` and hydration fan-out;
never reason about it as atomic.

### 8.4 Throttling
Graph returns `429` with `Retry-After`. The client needs centralised retry with
exponential backoff and jitter for 429/503, plus a request budget per page render
— otherwise a dashboard with hundreds of rows becomes a self-inflicted DoS.

---

## 9. Pagination and the 5,000-item threshold

**Two different limits, often conflated:**
- **Page size** — Graph returns items in pages with `@odata.nextLink`. Always
  follow it; never assume one response is the whole set.
- **List view threshold (5,000)** — a *query* limit. A filter/sort that would
  scan more than 5,000 items fails unless it uses an indexed column that narrows
  the set first.

### 9.1 The exposed queries
| Query | Today | Risk |
|---|---|---|
| Dashboard `listAllWithRequester` | fetch **all** requests, filter in memory | **Highest.** Unbounded fetch; O(n) pages |
| Export (bulk mode) | fetch **all**, filter in memory | Same, plus it builds a workbook |
| `parking-locations` active bookings | filtered `endDate >= now` | Fine with the `EndDate` index |
| WF05 overlap | 5-clause filter | Fine, led by `ParkingSpaceId` |
| `rateTable.resolveCurrent` | `orderBy desc`, take 1 | Fine with `EffectiveStartDate` indexed |

### 9.2 Recommended approach
**Phase 1: preserve behaviour exactly — page through and filter in memory.**
Identical results, provably. Slower, and that is acceptable at current data
volume.

**Phase 2 (a separate, tested change): push `isActionable` into `$filter`.**
It is expressible in OData — `Status`, `PaymentStatus`, `SlotStatus` are all
indexed. But it is a behaviour-equivalence claim that must be *proved by test*
(same inputs → same row sets, both backends), not assumed. Treat it as an
optimisation with its own review, never bundled into the migration.

Also required regardless: `$select` only the fields actually used (the dashboard
needs 8 of ~45 columns), and set `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly`
**nowhere** — if a query needs it, the missing index is the bug.

*Verify current Graph paging/threshold specifics against Microsoft's live
documentation at implementation time; these limits have changed before.*

---

## 10. Authentication architecture, Vercel → Microsoft Graph

You asked not to settle this by guesswork. Here is the reasoning, then the
per-operation permission table.

### 10.1 Delegated vs application — the decision is forced

**Delegated permissions are not viable for this application.** Three
independent blockers:

1. **Guest submissions.** `/requests/new` and `/access/new` accept anonymous
   submissions (`src/lib/guest.ts`). An anonymous submitter has no Entra token.
   Under delegated-only, public intake stops working — violating the
   preservation contract.
2. **There is no user token to delegate from.** The migration brief keeps the
   existing bcrypt + `jose` session system. Parkspace users authenticate against
   its own `Users` list; nothing in that flow produces an Entra token. Delegated
   access would require adding Entra sign-in first — a different project.
3. **Staff are not necessarily tenant users.** `User` rows are created by
   in-app signup and invite, with a domain allowlist, not by tenant membership.

**Therefore: application permissions, app-only auth (client credentials).**

### 10.2 Least privilege: `Sites.Selected`

Do **not** grant `Sites.ReadWrite.All` — that is tenant-wide write access to
every SharePoint site. Grant **`Sites.Selected` (Application)**, then have an
administrator grant *write* on the single Parkspace site to that app
registration. The app can then touch that site and nothing else.

| Concern | Setting |
|---|---|
| Graph permission | `Sites.Selected` (Application), admin-consented |
| Site-level grant | `write` on the Parkspace site only |
| Credential | Certificate preferred over client secret; if a secret, a documented rotation schedule |
| Storage | Vercel encrypted environment variables — server-side only, never `NEXT_PUBLIC_*` |
| Token handling | Cache the app token in memory to its expiry; never per-request re-acquisition |

### 10.3 Permission required per operation

Every operation runs under the same app identity and the same
`Sites.Selected`+site-write grant. What differs is the *effective* access each
needs — worth recording so a future tightening (e.g. read-only replica, separate
reporting app) has the analysis already done.

| Operation group | Graph calls | Effective access |
|---|---|---|
| Login / session (`users.findByEmail`) | `GET /sites/{s}/lists/Users/items?$filter=fields/Email eq '…'&$expand=fields` | Read |
| Signup, invite, guest create | `POST …/lists/Users/items` | Write |
| Email verification, password change, activate/deactivate/role | `PATCH …/lists/Users/items/{id}` | Write |
| Account delete | `PATCH` ×2 lists + `DELETE …/Users/items/{id}` | Write |
| Dashboard / detail reads, export | `GET …/items?$expand=fields` (+ paging) | Read |
| WF01 submit | `POST` ParkingRequests + `POST` ×2 RequestEvents | Write |
| WF02–WF06, DEV revert, cancel | `GET` item → `PATCH` with `If-Match` → `POST` RequestEvents | Write |
| Rate create / delete | `POST` / `DELETE` RateTable | Write |
| Space create / bulk / remove / delete | `POST`, `$batch POST`, `PATCH`, `DELETE` | Write |
| Access workflows | mirror of the parking-request rows | Write |

**No operation requires `Sites.ReadWrite.All`, `Sites.Manage.All`,
`Sites.FullControl.All`, or any `User.*` / `Directory.*` permission.** If a
proposed implementation asks for one, that is a design error worth stopping on.

### 10.4 Consequences to accept
- All SharePoint-side `Created By`/`Modified By` show the application. Human
  attribution lives only in the app's own actor columns (§2).
- Item-level SharePoint permissions cannot restrict the app by end-user role —
  **all authorisation stays in `requireRole()` exactly as today.** That is
  behaviour-preserving, and it means the SharePoint lists must not be treated as
  independently secured against direct access.
- Anyone with site access can edit list items directly, bypassing every workflow
  guard. Restrict site membership tightly, and note that append-only enforcement
  on `RateTable`/event lists is a *convention plus permissions*, not a database
  constraint.

---

## 11. Data migration from Neon

**Order is dictated by referential dependency:**
`Users` → `ParkingSpaces` → `RateTable` → `ParkingRequests` → `RequestEvents` →
`AccessRequests` → `AccessRequestEvents`

### 11.1 Method
1. **Export** — a script using the *existing* Prisma client reads every row of
   every model to newline-delimited JSON. Read-only against Neon; safe to re-run.
2. **Transform** — map Prisma field names to SharePoint internal names; cuid →
   `ExternalId`; `createdAt` → `CreatedAtApp`; dates to UTC ISO-8601; FK cuids
   written verbatim as text (§7 means **no id translation is needed** — the whole
   point of choosing text over Lookup).
3. **Load** — `$batch` (20 items/request) with 429 backoff. Idempotent: check
   `ExternalId` before insert so a re-run resumes rather than duplicates.
4. **Validate** — see below.

### 11.2 Validation gates (all must pass before cutover)
- **Counts** — per-list item count equals the Neon row count, exactly.
- **Referential integrity** — every non-null FK cuid resolves to an existing
  `ExternalId` in the target list. Zero orphans.
- **Money and totals** — sum of `TotalPaymentDue`, `RateAmountSnapshot`,
  `PurchasedCharge` matches Neon to the cent. These are the fields where a
  silent type coercion would do real damage.
- **Dates** — spot-check that no `RequiredStartDate`/`EndDate` shifted by a
  timezone offset. Compare min/max per list.
- **Full-record diff** — read every item back through the SharePoint repository
  and deep-compare against the Prisma read of the same cuid. This is the real
  gate; the others are fast pre-checks.
- **URL check** — a sample of `/requests/<cuid>` resolves identically on both.

### 11.3 Cutover and rollback
- Select the implementation with a single env var (`DATA_BACKEND=prisma|sharepoint`),
  resolved once at startup. Prisma stays in the codebase and remains selectable.
- **Do not dual-write.** It doubles the failure surface and creates divergence
  questions with no clean answer. Cut over, keep **Neon live and read-only** for
  a defined validation period, and roll back by flipping the env var if the
  period surfaces a problem.
- Freeze writes during the load (brief maintenance window) so the export is a
  consistent snapshot. With current data volume this should be minutes.
- After the validation period passes, retire Neon and remove the Prisma
  implementation as a separate, deliberate cleanup.

---

## 12. Testing strategy

**Starting position: zero tests, no runner, no CI.** Everything here is new work,
and it is the prerequisite for the whole migration — not an afterthought.

### 12.1 Phase 0 — characterisation tests against Prisma *before* refactoring
Runner: Vitest (fast, TS-native, minimal config). Target: a real Postgres in
Docker seeded by the existing `prisma/seed.ts`.

Cover, at minimum:
- **WF01–WF06 happy paths**, each asserting the full resulting record *and* the
  `RequestEvent` rows written (workflow name, from/to status, actor, note).
- **Every guard**: wrong role, wrong status, double payment, double slot
  assignment, cancel-from-terminal, reject-without-reason.
- **BR-001/BR-002** backdating and same-day rejection; **BR-004** reject loop
  incrementing `rejectionCount` and returning to `In Preparation`;
  **BR-006** independence — payment and slot in either order reach `Completed`;
  **BR-007** — `Completed` written only via WF06.
- **Rate snapshot** taken at WF03, not submission; and unchanged when a newer
  rate row is later added.
- **Derived availability** — overlapping windows conflict, adjacent windows do
  not, cancelled bookings never hold a space, `excludeRequestId` works.
- **`computeTotals`** — the calendar-month edge cases the code comments call out
  (Aug 10 → Sep 10 is one month, not two).
- **AWF01–AWF03 + cancel**, same rigour.
- **Guest submission** — found-or-created by email, unusable password hash.
- **Account deletion** — blocked with workflow history, permitted with only
  attribution, attribution nulled.
- **DEV revert** — each of the three revertible statuses, and refusal elsewhere.

These tests encode the preservation contract. Every one of them must pass
unchanged at every later step; a test that needs editing is a behaviour change
that needs your sign-off.

### 12.2 Phase 1 — the same suite, through the boundary
After introducing the repository interface with the Prisma implementation
behind it, the Phase 0 suite runs **untouched**. Green means the refactor is
behaviour-preserving. That is exactly the Step-1 safety net.

### 12.3 Phase 3 — contract tests, both backends
Promote the suite to a shared contract test parameterised over the
implementation, run twice: once against Prisma/Postgres, once against a real
SharePoint site (a dedicated test site — SharePoint has no meaningful local
emulator; budget for this). Divergence is a bug in the SharePoint implementation,
by definition.

Additionally, SharePoint-only tests: ETag conflict handling (force a 412,
assert the 409 message is unchanged), paging correctness past the page size,
throttling backoff, and the WF04/WF05 → WF06 interruption case.

### 12.4 Throughout
- API contract tests asserting exact response bodies and status codes for all 43
  handlers — the guarantee that the 31 `fetch()` sites need no change.
- `next lint` and `tsc --noEmit` in CI (neither runs automatically today).
- Add a `.github/workflows` CI running lint, typecheck, and the Prisma-backed
  suite on every push. Small, and currently absent.

---

## Phased implementation plan

Nothing below is authorised by this document. Each phase is a separate decision.

| Phase | Work | Exit criteria |
|---|---|---|
| **0. Test harness** | Vitest + dockerised Postgres + CI; write the §12.1 characterisation suite against current Prisma code. **No production code changes.** | Suite green on `main`, CI running, WF01–WF06 + AWF01–AWF03 + all business rules covered |
| **1. Introduce the boundary** | Define §1 interfaces; implement `PrismaRepositories`; migrate all 104 call sites; `transition()` backed by `$transaction`. Behaviour-neutral by construction. | Phase 0 suite passes **unedited**; no route or component diff beyond import/call swaps; response bodies byte-identical |
| **2. Provision SharePoint** | Create 7 lists per §5, indexes per §6, `Sites.Selected` app registration + site grant per §10. Infrastructure only. | Lists match `schema.prisma` field-for-field on review; indexes verified present; app can read and write only that site |
| **3. SharePoint implementation** | Build `SharePointRepositories` behind the same interfaces: Graph client, auth, ETag CAS, hydration, paging, throttling. Promote the suite to the §12.3 contract suite. | Contract suite green against both backends; SharePoint-only tests pass |
| **4. Data migration** | Export → transform → load → validate per §11, into a staging site first. | All §11.2 gates pass on staging; full-record diff clean; rehearsed twice |
| **5. Cutover** | Freeze writes, load production, flip `DATA_BACKEND=sharepoint`, keep Neon read-only. | App runs on SharePoint; rollback = one env var; validation period defined before starting |
| **6. Retire** | After the validation period: decommission Neon, remove the Prisma implementation. | Separate, deliberate cleanup — never bundled into Phase 5 |

**Phases 0 and 1 are on Vercel + Neon throughout and touch no Microsoft
service.** They are independently valuable: the repository boundary and a real
test suite are worth having even if the SharePoint migration is later deferred or
cancelled.

---

## Decisions needed before Phase 1

1. **WF01 single-create** (§8.3) — collapse create-then-route into one create in
   the already-routed state? Behaviour-preserving because the intermediate state
   is unobservable, but it is your call, not an implementation detail.
2. **WF06 reconciliation sweep** (§8.3) — is a Vercel cron acceptable as the
   repair mechanism for an interrupted WF04/WF05 → WF06 hand-off?
3. **App-identity audit trail** (§2, §10.4) — accept that SharePoint's
   Created/Modified By shows the application, with human attribution living only
   in the app's own columns?
4. **`Users` stays a SharePoint list** (§2) — confirm identity is explicitly out
   of scope for this migration.
5. **Lookup columns rejected in favour of cuid text columns** (§7) — confirm.
6. **Drop `updatedAt`** in favour of SharePoint's native `Modified` (§5) —
   confirm nothing reads it.
7. **`Title` column policy** across all seven lists (§5).
8. **Test-site budget** (§12.3) — a dedicated SharePoint site for CI, since no
   local emulator exists.

---

*Design document. No application code, schema, configuration, or UI was modified.*
