# Parking Space Request Automation — Full Project Documentation

**Prepared:** for external review/validation
**Repo:** https://github.com/Strat-Innov/Parking-Space (branch `main`)
**Live deployment:** Vercel, connected to a Neon (serverless Postgres) database
**Source spec:** `ARCHITECTURE.md` in the repo root — the frozen "Parking Space Request Automation — Architecture Review & Realignment" document (originally written against Microsoft Lists + Power Automate). This build is a from-scratch reimplementation of that spec as a standalone web app, not a port of any existing code. It only covers the **Parking Space** system (§6–11 below); everything else in this document — Parking Access, the accounts/roles system, exports — is a build-time addition with no equivalent in that doc.

This document describes what is **actually live and working** in the current codebase. Anything deferred or not built is called out explicitly in §16 rather than presented as functional.

---

## 1. What this is

Two parallel intake-and-approval systems, sharing the same staff accounts/roles but otherwise independent:

- **Parking Space** — a **fork-join workflow**: a strictly sequential path from submission through approval, which then forks into two **independent** parallel tracks (Payment and Slot Assignment) that must **both** complete before the request is marked Completed.
- **Parking Access** (RFID/Card/Metal Tag enrollment) — a simpler **linear** workflow digitizing a separate paper form, added later in the project (§9).

Both accept public submissions (meant to be reached via a QR code — no login required) and are processed by internal staff through a fixed pipeline.

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router, TypeScript, Turbopack) | Server components for pages, Route Handlers for the API |
| Database | PostgreSQL (via Neon, serverless) | Vercel's serverless functions have no writable persistent filesystem, so a file-based DB was never an option for production |
| ORM | Prisma 5 | Schema fields are plain `String` rather than native Prisma enums; allowed values enforced in code (`src/lib/types.ts`) |
| Auth | Custom — `jose` (signed HS256 JWT) + `bcryptjs` (password hashing) | No third-party auth provider. Session stored as a signed httpOnly cookie, 8-hour expiry |
| Email | `resend` (Resend API) | Account confirmation and staff-invite email only — see §10. Requires `RESEND_API_KEY` + a verified sending domain to actually deliver |
| Validation | `zod` | |
| Styling | Tailwind CSS | `darkMode: "class"`, full light/dark support app-wide, default follows system preference |
| PDF export | `pdf-lib` | Genuine fillable AcroForm PDFs, not flattened text — see §11 |
| XLSX export | `exceljs` | Chosen over `xlsx`/SheetJS, which has open high-severity CVEs |
| Date/month math | `date-fns` | Calendar-accurate month counting and calendar-day comparisons (see §7) |

No payment gateway integration (payment confirmation is manually recorded by staff, not processed online), no queueing/background jobs, no SMS.

---

## 3. Data model

Seven Prisma models, all in `prisma/schema.prisma`. Fields use plain `String` rather than native enums by convention — allowed values are enforced in `src/lib/types.ts`, not the database schema.

### `User`

Staff accounts **and** lightweight "guest" records auto-created for anonymous public submitters (§8).

| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `name`, `email` (unique), `passwordHash` | String | bcrypt hash. Guest/anonymous requestor records get a random unusable hash — never meant to log in |
| `role` | String | `REQUESTER` \| `PREPARED_BY` \| `VALIDATED_BY` \| `PARKING_MANAGEMENT` \| `DEVELOPER` — the account's default/primary role (see `roles` below) |
| `roles` | String[] | The full set of roles this account can log in as, for accounts holding more than one. Empty for single-role accounts (falls back to `[role]`). See §10.4 |
| `active` | Boolean | Login-capable accounts only; a Developer can deactivate without deleting |
| `emailVerifiedAt`, `emailVerificationToken`, `emailVerificationTokenExpiresAt` | DateTime?/String?/DateTime? | Email confirmation — see §10.3 |
| `hasPassword` | Boolean | Distinguishes an invited-not-yet-accepted account from a self-signup-unconfirmed one — see §10.3 |
| `createdAt` | DateTime | |

### `ParkingRequest` (the core entity)

