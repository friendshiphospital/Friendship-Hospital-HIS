# Proposed Features — Friendship Hospital HIS

**Status update:** Tier 1 (all 4 items), Tier 2 (all 4 items), and Tier 3
item 11 have since been implemented — see the ✅ marker on each item
below. Item 3's notification target was changed from "a designated
supplier contact" to Admin + Lab Supervisor email per an explicit request.
Tier 3 items 9 and 10 remain proposals only, not implemented. The rest of
this document is left as originally written for context.

Originally: a discovery/planning document only, with nothing implemented. Grounded in
the actual codebase (`index.html`, `CLAUDE.md`, `supabase/functions/`) as of
this writing, and in the realistic context of **Friendship Hospital, Al
Damazin, Blue Nile State, Sudan**: intermittent internet connectivity (the
app's offline write-queue already reflects this), a small IT footprint, and
a small-to-mid-size hospital's actual daily workflow — not an international
enterprise SaaS deployment.

Each item lists: what it is, why it specifically helps this hospital,
rough complexity given the existing vanilla JS/Supabase stack, and which
existing module(s) it extends. Complexity assumes no new frameworks, no
build step, no npm dependencies — consistent with how everything else in
this repo is built.

---

## Tier 1 — Quick Wins
*Small effort, real value, could reasonably be next.*

### 1. SMS/WhatsApp appointment & follow-up reminders ✅ Implemented
**What:** Automated SMS (or WhatsApp, if the same gateway supports it) sent
a day before a booked appointment, and when a doctor schedules a follow-up
(`follow_ups` table, already written by the visit-completion flow).
**Why it helps here:** No-shows waste a scarce appointment slot in a
resource-constrained hospital; a same-day SMS costs far less than an empty
consultation slot, and SMS reaches patients who may not reliably have data
connectivity for anything richer.
**Complexity: Small.** The hard part — a secrets-safe, server-side SMS
sender — already exists and already works (`supabase/functions/send-sms`,
called from `sendSms()` in `index.html`, with its own offline-safe
`sms_log` write). This is "wire a scheduled trigger to an existing,
working function," not new infrastructure. A manual "🔔 Send Reminder"
button on the Appointments list is the smallest first version; a real
cron-scheduled batch job is the natural v2.
**Extends:** Appointments, Doctor Consultation (follow-ups).

### 2. Edge Function deployment/secrets health-check panel ✅ Implemented
**What:** A small admin-only panel (Settings or Staff module) that pings
each Edge Function this app depends on (`reception-shift-notify`,
`send-sms`, `create-staff-account`) and reports, per function: reachable
(deployed) or 404 (not deployed), and — from the function's own error
response — whether its required provider secret is configured.
**Why it helps here:** This exact gap was found live in this session: the
shift-notification email code was entirely correct end-to-end, but there
was no way to tell, from inside the app, whether the Edge Function had
ever actually been deployed or its `RESEND_API_KEY` secret ever set — a
silent failure mode with no error a receptionist would ever see (shift
open/close is deliberately non-blocking). With one admin and no dedicated
IT staff, "the app can tell you what's broken" beats "wait for someone to
notice an email never arrived."
**Complexity: Small.** Pure client-side — call each function with a
harmless test payload via the same `sb.functions.invoke()` already used
everywhere, and render deployed/not-deployed + configured/not-configured
per function. No new backend code.
**Extends:** Settings/Administration.

### 3. Low-stock reagent auto-alert to a designated supplier contact ✅ Implemented
**What:** When a reagent crosses its reorder threshold (the in-app
low-stock alert already exists), automatically notify a fixed
supplier/vendor phone number or email, not just an in-app badge.
**Why it helps here:** In-app alerts only work if someone is looking at
the Inventory page that day. A hospital with limited staff benefits more
from the alert reaching the person who actually reorders stock, even if
they're not logged into the HIS.
**Complexity: Small–Medium.** Reuses the existing `send-sms` pattern (or a
new, equally small `send-email` function on the same template) triggered
from the point where the low-stock condition is already detected.
**Extends:** Inventory.

### 4. Confirm hardware barcode scanners "just work" at Sample Receiving ✅ Implemented
**What:** Most desktop USB/Bluetooth barcode scanners act as a keyboard —
they type the scanned code followed by Enter into whatever text field has
focus. The app already prints barcoded sample labels
(`printSampleLabel()`/`openSampleLabelWindow()`); the question is whether
Sample Receiving's patient/sample search field auto-focuses and submits
on Enter so a scan-and-go workflow already works today, or needs a small
fix to actually behave that way.
**Why it helps here:** This is the cheapest possible speed-up for a
repetitive, error-prone manual step (typing/searching a lab number by
hand) — assuming standard scanner hardware, which is inexpensive and
common, rather than requiring camera-based scanning (a materially bigger
lift, see Tier 3).
**Complexity: Small.** Likely a focus-management and Enter-key-handling
check/fix on one input field, not new functionality.
**Extends:** Sample Collection / Sample Receiving.

---

## Tier 2 — Medium-Term
*Meaningfully valuable, bigger lift.*

### 5. Multi-visit lab result trend charts ✅ Implemented
**What:** Line-graph charts of a patient's numeric lab values (e.g.
haemoglobin, creatinine, glucose) plotted across their visit history, on
the Patient Timeline / Patient History view.
**Why it helps here:** Trends over time (is renal function worsening? is
anaemia improving on treatment?) are often more clinically useful than any
single result, and the data already supports this — `loadPatientHistory()`
was rebuilt earlier this session specifically to correctly span multiple
visits per MRN, so the underlying multi-visit query already exists.
**Complexity: Medium.** Charting itself is a proven, in-repo pattern —
plain `<canvas>` drawing, the same approach already used for the QC
Levey-Jennings chart and the EP15/EP09 validation charts, not a new
charting library. The work is querying + aligning a given field across
visits and rendering it, per analyte.
**Extends:** Patient History / Patient Timeline, Laboratory result entry.

