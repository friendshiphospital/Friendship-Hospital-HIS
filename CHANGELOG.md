# Changelog — Friendship Hospital HIS

All notable changes documented here.

---

## [v2.6 FINAL] — 2026-06-09 ✅ PRODUCTION READY

### Final Audit
- ✅ All 325 JavaScript functions defined — 0 missing onclick handlers
- ✅ Syntax clean (Node.js --check passes)
- ✅ 9,536 lines | Payment gate active across all departments

### Admin & Radiology (v2.6)
- Staff module: 4 tabs — List, Add/Edit, Role Permissions Matrix, Activity Log
- Role permissions matrix: visual 9×35 table, all access rules at a glance
- Staff login linking via Supabase UUID
- Doctors module: full CRUD, specialty, license number, auto-populates all dropdowns
- Radiology: 3 tabs — Requests, Report (with critical finding alert), Reported
- Radiology report print: A4 with findings, impression, radiologist signature
- Dashboard: live data — 8 clinical + 4 billing stats, ward census bar charts,
  unpaid panel, STAT panel, quick action grid

### Billing & Finance (v2.5)
- Full invoice CRUD: create, edit, print, mark paid
- Price picker modal: search/filter 216 items, click to add to invoice
- Auto-invoice on patient registration
- Insurance claim form print
- 216 default prices in SDG across 9 categories (Load Defaults button)
- All prices editable in SDG with category, code, notes

### Lab Module (v2.4)
- Worklist: 6 stat counters, dept filter, priority filter (STAT/Urgent/Routine)
- STAT red banner, unpaid yellow banner, print worklist
- All Results: queries 7 result tables simultaneously, dept/status/date filters
- Critical Values: ISO 15189 §5.8, time elapsed alert, acknowledge with read-back
- Auto-detection: 9 critical thresholds on Haem/Chemistry save
- Critical value print notice (formal A4)
- QC: Z-score, Westgard rules, Levey-Jennings chart
- TAT tracker with colour coding (>4h red, >2h amber, normal green)

### Nursing & Sample Collection (v2.2)
- Nursing: 6 tabs — Queue, Vital Signs, MAR, Risk, Wound, Handover
- NEWS2 auto-calculated from BP/HR/RR/Temp/SpO2/O2
- Braden Scale (pressure ulcer), Morse Fall Scale
- Pain NRS 0–10 colour scale
- Wound/pressure ulcer: NPUAP staging, IHC, multiple sites
- MAR: full medication administration record, printable
- Sample Collection: CLSI GP41 order-of-draw, 2-identifier verification,
  23 specimen types with volume guides, rejection criteria, TAT monitor
- Rejection analytics with ISO 15189 §5.4.6 note

### Doctor Module (v2.3)
- 8-tab workspace: Consultation, Vitals, Orders, Prescription, Sick Leave,
  Referral, Discharge, History
- Full SOAP notes with HMPC, allergies highlighted red
- 6 order types with payment gate
- Prescription with drug autocomplete (50 drugs), quick-add buttons
- Sick leave with auto-calculated dates, print medical certificate
- Referral letter print
- Discharge summary: LOS auto-calculated, full print

### Receptionist (v2.1)
- 3-step registration wizard: Patient Info → Visit & Tests → Payment
- 4 destination cards: Doctor / Lab / Radiology / Admission
- Auto-invoice creation on registration
- Payment gate: unpaid patients yellow everywhere, services blocked
- Insurance pending status with pre-auth tracking
- Mark paid → instantly unblocks patient across all departments

### Initial Release (v1.0)
- 35 pages, 9 roles, 38-table Supabase schema
- Full HIS: Reception, Doctor, Nurse, Lab, Billing, Admin, Radiology, Theatre, ICU

---

## SQL Migrations Required (run in order)

| File | What it adds |
|------|-------------|
| `migration_v2_receptionist.sql` | visit_destination, payment_status on patients |
| `migration_v2.2_nursing.sql` | Vital signs columns, sample_records columns |
| `migration_v2.4_lab.sql` | Critical values, doctor orders, consultations, prescriptions |
| `migration_v2.5_billing.sql` | Invoices columns, price_list code/currency |
| `migration_v2.6_admin_radiology.sql` | Staff columns, radiology report columns |
