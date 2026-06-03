# 🏥 Friendship Hospital HIS — Al Damazin
### Hospital Information System v1.0
**Location:** Al Damazin, Blue Nile State, Sudan  
**Currency:** SDG (Sudanese Pound)  
**Stack:** Vanilla HTML · CSS · JavaScript · Supabase (PostgreSQL)

---

## 📋 Modules

| # | Module | Description |
|---|--------|-------------|
| 1 | Patient Registration | MRN generation, demographics, triage |
| 2 | OPD / Clinic | Outpatient queue, clinic status |
| 3 | Admissions | Bed assignment, ward management |
| 4 | Vital Signs | Charting, fluid balance, I&O |
| 5 | Theatre / OT | Booking, scheduling, pre/post-op |
| 6 | Pre-op Assessment | Anaesthesia, consent, clearance |
| 7 | Doctor Orders | Lab, radiology, diet, physio |
| 8 | Discharge Summary | Summary, follow-up, LOS |
| 9 | Ward Handover | Shift handover notes |
| 10 | Infection Control | Isolation flags, precautions |
| 11 | Laboratory | Haematology, Chemistry, Serology, Microbiology, PCR, Histopathology, Cytology |
| 12 | Critical Values | Alert log, acknowledgement tracking |
| 13 | QC | Levey-Jennings, Westgard rules |
| 14 | Radiology | Request, report, impression |
| 15 | Consultation | History, examination, diagnosis, prescription |
| 16 | Billing | Invoices, line items, payment status |
| 17 | Appointments | Booking, scheduling |
| 18 | Price List | Tests, procedures, ward charges |
| 19 | Staff Management | Roles, departments, access control |
| 20 | Reagent Inventory | Stock, expiry, low-level alerts |
| 21 | Settings | Hospital config, system preferences |

---

## 🗄️ Database

- **Platform:** [Supabase](https://supabase.com) (PostgreSQL)
- **Tables:** 28 tables across 5 groups
- **Security:** Row Level Security (RLS) enabled on all tables
- **Schema file:** `FriendshipHospital_HIS_v1_Schema.sql`

### Groups
- **Group 1** — Core: patients, staff, doctors, settings
- **Group 2** — Inpatient: beds, admissions, vital signs, theatre, pre-op, orders, discharge, handover, infection flags
- **Group 3** — Billing: invoices, invoice items, appointments, price list
- **Group 4** — Laboratory: 7 result tables, critical values, QC, radiology, consultations, prescriptions, shifts, inventory
- **Group 5** — Indexes + seed data (24 default beds)

---

## 🚀 Setup

### 1. Supabase Project
1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and paste the full contents of `FriendshipHospital_HIS_v1_Schema.sql`
3. Click **Run** — safe to run multiple times

### 2. Configure the App
Open `FriendshipHospital_HIS_v1.html` and update the Supabase credentials near the top of the `<script>` block:

```js
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

Find these values in your Supabase project under **Settings → API**.

### 3. Create First Admin User
1. Go to Supabase → **Authentication → Users → Add User**
2. Enter email and password
3. Then in **SQL Editor** run:

```sql
INSERT INTO staff (user_id, full_name, role, department)
VALUES (
  '<paste-user-uuid-here>',
  'Administrator',
  'admin',
  'Administration'
);
```

### 4. Deploy
**Option A — Supabase Storage:**
- Go to Storage → Create bucket (e.g. `his-app`) → set public
- Upload `FriendshipHospital_HIS_v1.html`
- Access via the public URL

**Option B — Vercel / Netlify:**
- Push this repo to GitHub
- Connect repo to Vercel or Netlify
- Deploy (no build step needed — static HTML)

**Option C — Local:**
- Open `FriendshipHospital_HIS_v1.html` directly in a browser

---

## 👥 User Roles

| Role | Access |
|------|--------|
| `admin` | Full access to all modules |
| `doctor` | Consultation, orders, theatre, discharge |
| `nurse` | Vitals, admissions, ward handover |
| `lab_tech` | Lab results, QC, sample records |
| `lab_supervisor` | Lab + verification + critical values |
| `receptionist` | Patient registration, appointments |
| `cashier` | Billing, invoices, price list |
| `theatre_nurse` | Theatre bookings, pre/post-op |
| `radiologist` | Radiology requests and reports |

---

## 📁 Repository Structure

```
FriendshipHospital-HIS/
├── FriendshipHospital_HIS_v1.html     # Main application
├── FriendshipHospital_HIS_v1_Schema.sql  # Database schema
├── README.md                          # This file
├── CHANGELOG.md                       # Version history
└── .gitignore                         # Ignored files
```

---

## ⚠️ Security Notes

- Never commit your Supabase URL or anon key to a **public** repository
- RLS policies restrict all tables to authenticated users only
- For production, review and tighten RLS policies per role

---

## 📄 License

Private — Friendship Hospital, Al Damazin. All rights reserved.  
Developed by **Elmohajir Specialized Laboratory / ELMOHJIR**.
