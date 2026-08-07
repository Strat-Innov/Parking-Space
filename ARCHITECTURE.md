# Parking Space Request Automation — Architecture Review & Realignment
## THINK + VALIDATE Pass — Frozen Business Rules Applied

**Phase:** Architecture Review (no Build artifacts produced)
**Baseline reviewed:** Parking_Request_MS_Lists_Architecture.md (prior Design-phase output)
**Trigger for this pass:** BR-001 through BR-008 supersede assumptions made in the baseline. Two prior open decisions (rejection behavior, rate table) are now frozen inputs, not open questions.

---

## 0. What Changed and Why (read this first)

The baseline treated the process as strictly sequential: Approved → Payment Pending → Payment Confirmed → Slot Assigned → Completed. **BR-006 breaks that assumption.** Slot Assignment and Payment are independent tracks with no ownership over each other — the baseline's linear chain is no longer accurate and would misrepresent the real process if carried into Build. That is the single largest structural change in this pass; everything else below is smaller and follows from it or from BR-001–005/007–008.

Second-largest change: **`Current Owner` as a single-value field stops working** once two roles (Cashier, Parking Management) can simultaneously hold open work on the same request. A field that can only hold one value can't honestly represent two concurrent owners — carrying it forward would reintroduce the exact inference problem the baseline was designed to eliminate. It's removed below, not modified.

---

## 1. Business Process Validation

| Frozen rule | Reflected in revised architecture? | How |
|---|---|---|
| BR-001 No Backdating | Yes | Validation gate at submission: `Required Start Date` ≥ `Date of Request` enforced before item can be created (Section 5). |
| BR-002 Advance Requests Only (no same-day) | Yes | Same gate, strict inequality: `Required Start Date` > `Date of Request`. |
| BR-003 Request Ownership | Yes | `Date of Request` becomes a system-set field (not Parker-entered), and all Parker-editable fields lock immediately on submission (Section 5, Security Model). |
| BR-004 Rejection Handling | Yes | Rejection is modeled as a loop within `Status`, not a terminal or branching state. No duplicate item. Rejection Count/Reason/By/Date added for audit (Section 8). |
| BR-005 Mandatory Payment | Yes | `Completed` cannot be reached unless `Payment Status = Confirmed` (Section 2, BR-007 logic) — there is no path around it. |
| BR-006 Slot Assignment order-independent | Yes | Payment and Slot Assignment restructured as two independent parallel tracks, both gated only on `Status = Approved` (Section 3). |
| BR-007 Completion = both confirmed | Yes | Dedicated join workflow (WF06) owns this check exclusively — see Section 3. |
| BR-008 Status ≠ Approval Stage | Yes, and reinforced | Approval Stage is now scoped only to the strictly sequential portion of the process, avoided from being asked to represent two simultaneous owners (Section 4). |

No workflow in the revised architecture violates a frozen rule. Service Type charging models (Hourly/Daily/Monthly) remain values within a single workflow engine, per the frozen business model — no branching engine was introduced.

---

## 2. Status Lifecycle — Revised

The baseline's linear chain is replaced with a **fork-join model**: one sequential path up to Approval, then two independent parallel tracks, joined only at Completion.

```
Submitted
   ↓
In Preparation ◄──────────────┐
   ↓                          │ (rejection loop — BR-004)
Pending Approval ──rejected───┘
   ↓ approved
Approved
   ├──────────────┬──────────────┐
   ▼              ▼              
Payment Track   Slot Track       (independent — BR-006)
Payment Status: │  Slot Status:
Not Started     │  Unassigned
   ↓             │     ↓
Pending          │  Assigned
   ↓             │
Confirmed ───────┴──────────────► Completed
                                   (only when BOTH confirmed — BR-007)

(Cancelled — reachable from any non-terminal state; unchanged from baseline)
```

**Status enum (revised):** `Submitted`, `In Preparation`, `Pending Approval`, `Approved`, `Completed`, `Cancelled`.

**`Rejected` is deliberately removed as a Status value.** Under BR-004, a rejection is not a resting state a request occupies — it's an instantaneous outcome that immediately reverts `Status` to `In Preparation`. Giving it its own Status value would create a state nothing ever actually rests in, which fails "no unnecessary columns/values" and — worse — would require a second field or process just to get back out of it. The rejection *decision itself* is captured properly as an outcome value (Section 4/8), which is the correct place for it.

