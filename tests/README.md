# Phase 0 — behaviour characterisation tests

These tests exist to answer one question during the SharePoint migration:

> Did the change alter how Parkspace behaves?

They were written **against the current Prisma/Neon implementation, before any
refactoring**, so they describe what the application does today rather than what
a later design assumes it does. Every later phase must keep them passing
**unedited**. A test that needs editing is a behaviour change, and needs a
deliberate sign-off rather than a quiet commit.

See `MIGRATION_ARCHITECTURE.md` §12 for how the suite is used in Phases 1 and 3.

## Running

```bash
cp .env.test.example .env.test    # point it at a THROWAWAY database
createdb parkspace_test
npm run test:db:push              # apply prisma/schema.prisma to that database
npm test
```

`npm run test:watch` re-runs on change.

## Safety

The suite truncates every table before each test, so it has three guards
against ever pointing at a real database:

1. `TEST_DATABASE_URL` is a **separate variable** from the app's `DATABASE_URL`,
   and is never defaulted — a missing value fails the run.
2. `tests/helpers/db.ts` refuses to truncate unless the database name contains
   `test`.
3. `scripts/test-db-push.mjs` applies the same name check before pushing schema.

## Layout

| Path | Covers |
|---|---|
| `tests/helpers/` | Database reset, safety guards, factories |
| `tests/workflows/wf01-submit.test.ts` | WF01, BR-001/002/003, intake date rules |
| `tests/workflows/wf02-prepare.test.ts` | WF02 edit + endorse, edit-window guards |
| `tests/workflows/wf03-decide.test.ts` | WF03 approve/reject, rate snapshot, BR-004 |
| `tests/workflows/wf04-wf05-wf06.test.ts` | WF04, WF05, BR-006 independence, BR-007 |
| `tests/workflows/availability.test.ts` | Derived date-overlap availability |
| `tests/workflows/revert-and-cancel.test.ts` | Developer revert, cancellation rules |
| `tests/workflows/access-workflows.test.ts` | AWF01–AWF03 and access cancellation |
| `tests/lib/` | Totals, guest resolution, account deletion, queues, login refusals, schemas |

## Conventions

- Tests exercise the **real** workflow functions and the real Prisma client —
  nothing is mocked. The point is to characterise actual behaviour.
- Error assertions check the HTTP `status` **and** the message text, because
  both reach the user through `handleApiError`.
- Event-log assertions check `workflow`, `fromStatus`, `toStatus`, `actorId` and
  `note`, since the audit trail is itself a preserved behaviour.
