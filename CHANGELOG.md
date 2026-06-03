# Changelog — Friendship Hospital HIS

All notable changes to this project are documented here.  
Format: `[vX.X] — YYYY-MM-DD`

---

## [v1.0] — 2026-06-04

### Initial Release
- 21 modules covering full hospital workflow
- 28 Supabase tables with RLS enabled
- Patient registration with MRN generation
- OPD / clinic queue management
- Inpatient admissions and bed management (24 default beds)
- Vital signs charting with fluid balance / I&O tracking
- Theatre booking, scheduling, pre-op and post-op documentation
- Doctor orders (Lab, Radiology, Diet, Physio)
- Discharge summaries with LOS calculation
- Ward handover notes (Morning / Evening / Night shifts)
- Infection control flags with isolation precautions
- Laboratory results: Haematology, Chemistry, Serology, Microbiology, PCR, Histopathology, Cytology
- Critical values log with acknowledgement tracking
- QC module with Levey-Jennings charts and Westgard rule alerts
- Radiology requests and reporting
- Doctor consultation module with prescriptions and sick leave
- Billing: invoices, line items, payment status (SDG currency)
- Appointments scheduling
- Price list management
- Staff management with 9 role types
- Reagent inventory with expiry and low-stock alerts
- System settings and hospital configuration
- 50+ performance indexes on all key columns
- JavaScript syntax fixes: `\x27` escaping in onclick handlers, ternary operator precedence correction

---

## [Upcoming — v1.1]

- [ ] Printed report templates (Lab, Discharge, Theatre)
- [ ] Barcode / QR label generation for patients
- [ ] Dashboard with live statistics
- [ ] Nurse medication administration record (MAR)
- [ ] Blood bank module
- [ ] SMS / WhatsApp notification for critical values
