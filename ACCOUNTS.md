# Accounts, Roles & Authentication

None of this is in `ARCHITECTURE.md` — the source doc doesn't cover login at
all beyond implying `REQUESTER` (never logs in) and the now-retired
`CASHIER`. Everything below is a build-time addition, documented here
instead of scattered across commit messages.

## Roles

| Role | Logs in? | Granted via | Purpose |
|---|---|---|---|
| `REQUESTER` | Never | Auto-created guest row on public submission (`src/lib/guest.ts`) | Satisfies the `requesterId`/intake foreign keys on a public form submission. Not a real account — unusable random password hash, blocked at login regardless. |
| `CASHIER` | Never (retired) | — | Historical only. WF04 payment confirmation moved to Prepared By; `CASHIER` is blocked at login but old `RequestEvent` rows may still carry it so the Timeline displays correctly. |
| `PREPARED_BY` | Yes | Developer (Add/Invite/Edit Role) | WF02 prepare/endorse, WF04 payment confirmation, can edit intake fields while `In Preparation`. |
| `VALIDATED_BY` | Yes | Developer | WF03 approve/reject decision. |
| `PARKING_MANAGEMENT` | Yes | Developer | WF05 slot assignment. |
| `DEVELOPER` | Yes | Direct DB update for the first one; an existing Developer via Edit Role after that | Admin role — see [The Developer role](#the-developer-role) below. **Not** a peer of the 3 workflow roles: does not grant WF02/WF03/WF04/WF05/cancel actions. Never combinable with other roles (see [Multi-role login](#multi-role-login)). Deliberately excluded from every self-service/staff-facing role dropdown except Edit Role — granting it is always a deliberate, one-off action. |

`PREPARED_BY`, `VALIDATED_BY`, and `PARKING_MANAGEMENT` are collectively
`STAFF_ROLES` in `src/lib/types.ts`. `ASSIGNABLE_ROLES` is `STAFF_ROLES` plus
`DEVELOPER` — every role a Developer can actually assign to an account.

## How an account gets created

All three paths are in `src/app/api/accounts/`. **All account creation is
now Developer-only** — this was open to any staff member earlier in the
project's life and was deliberately locked down once the Developer role
existed to own it properly (`POST /api/accounts` and
`POST /api/accounts/invite` both call `requireRole("DEVELOPER")`).

### 1. Direct create (`CreateAccountForm`, `/accounts`)

Developer types a name, email, and a temporary password directly. The
account is created already confirmed (`emailVerifiedAt` set immediately) —
no email round-trip, since the Developer is vouching for it in person. The
Developer communicates the temp password to the person out of band (Teams,
phone, in person); they're expected to change it via `/account` afterward.

### 2. Invite by email (`InviteStaffForm`, `/accounts`)

Developer enters one or more `{ name, email, role }` rows and sends. Each
invitee gets an email (via Resend, see [Environment
variables](#environment-variables)) with a link to `/accept-invite?token=…`
where **they** set their own password — nobody but the invitee ever knows
it. Until accepted, the account exists but can't log in
(`passwordHash` is an unusable random hash — see `src/lib/password.ts`,
`hasPassword: false`).

### 3. Self-service signup (`/signup`, public, no login required)

Domain-gated: only email addresses whose domain is on the
`ALLOWED_SIGNUP_EMAIL_DOMAINS` allowlist can register at all
(`src/lib/signup.ts`) — anything else is rejected before the uniqueness
check even runs. Self-signup accounts always land as `PREPARED_BY`; domain
match alone isn't proof someone should hold a higher role, so anything
beyond that still requires a Developer to grant it via Edit Role. Requires
clicking a confirmation link emailed to the address they typed, proving
they actually control that mailbox — see [Email
confirmation](#email-confirmation--the-hasPassword-flag) below.

## Login & session

Custom auth — `jose` (HS256 JWT), httpOnly cookie `parking_session`, 8h
TTL, `bcryptjs` password hashing (10 salt rounds). No third-party auth
provider. `src/lib/auth.ts` (`createSession`/`getSession`/`requireSession`/
`requireRole`), login route at `src/app/api/auth/login/route.ts`.

Login is refused (all checked in order, in the login route) if:
- credentials don't match (`bcrypt.compare` against `passwordHash`)
- role is `REQUESTER` or `CASHIER`
- `emailVerifiedAt` is null (unconfirmed signup, or an invite not yet
  accepted — see below)
- `active` is `false` (deactivated by a Developer)

**Change Password** (`/account`, `ChangePasswordForm`) — any logged-in
account, no email dependency: verifies the current password via
`bcrypt.compare`, requires ≥8 characters for the new one.

**Forgot Password is intentionally not built.** It needs an out-of-band
delivery channel — decided early on to hold it until real email sending
existed, and even now that Resend is wired up for confirmation/invite
email, a self-service reset flow hasn't been requested. A Developer can
always deactivate a locked-out account and re-invite the person, or use
Edit Role/direct DB access as a manual fallback.

## Multi-role login

A workaround for "real" multi-role support (one session with combined
permissions), chosen because that would mean touching every
`session.role === "X"` check in the app — dozens of call sites across
workflows, the dashboard, and every page. This instead keeps
`SessionPayload.role` a single value, exactly as every existing check
already assumes:

- `User.roles` (`String[]`, e.g. `["PREPARED_BY", "PARKING_MANAGEMENT"]`)
  holds the full set of roles an account can log in as. `User.role`
  (singular) stays as the default/primary — shown in list views,
  pre-selected in the picker, and what every pre-existing single-role
  account already had before this field existed (`roles` falls back to
  `[role]` wherever it's empty, so nothing changed for existing accounts).
- On login, if `roles.length > 1` and no role was chosen yet, the server
  responds `{ multiRole: true, roles }` **without** creating a session
  (password is already verified at this point — the client doesn't
  re-prompt for it). The login page shows a "Choose Access Point" picker
  (same visual pattern as the System selector) and resubmits the same
  credentials plus the chosen `selectedRole`.
- **Developer is always exclusive** — never combinable with the 3 workflow
  roles. Checking it in Edit Role's checkbox group clears/disables the
  others and vice versa; enforced again server-side in
  `POST /api/accounts/[id]/role` (rejects a submission containing
  `DEVELOPER` alongside anything else).
- Assigning more than one role only happens via **Edit Role** on
  `/accounts` (Developer-only, can't target your own account). Direct
  create and Invite still only assign a single role at creation time —
  add a second one afterward via Edit Role.

## Email confirmation & the `hasPassword` flag

Two different flows both leave `emailVerifiedAt` null, and need two
different "resend" emails — `User.hasPassword` (default `true`) is what
tells them apart:

| | `hasPassword` | Has a real password? | Resend sends | Consumed at |
|---|---|---|---|---|
| Self-signup, unconfirmed | `true` | Yes — chosen at `/signup` | A **confirm** link | `GET /api/auth/verify-email` — sets `emailVerifiedAt`, done |
| Invited, not accepted | `false` | No — unusable placeholder hash | An **invite** link | `POST /api/auth/accept-invite` — sets a real password *and* `emailVerifiedAt` |

Getting this backwards would be a real bug: sending a confirm link to an
invited-but-unaccepted account would mark it verified without ever
collecting a real password, permanently stranding it (unusable hash,
no remaining token). `POST /api/auth/resend-confirmation` branches on
`hasPassword` to send the right one; `verify-email` and `accept-invite`
each also refuse to consume the other flow's token as defense in depth.
`resend-confirmation` always returns the same generic response regardless
of whether the account exists, to avoid leaking which emails are
registered.

Direct-create and staff-added-via-invite-acceptance accounts have
`hasPassword: true` set the moment they can log in; there's nothing to
distinguish there.

## The Developer role

Everything below requires `requireRole("DEVELOPER")` server-side, not just
a hidden UI element — every route re-checks independently of what the page
renders.

- **Deactivate / Reactivate** (`/api/accounts/[id]/deactivate`,
  `.../reactivate`) — flips `active`. Disables login without deleting the
  row, so every request/event that account is attached to stays intact.
  Can't deactivate your own account.
- **Edit Role** (`/api/accounts/[id]/role`) — checkbox group, see
  [Multi-role login](#multi-role-login). Can't edit your own role (same
  self-lockout protection as deactivate/delete — if you're the only
  Developer and need to change your own role, that still needs a direct
  DB update).
- **Permanently delete an account** (`/api/accounts/[id]/delete`) — a real
  hard delete, unlike deactivate. Only succeeds if the account has **zero
  workflow history**: never submitted/prepared/validated/rejected/
  confirmed-payment/assigned-slot on a request, never authored a
  `RequestEvent`, and the same across the parallel Parking Access system.
  Checked via `getAccountHistoryBreakdown` (`src/lib/accountDeletion.ts`);
  the error names exactly what's still attached (e.g. "3 request
  timeline event(s), 1 parking space(s) they added") rather than a generic
  refusal, so there's never a mystery about why. **Attribution-only**
  fields — `RateTableEntry.createdBy` and `ParkingSpace.createdBy`, i.e.
  "who added this row" — deliberately do **not** block deletion; they're
  nulled out in the same transaction as the delete instead, since they
  represent nothing about the account's involvement in an actual workflow.
  Can't delete your own account.
- **Revert a request one phase backward**
  (`/api/requests/[id]/revert-phase`, `wfDevRevertPhase` in
  `src/lib/workflows.ts`) — only defined for the 3 statuses reached via
  exactly one forward transition:

  | From | Reverts to | Also clears |
  |---|---|---|
  | `Pending Approval` | `In Preparation` | `preparedById` |
  | `Approved` | `Pending Approval` | `approvalDecision`, `validatedById`/`validatedDate`, the WF03 rate snapshot (`rateVersionId`/`rateAmountSnapshot`/`rateSnapshotDate`/`totalPaymentDue`), and — since neither track is valid outside the `Approved` window — the payment track (back to `Not Started`, clearing `cashierId`/`payDate`/`officialReceiptReference`) and the slot track (back to `Unassigned`, clearing `assignedSlot`/`parkingSpaceId`/`slotAssignmentDate`/`assignedById`) |
  | `Completed` | `Approved` | Only `completedDate` — payment/slot stay intact, since they're what legitimately triggered completion |

  `In Preparation` is deliberately **not** revertible — it's reachable from
  two different transitions (WF01's initial routing *and* WF03's reject
  loop), so there's no single well-defined phase to revert to.
  `Submitted` is never actually observed at rest (WF01 fires instantly on
  creation). `Cancelled` is terminal. Every revert logs a `RequestEvent`
  (`workflow: "DEV_REVERT"`) same as any other transition.
- **Permanently delete a request** (`/api/requests/[id]/delete`) — unlike
  Cancel (sets `Status = "Cancelled"`, keeps the row for the audit trail),
  this actually removes the request and its `RequestEvent` rows. No
  history restriction needed — a request's own events are the only thing
  that reference it, so nothing else can be orphaned. Meant for clearing
  out trial/test data, not a normal workflow action.
- **Add/remove access to Rate Table and Parking Location** — Developer is
  in the `MAINTAINERS` list for both, same as the 3 workflow roles, so it
  can add entries/spaces too, not just delete them. Plus a
  Developer-only **hard delete** neither role normally gets:
  - `POST /api/rate-table/[id]/delete` — the one exception to Rate
    Table's append-only rule (Section 7). Blocked if any request ever
    snapshotted that exact version (`ParkingRequest.rateVersionId`).
  - `POST /api/parking-spaces/[id]/delete` — distinct from the existing
    soft "Remove" (which only flips `isActive` false and keeps the row).
    Blocked if **any** request, past or present, ever referenced the
    space — Remove only checks *current/upcoming* bookings, so a
    space can be soft-removed yet still block a hard delete.

## Environment variables

Needed for self-service signup confirmation and staff-invite email to
actually send (without them, accounts still get created — the email just
fails to go out, surfaced as an error asking to use "Resend confirmation
email" once configured):

| Variable | Purpose | Notes |
|---|---|---|
| `RESEND_API_KEY` | Auth to [Resend](https://resend.com) | Free tier (3,000/month) is enough. Create the account, verify a sending domain, generate a key with **Sending access** only. |
| `EMAIL_FROM` | Sender shown on outgoing mail | e.g. `Parking Pro Inc. <noreply@parkingproinc.com>` — the domain after `@` must be verified in Resend; the display name before `<...>` is arbitrary. Defaults to Resend's shared `onboarding@resend.dev`, which only delivers to the Resend account owner's own inbox (fine for testing, not real signups). |
| `APP_URL` | Base URL for links inside emails | e.g. `https://parking-space-ten.vercel.app`. Falls back to Vercel's auto-injected `VERCEL_URL`, then `localhost:3000`, if unset. |
| `ALLOWED_SIGNUP_EMAIL_DOMAINS` | Comma-separated domain allowlist for `/signup` | Case-insensitive, matched against the part after `@`. Defaults to `filinvestcity.com,parkingproinc.com` in code if unset. |

**Domain verification note:** a Resend account can verify multiple domains
at once — no need for separate Resend accounts per domain. Each domain
needs its own DNS records (SPF/DKIM, usually 3) added wherever that
domain's DNS is managed; if DNS access is restricted, signup/invite email
simply won't deliver for that domain until it's verified. `/accounts` has a manual **Activate** action
(`POST /api/accounts/[id]/activate`, any logged-in staff member — not
Developer-restricted, since it predates that role) as a stopgap: vouch for
a pending signup/invite in person instead of waiting on an email that
can't be delivered. For an invited-but-unaccepted account this also
requires setting a temp password inline, since there's no link for the
invitee to set their own.

## Schema migration history

Every schema change after the initial `db:push` was applied by hand as raw
SQL in Neon's SQL Editor (no `prisma migrate` — see the root README's
"Getting started" for why: this project has no way to run CLI commands
against the production database directly). In order:

```sql
-- Email confirmation for self-service signup
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerificationToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerificationTokenExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "User_emailVerificationToken_key" ON "User"("emailVerificationToken");
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;

-- Distinguishes invited-pending from self-signup-unconfirmed accounts
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hasPassword" BOOLEAN NOT NULL DEFAULT true;

-- Deactivate/reactivate (Developer role)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;

-- Attribution-only fields must not block account deletion
ALTER TABLE "RateTableEntry" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "ParkingSpace" ALTER COLUMN "createdById" DROP NOT NULL;

-- Multi-role login workaround
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "roles" TEXT[] NOT NULL DEFAULT '{}';
```

Running the whole block at once is safe even if some statements already
applied earlier — every `ADD COLUMN`/`CREATE INDEX` uses `IF NOT EXISTS`.
The two `ALTER COLUMN ... DROP NOT NULL` lines aren't guarded that way
(Postgres has no `IF EXISTS` equivalent for that specific operation) but
are themselves idempotent — re-running them on an already-nullable column
is a no-op, not an error.