**Why Payment and Slot don't get folded into `Status`:** doing so would force `Status` to represent every combination (Approved-Payment-Only, Approved-Slot-Only, Approved-Both) — a combinatorial explosion the baseline already avoided for Payment/Slot sub-states, and BR-006 makes that avoidance mandatory rather than just tidy. `Payment Status` and `Slot Status` stay as independent fields; `Status` only ever reflects the primary lifecycle position.

---

## 3. Workflow Architecture — Revised

| | WF01 Route for Review | WF02 Prepared By Validation | WF03 Approval Decision | WF04 Payment Processing | WF05 Slot Assignment | WF06 Completion Check *(new)* |
|---|---|---|---|---|---|---|
| **Owns exactly one transition** | Submitted → In Preparation | In Preparation → Pending Approval | Pending Approval → Approved **or** → In Preparation (reject) | Payment Status → Confirmed | Slot Status → Assigned | Status → Completed |
| **Trigger** | Item created | Prep-complete action | Approval decision recorded | `Status` = Approved | `Status` = Approved | `Payment Status` changes **or** `Slot Status` changes |
| **Owner** | System | Prepared By | Validated By | Cashier | Parking Management | System (automated) |
| **Entry Criteria** | `Status` = Submitted | `Status` = In Preparation | `Status` = Pending Approval | `Status` = Approved | `Status` = Approved | Either `Payment Status` = Confirmed or `Slot Status` = Assigned just occurred |
| **Exit Criteria** | `Status` → In Preparation | `Status` → Pending Approval | `Status` → Approved, or `Status` → In Preparation + Rejection Count +1 | `Payment Status` → Confirmed | `Slot Status` → Assigned | `Status` → Completed, only if **both** `Payment Status` = Confirmed **and** `Slot Status` = Assigned |
| **Fields Updated** | Status, Approval Stage | Status, Approval Stage | Status, Approval Stage, Approval Decision, Validated By, Validated Date, (on reject: Rejection Count, Rejection Reason, Rejected By, Rejected Date) | Payment Status, Cashier, Pay Date, Official Receipt Reference | Slot Status, Assigned Slot, Slot Assignment Date, Assigned By | Status, Completed Date |
| **Notifications** | Notify Prepared By | Notify Validated By | Notify Cashier + Parking Management (approve) / notify Prepared By (reject) | Notify WF06 path (system-internal) | Notify WF06 path (system-internal) | Notify requester (completion) |

**Critical structural point:** WF04 and WF05 both trigger independently off `Status = Approved` — neither waits for, checks, or updates the other. This is what makes BR-006 architecturally true rather than just asserted. **WF06 is the only workflow permitted to write `Status = Completed`**, and it's the only workflow that reads both `Payment Status` and `Slot Status` together. This centralizes the BR-007 join logic in exactly one place — without WF06, that "check both" logic would otherwise have to be duplicated inside both WF04 and WF05, which is precisely the duplication the frozen principles rule out.

**Recommendation — WF03 restructuring:** the baseline's WF03 produced a terminal-feeling "Rejected" exit. Revised WF03 has two exits, both well-defined: Approved (moves forward) or Rejected-loop (returns to In Preparation with audit fields incremented). No new workflow is needed for the rejection loop itself — it's the same WF03, exercised the other direction — but Prepared By re-entering WF02 after a rejection should be recognized as WF02 firing again on the same item, not a new item, satisfying "no duplicate request is created."

---

## 4. Approval Stage — Revised

BR-008 says Status and Approval Stage must never merge. The baseline held that line while the process was sequential; it becomes harder to hold once two roles can be simultaneously active. Recommendation:

**Approval Stage enum (revised):** `Prepared By`, `Validated By`, `Post-Approval`, `Completed`.

- Up through Approval, Approval Stage still tracks the single current owner exactly as before (`Prepared By` → `Validated By`).
- On approval, Approval Stage becomes `Post-Approval` — a single value that honestly says "no single owner; see Payment Status and Slot Status for what's outstanding and with whom." It does **not** try to resolve to "Cashier" or "Parking Management" individually, because at any given moment both, one, or neither may have open work.
- On WF06's transition to Completed, Approval Stage → `Completed`.

**`Current Owner` (baseline field) — REMOVE.** A single-value "who owns this right now" field cannot honestly represent the post-approval state under BR-006. Rebuilding it as a multi-value field would add complexity to solve a problem that dissolves if it's simply dropped: `Payment Status ≠ Confirmed` already tells you Cashier has open work; `Slot Status ≠ Assigned` already tells you Parking Management has open work. No additional field is needed to say the same thing a second way — keeping `Current Owner` would be exactly the kind of duplicated/derivable state the frozen principles warn against.