**Intake fields** (submitted by the requestor, editable by Prepared By while `Status = "In Preparation"`, locked thereafter): `fullName`, `companyName`, `emailAddress`, `serviceType` (`Hourly`\|`Daily`\|`Monthly`), `preferredParkingLocation`, `requestedSlot` (optional — the requestor's *preference*, not the authoritative assignment), `dateOfRequest` (system-set, BR-003), `requiredStartDate`, `endDate` (full `DateTime`, see §7), `purpose`.

**Primary lifecycle:** `status` (`Submitted`\|`In Preparation`\|`Pending Approval`\|`Approved`\|`Completed`\|`Cancelled` — no `Rejected` value, see BR-004), `approvalStage` (`Prepared By`\|`Validated By`\|`Post-Approval`\|`Completed`).

**Independent parallel tracks (BR-006):** `paymentStatus` (`Not Started`\|`Pending`\|`Confirmed`), `slotStatus` (`Unassigned`\|`Assigned`).

**WF02:** `preparedById`. **WF03:** `validatedById`, `approvalDecision`, `validatedDate`, plus reject-branch audit (`rejectionCount`, `rejectionReason`, `rejectedById`, `rejectedDate`). **WF04:** `cashierId` (name kept for history — see §4), `payDate`, `officialReceiptReference`. **WF05:** `assignedSlot` (human-readable snapshot), `parkingSpaceId` (real FK, see §9.1), `slotAssignmentDate`, `assignedById`.

**Computed:** `totalHours`/`totalDays`/`totalMonths`. **Rate integrity:** `rateVersionId`, `rateAmountSnapshot`, `rateSnapshotDate`, `totalPaymentDue` — written once, at WF03 approval. **Completion:** `completedDate` (WF06 only). **Relations:** `requesterId` (required FK to `User`).

### `RateTableEntry`

Append-only. `serviceType`, `chargingModel`, `rateAmount`, `effectiveStartDate`, `effectiveEndDate` (display only), `createdById` (nullable — attribution only, see §10.5), `createdAt`.

### `ParkingSpace`

Mutable inventory (unlike Rate Table). `location`, `slotNumber`, `isActive` (soft-remove flag), `createdById` (nullable, attribution only), `createdAt`. See §9.1.

### `RequestEvent`

Append-only audit log, one row per Parking Space workflow transition. `requestId`, `workflow` (`WF01`–`WF06`, `CANCEL`, or `DEV_REVERT`), `fromStatus`, `toStatus`, `actorId`, `note`, `createdAt`.

### `AccessRequest` / `AccessRequestEvent`

The Parking Access system's own models, structurally parallel to `ParkingRequest`/`RequestEvent` but for the simpler linear workflow — see §9.

---

## 4. Roles

| Role (internal key) | Display label | Logs in? | Owns |
|---|---|---|---|
| `REQUESTER` | Requestor | Never | Nothing — auto-created guest row on public submission (§8), not a real account |
| `CASHIER` | Cashier | Never (retired) | Historical only — WF04 moved to Prepared By (see below). Old `RequestEvent` rows may still carry it so the Timeline displays correctly; blocked at login |
| `PREPARED_BY` | Prepared By | Yes | WF02 endorse, WF04 payment confirmation, intake edits while `In Preparation` |
| `VALIDATED_BY` | Validated By | Yes | WF03 approve/reject |
| `PARKING_MANAGEMENT` | Parking Management | Yes | WF05 slot assignment; Rate Table/Parking Location maintenance |
| `DEVELOPER` | Developer | Yes | Admin role — account management + Rate Table/Parking Location cleanup + request phase-revert. **Not** a peer of the 3 workflow roles above; grants none of their actions. See §10.5 |

**`CASHIER` is retired.** This actively overrides the architecture doc's Section 3 table (`WF04 Owner: Cashier`) — a deliberate later decision, not a gap the doc left open. There's no standalone Cashier dashboard queue anymore; `wf04ConfirmPayment` requires `PREPARED_BY` and is a plain field edit (Official Receipt Reference + Pay Date) on the request's Payment Track card once `Status = "Approved"`. BR-006 independence is unaffected — WF04 and WF05 still never read each other's track, they're just no longer split across two different roles.

Accounts, multi-role login, and the full Developer capability set are covered in §10; see also [`ACCOUNTS.md`](./ACCOUNTS.md) for the deep dive (schema migration history, exact env vars, per-transition revert rules).

---

## 5. Business Rules (BR-001–BR-008) and enforcement

| Rule | Statement | Enforced |
|---|---|---|
| **BR-001** | No backdating — Required Start Date ≥ Date of Request | `validateIntakeFields()` in `src/lib/workflows.ts` |
| **BR-002** | Advance requests only — Required Start Date on a later **calendar day** than Date of Request (`date-fns startOfDay()` comparison, not raw timestamp — see §7) | same function |
| **BR-003** | Requestor loses all edit rights the instant the item is submitted, no exceptions including rejection loops | `Date of Request` is system-set server-side; no requestor-facing edit endpoint exists. (Staff — specifically Prepared By — *can* edit while `In Preparation`, §9.2; not a BR-003 exception, since BR-003 only revokes the *requestor's* rights) |
| **BR-004** | Rejection returns the same item to `In Preparation`/`Prepared By`; no duplicate ever created; requestor never re-involved | `wf03Decide()` reject branch — same row updated, `rejectionCount` incremented |
| **BR-005** | No path to `Completed` without `Payment Status = Confirmed` | Only `wf06CheckCompletion()` writes `Completed`, and it requires both tracks |
| **BR-006** | Payment and Slot Assignment are peer processes; neither is a prerequisite for the other | `wf04ConfirmPayment()` and `wf05AssignSlot()` each only read/write their own track, both independently hand off to `wf06CheckCompletion()` |
| **BR-007** | `Completed` iff both Payment Confirmed AND Slot Assigned, evaluated by exactly one workflow | `wf06CheckCompletion()` is the **sole** writer of `Status = "Completed"` |
| **BR-008** | `Status` never encodes ownership; `Approval Stage` never encodes lifecycle progress | Two disjoint enums (`STATUSES`, `APPROVAL_STAGES`); no `Current Owner` field exists anywhere |

---

## 6. Workflow engine (WF01–WF06)

One function per workflow in `src/lib/workflows.ts`, each the **sole writer** of its documented transition.

| | Trigger | Owner | Entry | Exit |
|---|---|---|---|---|
| **WF01** Route for Review | Item created | System | `Submitted` | `→ In Preparation`, fires instantly inside `submitRequest()` — never observed at rest |
| **WF02** Prepared By Validation | Endorse | Prepared By | `In Preparation` | `→ Pending Approval`, `Approval Stage → Validated By` (`wf02EndorseForValidation()`) |
| **WF03** Approval Decision | Decision | Validated By | `Pending Approval` | Approve → `Approved`, `Post-Approval`, rate snapshot written; Reject → `In Preparation`, `Prepared By`, rejection audit written (`wf03Decide()`) |
| **WF04** Payment | `Status = Approved` | Prepared By | `Approved` | `Payment Status → Confirmed` (`wf04ConfirmPayment()`) |
| **WF05** Slot Assignment | `Status = Approved` | Parking Management | `Approved` | `Slot Status → Assigned` (`wf05AssignSlot()`) |
| **WF06** Completion Check | Either track changes | System (automatic) | Either track just changed | `→ Completed` only if **both** tracks done (`wf06CheckCompletion()`, internal — not its own route, called from the end of WF04 and WF05) |

**Cancellation** (`cancelRequest()`): reachable from any non-terminal state, permitted for any staff role other than Prepared By.

**Developer phase-revert** (`wfDevRevertPhase()`) is a build-time addition, not part of the original numbered workflows — see §10.5.

---

## 7. Date/time handling

Not specified at this granularity in the original spec — real-world use surfaced the need:

- **Hourly**: independent Start Time/End Time pickers.
- **Daily/Monthly**: a single "Time" field is collected once and mirrored onto both the start and end timestamps, so a booking is a genuine 24-hour-from-check-in cycle, not implicit midnight-to-midnight.
- **Monthly minimum span**: End Date must be ≥1 calendar month after Start Date (`date-fns addMonths()`).
- **Monthly total**: calendar-month-aware counting (`differenceInCalendarMonths`), not `days ÷ 30`.
- **BR-002 comparison** uses `startOfDay()` on both sides specifically so a same-day-but-later timestamp doesn't slip through as "advance."

---

## 8. Public submission model

Both intake forms are public and reachable with no login (meant for a QR code):

- `POST /api/requests` (Parking Space) and `POST /api/access-requests` (Parking Access) both accept anonymous submissions.
- An anonymous submission resolves a requester by finding-or-creating a lightweight "guest" `User` row (`src/lib/guest.ts`, shared by both systems), matched by email, with a random unusable password hash — satisfies the FK without granting real login access, consistent with BR-003.
- Staff roles are blocked from submitting through either public endpoint.
- The two public forms (`/requests/new`, `/access/new`) cross-link to each other in case someone lands on the wrong one.

---

## 9. Parking Access (RFID/Card/Metal Tag enrollment)

A second, parallel request type digitizing a different paper form ("Enrollment for Parking ACCESS", PPI Form2_Rev4_7) — **not** described in `ARCHITECTURE.md` at all, and a deliberately simpler linear flow rather than Parking Space's fork-join structure:

```
Submitted → Processed (Parking Management validates/endorses and issues
the access in one combined step, matching the form's single combined box)
→ Completed (client confirmed receipt)
```

(or `Cancelled` from either non-terminal state). Own Prisma models (`AccessRequest`, `AccessRequestEvent`), own lib (`src/lib/access-types.ts`, `access-validation.ts`, `access-workflows.ts`), own routes under `/api/access-requests`, own pages (`/access/new`, `/access/dashboard`, `/access/[id]`).

**Same staff accounts work both systems** — the "System" selector on the login page (and the "Switch to…" link in the nav bar once logged in) only decides which dashboard you land on first, not a separate permission set. Only Parking Management has anything to actually do (AWF02/AWF03), but every staff role can view it.

The "APPROVED BY: Requestor's Authorized Approver Only" line is captured as a plain optional text field (`approverName`), not a workflow gate — that's someone at the *client's* company, and there's no login system for external companies to gate on.

### 9.1 Parking Location inventory (Parking Space only)

A build-time addition — the architecture doc's `Assigned Slot` was originally just free text typed in at WF05. Now backed by a real `ParkingSpace` inventory that staff (Prepared By/Validated By/Parking Management, plus Developer) can add to or remove from. Unlike the Rate Table, this list isn't append-only: removal is a soft `isActive` flag (blocked only while a space has a current or upcoming booking), so past assignments keep a valid reference. "Assigned or not" is deliberately not a static column — availability is derived per request by checking for any other non-cancelled booking whose date range overlaps (`findLockedSpaceIds()`), so a space is only locked for the exact period it's actually booked.

### 9.2 Prepared By's edit capability (Parking Space only)

Prepared By can correct the requestor's submitted intake fields while `Status = "In Preparation"` (`POST /api/requests/[id]/edit`, `updateRequestDetails()`) — not a BR-003 violation, since BR-003 only revokes the *requestor's* rights. Locked the instant the item is endorsed (WF02) or moves beyond. The Approval card (Validated By's decision fields) is hidden from Prepared By's view — that belongs to a stage they hand off to.

### 9.3 Rate Table

Append-only (Section 7 of the doc): a rate change is always a new row; existing rows are never edited. "Current rate" resolves as the newest row whose `effectiveStartDate` has passed. Snapshotted onto a request at the exact moment WF03 approves, never re-derived later. Maintenance access: Parking Management, Prepared By, Validated By, and Developer.

---

## 10. Accounts, roles & authentication

None of this is in `ARCHITECTURE.md`. Full depth (schema migration history, exact env vars, per-transition phase-revert rules) is in [`ACCOUNTS.md`](./ACCOUNTS.md) — this section is the summary.

### 10.1 Session & login

Custom auth, no third-party provider — `jose` (HS256 JWT), httpOnly cookie `parking_session`, 8h TTL, `bcryptjs` (10 salt rounds). Login (`POST /api/auth/login`) is refused if credentials don't match, role is `REQUESTER`/`CASHIER`, email isn't confirmed, or the account is deactivated.

**Change Password** (`/account`) works for any logged-in account today, no email dependency. **Forgot Password is explicitly not built** — deferred until there was a real reason to prioritize a self-service reset flow; a Developer can deactivate a locked-out account and re-invite, or use Edit Role/direct DB access as a manual fallback.

### 10.2 How an account gets created

**All three paths are Developer-only** (tightened partway through the project — originally open to any staff member):

1. **Direct create** (`/accounts`) — Developer sets a temp password directly; account is created already confirmed.
2. **Invite by email** (`/accounts`) — Developer enters `{name, email, role}` rows; each invitee gets an emailed link to set their own password.
3. **Self-service signup** (`/signup`, public) — domain-gated (`ALLOWED_SIGNUP_EMAIL_DOMAINS`), always lands as `PREPARED_BY`, requires clicking an emailed confirmation link.

Both email-dependent paths **require `RESEND_API_KEY` and a verified sending domain to actually deliver** — without it, the account still gets created, but the email fails to send (surfaced as an error). `/accounts` has a manual **Activate** action (any logged-in staff member) as a stopgap when email can't be delivered — a staff member vouches for the account in person instead.

### 10.3 Email confirmation mechanics

`User.hasPassword` distinguishes a self-signup-unconfirmed account (already has a real password, just needs to click a **confirm** link) from an invited-not-yet-accepted one (no real password yet, needs an **invite** link that also collects one). Getting this backwards would strand an account permanently, so `resend-confirmation` branches on it, and `verify-email`/`accept-invite` each refuse to consume the other flow's token.

### 10.4 Multi-role login

An account can hold more than one role (`User.roles`, e.g. Prepared By + Parking Management). A session still only ever activates **one** role at a time — if an account has multiple, login shows a "Choose Access Point" picker after verifying the password, and every existing role check elsewhere in the app is unaffected. `DEVELOPER` is always exclusive — never combined with the 3 workflow roles.

### 10.5 The Developer role

Admin-only capabilities, each independently enforced server-side (not just hidden UI):

- **Deactivate/reactivate** an account (login disabled, row kept).
- **Edit Role** — checkbox group, grants any combination of the 3 workflow roles, or Developer alone.
- **Permanently delete an account** — only if it has zero real workflow history (checked across every relevant relation in both systems); attribution-only fields (`RateTableEntry`/`ParkingSpace.createdBy`) don't block it, they're nulled out instead.
- **Revert a request one phase backward** — only defined for `Pending Approval`/`Approved`/`Completed` (each reached via exactly one forward transition); reverting from `Approved` also clears the payment/slot tracks and rate snapshot, since neither is valid outside that window.
- **Permanently delete a request** — unlike Cancel, actually removes the row and its event log. For clearing test/trial data.
- **Hard-delete a Rate Table entry or Parking Space** — the one exception to their normal append-only/soft-remove rules, blocked if any request ever referenced them.

---

## 11. Export

Every request detail page has its own PDF/CSV/XLSX download (`GET /api/requests/export`) — no scoping beyond "if you can see the page, you can export it." The dashboard's "Other Requests" table additionally supports search/filter, with the same three formats scoped to whatever's currently filtered. Always re-queries the database server-side rather than trusting rows already in the browser.

**The PDF is a genuine fillable AcroForm** (`src/lib/pdf/buildFillableForm.ts`, `pdf-lib`), not flattened/static text — every value sits in an actual form field, editable afterward in any PDF viewer. It replicates the original paper "PARKING SPACE REQUEST FORM" (PPI.SOF002_Rev.1).

---

## 12. Application routes

### Pages

| Route | Access | Purpose |
|---|---|---|
| `/login` | Public | Sign-in, including the multi-role picker step |
| `/signup` | Public | Self-service account creation, domain-gated |
| `/accept-invite` | Public (token-gated) | Set a password after being invited |
| `/requests/new` | Public | Parking Space intake (QR-code target) |
| `/access/new` | Public | Parking Access intake |
| `/dashboard` | Authenticated | Parking Space queue |
| `/requests/[id]` | Authenticated | Full detail — status, editable/read-only details, role-specific actions, payment/slot tracks, timeline, Developer actions |
| `/access/dashboard` | Authenticated | Parking Access queue |
| `/access/[id]` | Authenticated | Parking Access detail |
| `/rate-table` | Authenticated | List + maintain |
| `/parking-locations` | Authenticated | List + maintain |
| `/accounts` | Authenticated | Account list (all staff); create/invite/manage (Developer only) |
| `/account` | Authenticated | Change Password |

### API (all under `/api/`)

| Area | Routes |
|---|---|
| Auth | `auth/login`, `auth/logout`, `auth/change-password`, `auth/verify-email`, `auth/resend-confirmation`, `auth/accept-invite`, `auth/invite-info` |
| Accounts | `accounts` (GET/POST), `accounts/signup`, `accounts/invite`, `accounts/[id]/activate`, `.../deactivate`, `.../reactivate`, `.../delete`, `.../role` |
| Parking Space requests | `requests` (GET/POST), `requests/[id]`, `.../edit`, `.../prepare`, `.../decision`, `.../payment`, `.../slot`, `.../cancel`, `.../delete`, `.../revert-phase`, `requests/export` |
| Parking Access | `access-requests` (GET/POST), `access-requests/[id]`, `.../process`, `.../complete`, `.../cancel` |
| Rate Table | `rate-table` (GET/POST), `rate-table/[id]/delete` |
| Parking Space inventory | `parking-spaces` (GET/POST), `parking-spaces/bulk`, `parking-spaces/locations`, `parking-spaces/[id]/remove`, `.../delete` |

---

## 13. Deployment

- **Hosting**: Vercel, auto-deploys on push to `main`.
- **Database**: Neon Postgres (serverless).
- **Required env vars**: `DATABASE_URL`, `SESSION_SECRET` (always); `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`, `ALLOWED_SIGNUP_EMAIL_DOMAINS` (for email confirmation/invites to actually deliver — see [`ACCOUNTS.md`](./ACCOUNTS.md#environment-variables)).
- **Schema changes require a manual step against the production database** — Vercel's build step does not run migrations automatically, and there's no way to run `npx prisma db push` or `prisma migrate` against production from this project's normal workflow. Every schema change since initial setup has been applied as hand-written SQL through Neon's web SQL Editor — the full history is in [`ACCOUNTS.md`](./ACCOUNTS.md#schema-migration-history).

---

## 14. What's working vs. what isn't

### Working today
- Full Parking Space fork-join lifecycle (WF01–WF06), including cancellation and Developer phase-revert.
- Full Parking Access linear lifecycle.
- Public intake forms for both systems, cross-linked.
- Rate Table (append-only) and Parking Location inventory (mutable, date-range-aware availability).
- PDF/CSV/XLSX export, per-request and dashboard-scoped.
- Account creation (direct/invite/self-signup), Change Password, multi-role login, full Developer admin toolkit.
- Light/dark/system theme, applied app-wide.

### Working, but requires configuration
- **Email confirmation and staff-invite email** — the code is complete and correct, but delivery requires `RESEND_API_KEY` and a DNS-verified sending domain in Resend. Without that, accounts are still created; the confirmation/invite email just fails to send (surfaced as an error, with a manual **Activate** fallback on `/accounts`).

### Explicitly not built
- **Forgot Password** — deferred, no self-service reset flow exists.
- **Real multi-role sessions** — the login-time picker (§10.4) is a workaround; a session still only ever holds one active role, it does not combine permissions from several roles at once.
- **Workflow status notifications** (e.g. "your request was approved") — the only email sending in the app is account confirmation/invite; nothing emails a requestor or staff member about a request's progress.
- File/document attachments on a request.
- Rate limiting or CAPTCHA on either public submission endpoint.
- Automated test suite — verification has been manual/scripted end-to-end testing plus browser screenshots during development, not a committed test suite.
- Audit-log deduplication — an edit immediately followed by an endorse (which also saves first) can produce two near-identical "Details edited" events for the same change.
- A reason/justification field on cancellation — just a status flip to `Cancelled`.