### 6. Doctor's mobile-friendly results/orders view ✅ Implemented
**What:** A responsive layout pass — not a separate app — so a doctor can
usefully check a patient's results, orders, and timeline from a phone
browser between wards, rather than needing a desktop screen.
**Why it helps here:** Doctors move around the hospital far more than
front-desk or lab staff; being tied to a desktop for a quick results check
is a real friction point in a small hospital where the same doctor covers
multiple areas.
**Complexity: Medium.** CSS/layout work (media queries, a simplified
mobile nav) on the existing Consultation/Patient Timeline pages — no new
backend, no new data model. Effort is mostly disciplined testing across
the pages doctors actually use on a phone.
**Extends:** Doctor Consultation, Patient History/Timeline.

### 7. Extended analytics beyond the current Statistics dashboard ✅ Implemented
**What:** Month-over-month trend views (patient volume, revenue), a simple
top-diagnoses/top-tests breakdown, and department workload over time —
built on top of the existing Statistics module rather than a new one.
**Why it helps here:** Hospital leadership planning (staffing, stock
purchasing, service focus) benefits from trend visibility that a
single-snapshot dashboard doesn't give; this is useful to a small hospital
precisely because it doesn't require a dedicated analyst to produce.
**Complexity: Medium.** Same canvas-charting pattern as item 5; the real
work is well-formed aggregate queries (grouped by month/department) against
existing tables, not new data collection.
**Extends:** Statistics/Analytics.

### 8. Automated backup-verification alert ✅ Implemented
**What:** A scheduled Edge Function that runs a lightweight read-check
against the database on a schedule and alerts the admin — by the same
email/SMS pattern already built — **only on failure**, not with daily
noise.
**Why it helps here:** With one admin and no dedicated IT staff, "backups
are probably fine" is not the same as knowing they're fine. A silent
failure alert (rather than a daily status email nobody reads) fits a
low-attention operational model.
**Complexity: Medium.** Needs a Supabase scheduled/cron-triggered Edge
Function (new pattern for this repo, though the function body itself
reuses the existing email-sending code shape) plus deciding what "backup
verification" concretely checks, given Supabase manages the actual backup
mechanism on paid tiers.
**Extends:** Administration (new, small module).

---

## Tier 3 — Longer-Term / Ambitious
*Worth knowing about even if not planned soon.*

### 9. Patient-facing printed/QR-code visit summary
**What:** A QR code on the printed visit/discharge summary that a patient
(or another facility they're referred to) can scan to pull up a minimal,
safe read-only summary of that visit.
**Why it helps here:** Patients frequently don't retain paper records
between visits or facilities; a scannable link reduces repeat history-
taking and lost information on referral.
**Complexity: Large — flagged specifically for its security surface, not
just build effort.** This requires a genuinely new kind of access path: a
scoped, unauthenticated (or token-authenticated) read view that must be
carefully limited so a QR code can never become a way to browse arbitrary
patient data. That's a real RLS/access-control design exercise, not a
UI feature — worth doing carefully rather than quickly.
**Extends:** Registration/Discharge printing, a new minimal public view.

### 10. Installable offline-first PWA for ward devices
**What:** A proper installable Progressive Web App (manifest, stronger
service-worker caching) so tablets/phones used ward-side feel like a real
app rather than a browser tab, building on the offline write-queue that
already exists.
**Why it helps here:** Wards are exactly where connectivity is most likely
to be intermittent and where a "just works, looks like an app" experience
matters most for staff who aren't especially technical.
**Complexity: Large.** Real service-worker and caching-strategy work
beyond the current app-shell caching in `sw.js`, an icon/manifest set, and
careful testing of what still works fully offline versus what degrades.

### 11. True bidirectional instrument (analyzer) integration ✅ Implemented
**What:** Real serial/TCP connectivity to lab analyzers, replacing the
current paste-a-raw-HL7/ASTM-message workflow in the Analyzer Interface
with live, automatic result capture.
**Why it helps here:** This is the natural "grows up" path once the
hospital's instrument fleet and volumes justify it — but it's genuinely
hardware- and analyzer-model-dependent, not a pure software project, and
the README already flags it as "future integration" for that reason.
**Complexity: Large, and partly out of this project's control** (depends
on what analyzers the lab actually has and their connectivity options).
Worth revisiting once instrument inventory and volumes are known.