**`Current Action` (baseline field, optional) — REMOVE.** Same reasoning: it existed only as a human-readable restatement of Status/Approval Stage/Payment Status/Slot Status. With four fields already available for views to filter and group on, a fifth free-text field earns its keep only if a specific reporting need can't be met by the other four — no such need has been stated, so it doesn't meet the "no unnecessary columns" bar.

---

## 5. Data Model — Field-by-Field Disposition

| Field | Disposition | Reasoning |
|---|---|---|
| Company Name | KEEP | Unchanged. |
| Email Address | KEEP | Unchanged. |
| Service Type | KEEP | Values are Hourly / Daily / Monthly per the frozen Service Type hierarchy; still a single field, still one workflow engine. |
| Preferred Parking Location | KEEP | Unchanged. |
| **Date of Request** | **MODIFY** | Becomes system-set at submission (timestamp), not Parker-entered. Required to make BR-001/BR-002 enforceable — a user-entered request date could be gamed to satisfy the backdating rule artificially. |
| Required Start Date | KEEP | Still Parker-entered; now validated against system `Date of Request` at submission (BR-001/BR-002). |
| End Date | KEEP | Unchanged. |
| Purpose | KEEP | Unchanged. |
| Status | MODIFY | Enum revised per Section 2 (Rejected removed as a resting value; fork/join added conceptually, though Status itself stays single-valued). |
| Approval Stage | MODIFY | Enum revised per Section 4 (`Post-Approval` replaces the old linear Cashier/Parking Management progression). |
| Payment Status | KEEP | Already independent in the baseline — now confirmed as the correct design by BR-006/BR-007, unchanged in structure. |
| Slot Status | KEEP | Same as above. |
| Current Owner | **REMOVE** | Section 4. |
| Current Action | **REMOVE** | Section 4. |
| Prepared By | KEEP | Unchanged. |
| Validated By | KEEP | Unchanged. |
| **Validated By Approval** | **MODIFY → rename "Approval Decision"** | Same purpose, renamed for clarity now that it's explicitly the field that drives the WF03 rejection loop rather than a one-way approval flag. |
| Validated Date | KEEP | Unchanged. |
| **Rejection Count** | **ADD** | Required for audit under BR-004 — how many times has this request been sent back. |
| **Rejection Reason** | **ADD** | Captures the most recent rejection reason; full history available via native Microsoft Lists version history (Section 8). |
| **Rejected By** | **ADD** | Audit — who rejected, each cycle (current value; history via versioning). |
| **Rejected Date** | **ADD** | Audit — when, each cycle. |
| Cashier | KEEP | Unchanged. |
| Pay Date | KEEP | Unchanged. |
| Official Receipt Reference | KEEP | Unchanged. |
| Assigned Slot / Space Number | KEEP | From baseline's proposed additions. |
| Slot Assignment Date | KEEP | From baseline. |
| **Assigned By** | **ADD** | Baseline omitted who performed the assignment — needed since Parking Management may have multiple staff. |
| Total Hours / Total Days / Total Months | KEEP | System-computed, unchanged. |
| Lease Rate Hourly / Daily / Monthly (as static columns) | **REMOVE** | Superseded by the frozen Rate Table decision (Section 7) — no static rate columns remain on the request. |
| Total Payment Due | KEEP | Now computed from the *snapshotted* rate value (Section 7), not a static column lookup. |
| **Rate Version ID** | **ADD** | Section 7 — points to the immutable Rate Table version used for this request. |
| **Rate Snapshot Date** | **ADD** | Section 7 — when the rate was locked in. |
| **Completed Date** | **ADD** | WF06 needs somewhere to write the completion timestamp; the baseline had no field for it. |
| Title, Item Type, Path | KEEP | System fields, hidden, unchanged. |

---

## 6. Forms Architecture

The frozen business model states Hourly, Daily, and Monthly are charging models within Service Types, not separate workflow engines — so **the business model itself does not require separate forms.** One logical intake schema (the field set in Section 5) covers every Service Type.

Whether that's implemented as one form with conditional visibility or several physical forms mapping to the same list is a **Microsoft Lists capability question, not an architecture question** — correctly excluded from this pass per the constraint that implementation must not drive design. Recommendation carried into Build: default to a single form; only fragment into multiple physical forms if the chosen implementation's conditional-logic limitations make a single form unworkable, and treat that as a Build-phase implementation note, not an architecture decision.

---

## 7. Rate Table — Validated Design

The frozen decision (dedicated Rate Table, workflow retrieves and snapshots the rate) is sound, but snapshotting only an ID has a failure mode worth closing: **if the Rate Table is ever edited in place rather than versioned, an ID-only snapshot silently loses its audit integrity** — the pointer would resolve to a changed value.

