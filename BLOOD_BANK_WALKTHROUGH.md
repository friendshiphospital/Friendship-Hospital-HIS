# Blood Bank / Transfusion Services — full-cycle walkthrough

This traces one complete cycle by hand, function by function, so every
safety gate can be checked before the PR is reviewed: a unit received via
**Path A** (in-house donation) and a unit received via **Path B** (external
receipt), both screened/verified into `Available`, requested by a doctor,
crossmatched, issued under mandatory two-person verification, transfused,
and recorded.

Nothing below is simplified from what's actually in `index.html` — every
function name, table, and column referenced is the real one.

---

## Path A — in-house donation → Available

1. **Donor registration.** Blood Bank → New Intake tab. Staff searches
   existing donors (`searchBloodDonors()`) or registers a new one
   (`registerBloodDonor()`), which inserts into `blood_donors` with a
   generated `donor_no` (`generateDonorNo()`, a count-based `DNR-YY-NNNN`
   id — same tier as `admission_no`, not the MRN-grade sequential-ID
   system).
2. **Eligibility screening questionnaire.** The intake form's donation
   fields (`recent_illness`, `on_medication`, `recent_travel`,
   `prior_deferral`, free-text `deferral_notes`) are shown alongside the
   donor. These are visible flags for staff judgement, not an automatic
   block — real-world eligibility calls stay a human decision.
3. **Collection record + unit intake.** `submitBloodIntake()` with
   `source==='In-House Donation'` requires a selected donor
   (`_bbSelectedDonor`), then:
   - Inserts one `blood_donations` row (the questionnaire answers +
     `collection_date`), linked to the donor.
   - Inserts one or more `blood_units` rows (`generateUnitNo()` →
     `BB-YY-NNNN`), each with `status:'Quarantined'`,
     `donation_id` pointing at the donation, `expiry_date` pre-filled by
     `prefillBloodExpiry()` from the component's configured shelf life
     (`CFG.bloodShelf*`, AABB defaults).
   - **The unit cannot be Available yet — it is created Quarantined,
     full stop.**
4. **Mandatory infectious-disease screening.** Blood Bank → Pending
   Actions shows the donation under "awaiting screening"
   (`loadPendingDonations()`, filtered on `blood_donations.cleared=false`).
   Staff records a result for each of the five mandatory tests
   (`BLOOD_SCREENING_TESTS = ['hiv','hbv','hcv','syphilis','malaria']`) and
   calls `clearDonationScreening(donationId)`:
   - Writes all five `*_result` columns + `screened_by`/`screened_at` onto
     `blood_donations`.
   - Sets `cleared:true` **only if every one of the five is `'Negative'`**
     (`BLOOD_SCREENING_TESTS.every(x => results[x+'_result']==='Negative')`).
     A single `Positive` or a `Pending` left unresolved blocks clearance —
     there is no partial-pass path.
   - Only on `allNegative` does it touch `blood_units`, and only units
     still `status:'Quarantined'` for that `donation_id`, flipping them to
     `'Available'`. If any test is not Negative, the units stay
     Quarantined indefinitely — nothing else in the app can move them out.

At this point Path A's unit is genuinely `Available`, screened, and
inventory-visible with FEFO colour banding in the Unit Inventory tab.

---

## Path B — external receipt → Available

