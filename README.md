# 🏥 Friendship Hospital HIS — v2.6 FINAL
### Hospital Information System
**Location:** Al Damazin, Blue Nile State, Sudan  
**Currency:** SDG (Sudanese Pounds)  
**Stack:** Vanilla HTML · CSS · JavaScript · Supabase (PostgreSQL)  
**Standards:** ISO 15189 · CLSI GP41 · CAP · NEWS2 · NPUAP

---

## 🚀 Quick Setup (5 minutes)

### 1 — Run SQL migrations in order
Open Supabase → SQL Editor, paste and run each file:
```
1. migration_v2_receptionist.sql
2. migration_v2.2_nursing.sql
3. migration_v2.4_lab.sql
4. migration_v2.5_billing.sql
5. migration_v2.6_admin_radiology.sql
```

### 2 — Deploy the HTML
Upload `FriendshipHospital_HIS_v2.6_FINAL.html` to GitHub → Vercel auto-deploys.

### 3 — Configure Supabase in the app
Open the app → tap **⚙ Supabase Configuration** → enter your Project URL and anon key → Connect.

### 4 — Load default prices
**Price List → 📥 Load Defaults** — inserts all 216 standard SDG prices in one click.

### 5 — Create first admin user
```
Supabase → Authentication → Users → Invite user (email + password)
Then SQL Editor:
INSERT INTO staff (user_id, full_name, role, department)
VALUES ('<uuid>', 'Administrator', 'admin', 'Administration');
```

---

## 📋 Module Summary

| # | Module | Role | Key Features |
|---|--------|------|-------------|
| 1 | Registration | Receptionist | 3-step wizard, 4 destinations, auto-invoice, payment gate |
| 2 | Appointments | Receptionist | Book, list, filter by doctor/date |
| 3 | Billing | Receptionist/Cashier | Invoices, 216-item price list, insurance claims |
| 4 | Consultation | Doctor | 8-tab SOAP, orders, prescription, discharge, referral |
| 5 | Nursing & Vitals | Nurse | NEWS2, Braden, Morse, MAR, wound, handover |
| 6 | Fluid Balance | Nurse | Input/output charting, net balance |
| 7 | Admissions | Doctor/Nurse | Bed assignment, ward management |
| 8 | Theatre | Doctor/Theatre Nurse | Booking, pre/post-op, anaesthesia |
| 9 | Sample Collection | Lab Tech | CLSI GP41, 2-ID verification, rejection tracking |
| 10 | Lab Worklist | Lab Tech | STAT alerts, dept filter, payment gate |
| 11 | Haematology | Lab Tech | Full CBC, coagulation, reticulocyte |
| 12 | Chemistry | Lab Tech | 40+ analytes, auto-flag |
| 13 | Serology | Lab Tech | Hormones, tumour markers, vitamins, infectious serology |
| 14 | Microbiology | Lab Tech | UA, stool, culture, sensitivity panel |
| 15 | PCR/Molecular | Lab Tech | Ct values, Westgard-style auto-flag |
| 16 | Histopathology | Lab Tech | Gross, microscopy, diagnosis, grade, IHC table |
| 17 | Cytology | Lab Tech | Bethesda classification, recommendation |
| 18 | Critical Values | Lab Tech | ISO 15189 §5.8, read-back confirmation, print |
| 19 | QC Module | Lab Supervisor | Z-score, Westgard rules, Levey-Jennings chart |
| 20 | TAT Tracker | Lab Tech | Colour-coded turnaround times |
| 21 | All Results | Lab | Cross-department results viewer |
| 22 | Radiology | Radiologist | Request, report, verify, critical flag, print |
| 23 | Infection Flags | Nurse/Admin | Isolation precautions, resolve tracking |
| 24 | Handover Viewer | All | Historical handover log by ward/shift |
| 25 | Patient History | Doctor | Timeline of all visits, labs, vitals |
| 26 | Staff Management | Admin | CRUD, role assignment, login linking, activity log |
| 27 | Role Permissions | Admin | Visual 9×35 permission matrix |
| 28 | Doctors | Admin | Registry, specialty, license, auto-dropdown |
| 29 | Settings | Admin | Hospital info, beds, Supabase config |
| 30 | Dashboard | All | Live stats, ward census, unpaid alerts, STAT panel |
| 31 | Inventory | Lab | Reagents, expiry alerts, low-stock |
| 32 | Delivery | Lab | Result delivery log |
| 33 | Analyzer Interface | Admin | HL7/ASTM config (future integration) |

---

## 👥 User Roles & Access

| Role | Pages |
|------|-------|
| Admin | Everything |
| Doctor | Consultation, Nursing, Fluid, Admissions, Theatre, Radiology, History |
| Nurse | Nursing, Fluid, Admissions, Handover, Infection, Samples |
| Lab Tech | Worklist, Samples, All Result Entry, Criticals, QC, TAT, Inventory, Delivery |
| Lab Supervisor | All Lab Tech + Verification + Staff Activity |
| Receptionist | Register, Appointments, Billing, Prices, Infection |
| Cashier | Billing, Prices, Register, Appointments |
| Theatre Nurse | Theatre, Nursing, Admissions, Fluid |
| Radiologist | Radiology, Patient History |

---

## 📁 Repository Files

```
FriendshipHospital-HIS/
├── FriendshipHospital_HIS_v2.6_FINAL.html   ← Main application
├── FriendshipHospital_HIS_v1_Schema.sql      ← Base database schema (38 tables)
├── migration_v2_receptionist.sql             ← Run 1st
├── migration_v2.2_nursing.sql                ← Run 2nd
├── migration_v2.4_lab.sql                    ← Run 3rd
├── migration_v2.5_billing.sql                ← Run 4th
├── migration_v2.6_admin_radiology.sql        ← Run 5th
├── FriendshipHospital_HIS_StaffGuide_v2.6.pdf ← Staff training guide
├── README.md
└── CHANGELOG.md
```

---

## ⚠️ Security
- Never commit Supabase keys to a public repository
- RLS policies restrict all tables to authenticated users
- Use `anon public` key in the app — never `service_role`

---

*Developed by Elmohajir Specialized Laboratory / ELMOHJIR*  
*Private — Friendship Hospital, Al Damazin. All rights reserved.*