**Recommendation:** the Rate Table must be **append-only**. A rate change creates a new version row (new `Rate Version ID`, new effective-date range); existing rows are never edited. The request then stores **both** the `Rate Version ID` (traceability) **and** the resolved rate amount is carried forward into `Total Payment Due`'s calculation at snapshot time (redundant verification — if the two ever disagree, that's a detectable audit flag rather than a silent one).

**Rate Table fields (recommended):** Service Type, Charging Model, Rate Amount, Rate Version ID, Effective Start Date, Effective End Date (null = current).

**Rate Table maintenance access (resolved):** Parking Management, Prepared By, and Validated By all have edit access to the Rate Table list — any of the three can add a new rate version. This does not change the mechanism above: the per-request workflow still performs the lookup and snapshot automatically; maintaining the table is a separate, config-level activity from applying it to a request. Practically this is a low-effort setting (granting three roles Edit on one small reference list) and doesn't add build complexity — it doesn't conflict with keeping the table append-only, since "who can add a version" and "how a version is applied" are independent concerns.

**Rate snapshot timing (resolved):** Approval (WF03 exit). `Rate Version ID` and `Rate Snapshot Date` are written at the moment WF03 transitions the request to `Status = Approved` — not at Submission. A rate change that occurs while a request is still in `In Preparation` or `Pending Approval` has no effect on it; only rates in force at the moment of approval apply, consistent with Payment and Slot Assignment both being gated on Approved.

---

## 8. Audit Fields — Consolidated

| Purpose | Field(s) |
|---|---|
| Who submitted, when | Requester identity (implicit via item creator), `Date of Request` (system-set) |
| Rejection history | `Rejection Count`, `Rejection Reason`, `Rejected By`, `Rejected Date` (current cycle values — full history via Lists version history) |
| Approval decision | `Approval Decision`, `Validated By`, `Validated Date` |
| Payment | `Cashier`, `Pay Date`, `Official Receipt Reference` |
| Slot assignment | `Assigned Slot`, `Slot Assignment Date`, `Assigned By` |
| Rate integrity | `Rate Version ID`, `Rate Snapshot Date` |
| Completion | `Completed Date` |

**Note carried into Build:** Microsoft Lists retains full version history natively per item. The fields above capture the *current* value needed for workflow logic and reporting; they are not a substitute for version history, and Build should confirm version history is enabled (it is by default) rather than duplicating a full change-log as list columns — that would be exactly the kind of unnecessary-column growth the principles warn against.

---

## 9. Business Rules — Constitutional Reference

These are the binding rules for this solution. Any future workflow or field change must be checked against this list before implementation.

- **BR-001 (No Backdating):** `Required Start Date` ≥ `Date of Request`, enforced at submission.
- **BR-002 (Advance Requests Only):** `Required Start Date` > `Date of Request`, strictly — same-day requests rejected at submission.
- **BR-003 (Request Ownership):** Requester loses all edit rights the instant the item is submitted. No exceptions, including during rejection loops.
- **BR-004 (Rejection Handling):** Rejection returns the same item to `In Preparation` / `Prepared By`. No new item is ever created. Requester is never re-involved.
- **BR-005 (Mandatory Payment):** No path to `Completed` exists that does not pass through `Payment Status = Confirmed`.
- **BR-006 (Slot/Payment Independence):** Payment and Slot Assignment are peer processes. Neither may be implemented as a prerequisite for the other.
- **BR-007 (Completion Condition):** `Status = Completed` if and only if `Payment Status = Confirmed` AND `Slot Status = Assigned`, evaluated by exactly one workflow (WF06).
- **BR-008 (Status/Approval Stage Separation):** `Status` never encodes ownership; `Approval Stage` never encodes lifecycle progress. Neither field's enum may be extended to cover the other's purpose.

---

## Final Readiness Verdict

**Approved**

The architecture in this document satisfies BR-001 through BR-008 and preserves all previously established principles (state-driven automation, single-responsibility workflows, centralized business logic, audit integrity, scalability, Status/Approval Stage separation). Both items previously flagged as open are now resolved:

1. **Rate snapshot timing** — Approval (Section 7).
2. **Rate Table maintenance access** — Parking Management, Prepared By, and Validated By (Section 7).

One remaining Build-phase (not architecture-phase) responsibility: confirm the BR-001/BR-002 date validation gate is actually implemented somewhere — form, list-level rule, or both — before go-live. That is an implementation detail, not an open architectural decision, and does not block freezing this document.

This document is now the frozen Build specification.