1. **Simpler intake.** Same `submitBloodIntake()`, `source==='Received -
   External Supply'` branch — requires `external_source_org` and
   `external_unit_ref` (the supplying org's own id for the unit), records
   `external_screening_attested`, `receipt_date`, `received_by`. No donor,
   no donations row, no five-test panel — the supplying org's screening is
   taken on attestation, not re-run here.
2. The unit is still inserted **Quarantined**, with `verified_on_receipt`
   defaulting to `false` — external units get a lighter path, but not a
   skippable one.
3. **Verified on Receipt step.** Blood Bank → Pending Actions →
   `loadPendingExternalUnits()` lists every unit with
   `source='Received - External Supply' AND verified_on_receipt=false`.
   Staff physically checks the unit's label against what was recorded,
   then `verifyUnitOnReceipt(unitId)`:
   - Requires an explicit `confirm()` ("Confirm the physical unit label
     matches what was recorded at intake?").
   - Sets `verified_on_receipt:true`, `verified_by`, `verified_at`, and
     **only then** `status:'Available'`.

Both paths converge here: from this point on, an Available unit from
Path A and Path B are indistinguishable to the rest of the workflow —
same table, same status field, same downstream functions.

---

## Request → crossmatch

1. **Doctor places the request.** Consultation → Orders → 🩸 Blood Bank
   tab (`switchOrderType('bloodbank')`), same shape as a lab/radiology
   order: component, units requested, urgency, clinical indication.
   `submitBloodRequest()`/`_submitBloodRequest()` mirrors
   `submitRadOrder()`/`_submitRadOrder()` exactly, including the existing
   payment gate, and inserts:
   - A `blood_requests` row (`generateBloodRequestNo()` → `BBR-YY-NNNN`,
     `status:'Requested'`).
   - A mirrored `doctor_orders` row with `order_type:'Blood Bank'`, so it
     shows up in the same worklist/order-tracking views as every other
     order type.
2. **Crossmatch screen.** Blood Bank → Requests & Crossmatch →
   `loadBloodRequests()` lists open requests (`status in
   ('Requested','Crossmatched')`). For each, `renderBloodRequestCard(r)`:
   - Calls `getPatientBloodType(r.patient_id)` — reads
     `results_hematology.blood_group`/`rh_factor` (the exact same on-file
     lookup `loadDocStickyHeader()` already uses — never a second,
     possibly-conflicting source of truth for a patient's type).
   - **If the patient has no on-file blood type, the card renders a red
     "🚫 crossmatch blocked" message and stops — no candidate list, no
     crossmatch button appears at all.** The only way forward is typing
     the patient in Haematology first.
   - If typed, queries `blood_units` for `component_type` match,
     `status='Available'`, **and `expiry_date >= today()`** (expiry is
     re-checked directly here, never trusted from `status` alone — this
     closes the gap where an Available-flagged-but-actually-expired unit
     could otherwise be offered).
   - Filters that candidate list through `isBloodCompatible(patientType,
     unit.blood_group, unit.rh_factor)` against the standard ABO/Rh RBC
     matrix (`BLOOD_COMPATIBILITY`) — only genuinely compatible units are
     ever shown as crossmatch candidates. (Documented MVP simplification:
     one ABO/Rh matrix is applied across all components; FFP/platelets
     have their own real-world compatibility rules not modeled here.)
3. **Reserve.** Staff clicks Crossmatch on a compatible unit →
   `crossmatchUnit(unitId, requestId)`:
   - `blood_units` update, **guarded by `.eq('status','Available')`** so a
     unit already moved out from under this view can't be double-reserved
     — sets `status:'Crossmatched'`, `request_id`, and
     `crossmatched_by`/`_name`/`_at`.
   - `blood_requests.status → 'Crossmatched'`.

---

## Issue — mandatory two-person verification

This is the safety-critical gate. `openIssueUnit(unitId)` loads the unit +
its linked patient into `_bbIssueCtx` and opens `#bb-issue-ov`, which is a
strictly sequential two-step modal.

**Step 1 — issuing staff (the logged-in session).**
`confirmIssueStep1()`:
- Staff re-types the patient's **MRN** and the **unit number** by hand.
- Compared against the *actual* values on `_bbIssueCtx` — not a name, not
  a checkbox, a real read-back of the two identifiers that matter.
- Any mismatch → red error, nothing is marked confirmed.
- On match: `step1Done=true`, `step1StaffId`/`step1StaffName` set from
  `currentProfile` (the currently logged-in user — this cannot be spoofed
  to a different identity without actually logging out and back in).

**Step 2 — receiving staff (a second, independent login).**
`confirmIssueStep2()`:
- The receiving nurse/doctor types **their own email + password**, plus
  the same MRN/unit-number re-entry.
- MRN/unit mismatch → same red error, same hard stop.
- Credentials go through `verifyStaffCredentials(email, password)`, which
  opens a **throwaway** `window.supabase.createClient(...)` client, signs
  in as that specific person, reads their `staff` row (role, id, name),
  signs back out — the primary logged-in session (`sb`, `currentUser`,
  `currentProfile`) is never touched. Reuses the exact technique from the
  Anti-Fraud Quick-PIN override (`requireOverride()`), generalized past
  its original admin-only restriction.
- Invalid credentials → "❌ Invalid credentials." No confirmation.
- **The core safety rule:** `if (!_bbIssueCtx.step1Done || staff.id ===
  _bbIssueCtx.step1StaffId)` → rejected with "The receiving staff member
  must be different from the issuing staff member." A single person
  cannot complete both confirmations from the same login session, and
  cannot complete step 2 by re-authenticating as themselves under a
  different tab either — the check is on the *resolved staff id*, not the
  browser session.
- On success: `step2Done=true`, `step2StaffId`/`step2StaffName` set from
  the *verified* identity (never from a text field the user typed).

**Finalize.** The "Complete Issue" button
(`updateIssueFinalButton()`) stays disabled until **both**
`step1Done && step2Done` are true. `finalizeBloodIssue()`:
- `blood_units` update, **guarded by `.eq('status','Crossmatched')`**:
  `status:'Issued'`, `issued_by`/`_name`/`_at` (step 1's identity),
  `received_by`/`_name`/`_at` (step 2's identity).
- `blood_requests.status → 'Issued'`.
- Inserts a permanent `blood_issue_log` row: who reserved (crossmatch
  attribution carried over), who issued, who received, all three
  timestamps. This table has **no update/delete RLS policy for anyone** —
  it's an append-only audit trail — and the database itself enforces
  `issued_by IS DISTINCT FROM received_by` via the
  `blood_issue_log_two_person` check constraint, so the two-person rule
  holds even if a bug ever let the client-side check slip.
- Prints the compatibility/issue slip (`printBloodIssueSlip()`) with both
  staff names and a physical dual-signature line.

---

## Transfusion → recorded

1. **Start.** Blood Bank → the Issued unit's Transfusion action opens
   `openTransfusionRecord(unitId)`. With no existing `blood_transfusions`
   row, the modal shows "▶ Start Transfusion" (`renderTransfusionControls()`).
   `startTransfusion()` inserts a `blood_transfusions` row
   (`status:'In Progress'`, `started_by`/`_name`, `start_time`).
2. **Vitals before/during/after — the existing Nursing form, not a new
   one.** The modal's vitals summary (`renderTransfusionVitalsSummary()`)
   shows Before/During/After rows, each with a "📈 Record" button when
   missing. Clicking it calls `tagAndGoToVitals(stage)`:
   - Sets `window._transfusionTag = {id: tx.id, stage}`.
   - Closes the transfusion modal, `goPage('nursing')`, and calls the
     *existing* `loadVitalsForPatient()` deep-linked to this patient.
   - `saveVitals()` (unmodified logic otherwise) spreads in
     `transfusion_id`/`transfusion_stage` from the tag when present, and
     clears the tag after a successful (non-queued) save — so the very
     next ordinary vitals entry for any other patient is untagged.
   - Back on the transfusion modal, the summary table reads these tagged
     rows straight from `vital_signs.eq('transfusion_id', txId)`.
3. **Stop.** `stopTransfusion()` updates the same `blood_transfusions`
   row: `stopped_by`/`_name`, `stop_time`, `status:'Completed'`.
4. **Adverse reaction (if it happens).** "Report Adverse Reaction" is only
   available while `status==='In Progress'`. `submitTransfusionReaction()`
   inserts into the **existing** `critical_values` table with
   `department:'Blood Bank'`, `is_acknowledged:false` — it rides the exact
   same alert pipeline (`checkCriticals()`/`refreshNotifications()`/the
   Criticals page) that every other critical lab value already uses, so
   it reaches the ordering doctor and blood-bank staff through a pathway
   that's already proven, not a parallel one. The `blood_transfusions` row
   is also updated to `status:'Reaction Reported'`.
5. **Wastage/discard.** Separately, any unit still in inventory (not yet
   issued) can be discarded via `openDiscardUnit()`/`submitDiscardUnit()`,
   which requires **both** a `discard_reason_code` (a closed enum:
   Expired/Reaction-Related/Damaged/Other) **and** free-text notes —
   either missing blocks the submit. No silent deletions anywhere in this
   module: discard is a status change with a mandatory reason, never a
   row removal.

---

## Where each spec requirement is enforced (quick index)

| Requirement | Enforced by |
|---|---|
| Unit can't leave Quarantined without screening (Path A) | `clearDonationScreening()` — `cleared` only true on all-5-Negative |
| Unit can't leave Quarantined without verification (Path B) | `verifyUnitOnReceipt()` — explicit confirm + `verified_on_receipt` |
| Crossmatch blocked without on-file blood type | `renderBloodRequestCard()` — `getPatientBloodType()` null-check short-circuits before any unit list renders |
| Only compatible units offered | `isBloodCompatible()` filter over `BLOOD_COMPATIBILITY` |
| Expired units never offered, regardless of stored status | `.gte('expiry_date', today())` on the crossmatch candidate query |
| Two independent people, two independent identities | client: `staff.id === step1StaffId` rejection in `confirmIssueStep2()`; db: `blood_issue_log_two_person` CHECK constraint |
| Real identifier read-back, not a name-only ack | MRN + unit-number re-entry compared to true values, both steps |
| Full issue chain is permanent | `blood_issue_log` — no update/delete RLS policy for any role |
| No silent unit disposal | `submitDiscardUnit()` — mandatory reason code + notes |
| Reactions reach the right people | reuse of `critical_values`/Criticals page, not a new alert system |

---

## Access control (Phase 6)

`ROLE_PAGES.bloodbank` grants: `admin`, `doctor`, `nurse`, `lab_tech`,
`lab_supervisor`. Deliberately excluded: `receptionist`, `cashier`,
`theatre_nurse`, `radiologist` — none of their existing responsibilities
touch blood products. This is UX-layer only; `migration_v2.24` through
`migration_v2.29` carry the real RLS boundary (select/insert/update gated
by `is_admin()`/`is_clinical_staff()`/`is_lab_staff()` per table, detailed
in each migration's header, summarized end-to-end in
`migration_v2.29_blood_bank_access.sql`).
