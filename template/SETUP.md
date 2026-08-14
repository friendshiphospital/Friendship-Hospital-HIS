# Hospital HIS — Template / Starter Kit

This folder is a **clean, deployable template** derived from Friendship Hospital's
HIS codebase, for standing up a completely separate hospital instance. It carries
no real patient data, no real staff accounts, and no hardcoded hospital identity.
Currency is admin-configurable.

It is a snapshot, not a symlink — files here do **not** update automatically when
`../index.html` or `../migration_v2*.sql` change. If you want to re-cut the
template from a newer version of the live app, re-run the same de-identification
pass described in the PR/commit that created this folder.

## What's in here

- `index.html` — the full single-file application (HTML/CSS/JS together, matching
  the live app's architecture — there is no build step).
- `migrations/` — every `migration_v2*.sql` file from the repo, in numeric order,
  unmodified (see "Data audit" below for why no edits were needed).
- `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `BLOOD_BANK_WALKTHROUGH.md`,
  `proposed-features.md`, `tests-README.md` — full contents of every `.md` file
  in the repo, copied as-is (these describe the app generically; nothing in them
  needed hospital-identity changes).

## First-time setup checklist

1. **Create a new Supabase project** (your own — do not reuse Friendship
   Hospital's project). Note its Project URL and `anon public` API key
   (Settings → API). Never use the `service_role` key client-side.
2. **Run the migrations in order** in the Supabase SQL Editor:
   `migration_v2.8_rls_security.sql` → `migration_v2.9_sample_source.sql` →
   `migration_v2.10` → … → `migration_v2.47_sample_records_per_order.sql`
   (sort by the version number, not filename string order — `v2.9` comes
   before `v2.10`). Two files share the `v2.45` version number
   (`migration_v2.45_lab_reference_ranges.sql` and
   `migration_v2.45_followup_reminders.sql`) — both are independent and order
   between the two of them doesn't matter, but both must run after every
   lower-numbered file.
   - Note: there is no base `FriendshipHospital_HIS_v1_Schema.sql` in this
     checkout (see `CLAUDE.md`) — if your Supabase project is completely
     empty, you'll need the original v1 schema file (tables like `patients`,
     `staff`, `invoices`, etc.) before these incremental migrations will apply
     cleanly. These migrations assume that base schema already exists.
3. **Deploy the Edge Functions** (optional, only for SMS/email/staff-creation/
   backup-verify features) from `../supabase/functions/` using the Supabase
   CLI, and configure their secrets (SMS gateway, email provider, etc.) —
   these live server-side only, never in `index.html`.
4. **Deploy `index.html`** — upload it directly to your static host (e.g.
   Vercel). No build step.
5. **Open the app** → the "⚙ Supabase Configuration" panel on the login
   screen → enter your new project's URL and `anon public` key → Save &
   Connect.
6. **Create your first admin staff account** directly in Supabase: create an
   Auth user (Authentication → Users → Add User), then insert a matching row
   into the `staff` table with `role: 'admin'` and `user_id` set to that
   Auth user's UUID. (Once you have one admin, the in-app "Staff" page and
   the `create-staff-account` Edge Function can be used for everyone else.)
7. **Sign in as that admin** → go to **Settings** → fill in:
   - **Hospital Name** and **Address** (shown on the login screen, sidebar,
     and every printed report/header — blank until you set this).
   - **Currency** (SDG / USD / SAR / OMR).
   - Phone, email, lab number prefix, and the other Settings fields as needed.
8. Optionally use **Price List → Load Default Prices** to seed a starting fee
   schedule (see "Reference data kept" below) — it's inserted using whichever
   currency you configured in step 7, not hardcoded to SDG.
9. Done — the instance is ready for real use under its own identity.

## What was changed vs. the live Friendship Hospital codebase

1. **Hospital identity is now admin-configurable end-to-end.** `CFG.name` /
   `CFG.addr` already existed as a Settings-backed localStorage setting in the
   live app, but several display locations still hardcoded "Friendship
   Hospital" / "Al Damazin" / "Blue Nile State" instead of reading it
   (`printHeader()`, `openPrintWin()`'s popup toolbar, the thermal invoice
   header, the Price List print title, the Inventory low-stock email
   footer, and the Medical Certificate / Referral Letter signature lines).
   All of these now read `CFG.name`/`CFG.addr`. The login screen, launcher
   topbar, sidebar brand, and sidebar footer were static HTML — they now
   have `id`s and are populated at runtime (and after every Settings save)
   by a new `applyHospitalIdentity()` function, which also sets the browser
   tab title.
2. **Template defaults are blank, not Friendship Hospital's values.**
   `CFG.name`/`CFG.addr` default to `''` in this template (was
   `'Friendship Hospital — Al Damazin'` / `'Al Damazin, Blue Nile State,
   Sudan'`); the Settings inputs are blank with placeholder text instead of
   pre-filled; the login/sidebar/launcher show "Your Hospital" / "Set
   hospital name & address in Settings" until an admin sets it. A fresh
   deployment cannot silently inherit Friendship Hospital's identity.
3. **Currency hardcoding fixed.** `CFG.currency` (SDG/USD/SAR/OMR dropdown,
   Settings) was already the correct mechanism and is unchanged, but the
   `SDG` audit (grep found it in ~468 places) turned up real bypasses that
   are now fixed:
   - 3 write-time bypasses that hardcoded `currency:'SDG'` on new invoices,
     split-payments, and shift-opening records regardless of the Settings
     value — now use `CFG.currency`.
   - 6 read-time fallbacks (`row.currency||'SDG'`) that assumed SDG for
     legacy rows missing a currency — now fall back to `CFG.currency`.
   - ~20 JS-computed display strings (invoice totals, wallet balances,
     price-list rows, void/refund confirmation text) that appended a
     literal `' SDG'` suffix — now append `CFG.currency`.
   - ~17 static HTML labels/headers that said e.g. "Revenue (SDG)", "Price
     (SDG)", "Amount Paid (SDG)" — the parenthetical was dropped (the real
     amounts next to them already show the actual configured currency).
   - The `seedDefaultPrices()` default fee-schedule catalog (~350 entries,
     see below) still lists `currency:'SDG'` per line in the source array,
     but is now rewritten to `CFG.currency` at insert time, so "Load Default
     Prices" seeds rows in whatever currency the deployment is actually
     configured for.
   - Left unchanged (correct as-is): the `CFG.currency` getter's own
     ultimate default (`||'SDG'`) — that's the mechanism, not a bypass —
     and the 4-option SDG/USD/SAR/OMR dropdown itself.
   - **Not changed, flagged for awareness:** the separate "Open Shift"
     currency picker (`#sfo-currency`) only offers SDG/USD (2 options, not
     the full 4). This is a pre-existing UX inconsistency, not a hardcoded
     bypass — out of scope for this pass, worth a follow-up if you use
     multi-currency shifts.
4. **No SQL migration changes were needed.** See "Data audit" below — none
   of the 41 migration files contained any real patient/staff/transactional
   data to remove.
5. **No credential changes were needed.** See "Credentials audit" below.
6. **Not touched (by design):** the Elmohajir Medical Technology logo/credit
   on the login and launcher screens, and the background glow branding image
   — this is the software's own product branding, not the hospital's
   identity, and was explicitly out of scope.
7. **Not touched (out of scope):** the Insurance Provider picker on the
   Billing page lists Sudan-specific companies (e.g. "Blue Nile Cooperative
   Insurance", "Sudanese Insurance & Reinsurance Co."). These are business
   configuration, not hospital identity/PII, and the picker already has an
   "Other (type manually)" escape hatch. Edit that `<select>` directly if
   your deployment needs different providers.

## Data audit (SQL migrations)

**No real patient data, staff data, or credentials were found in any of the
41 migration files** — confirmed by:
- Searching every file for `INSERT INTO` / `insert into` (case-insensitive):
  the only matches are `insert into` statements **inside PL/pgSQL trigger
  function bodies** (e.g. auto-creating a `patient_wallets` row when a wallet
  is first touched, auto-logging to `*_history`/`audit_logs` tables on
  update) — these are logic, not seeded rows, and fire only when real data
  is later created through the app.
- Regex search for email addresses and Sudan-format phone numbers across all
  migration files: zero matches.
- `migration_v2.44_xss_test_data_cleanup.sql` is a maintenance script for a
  specific incident on Friendship Hospital's *live* database (a test XSS
  payload that landed in a patient-name field, MRN 522) — it contains no
  literal patient data itself (it's a SELECT-then-optional-UPDATE against
  whatever's already in your database), and is a no-op on a fresh, empty
  database. Kept in the template for completeness since it's schema/utility
  SQL, not seed data, but it's safe to skip if you're starting fresh.

**Reference data kept, deliberately:**
- `migration_v2.45_lab_reference_ranges.sql` seeds `lab_reference_ranges`
  with ~90 standard clinical reference intervals (e.g. WBC 4.0–10.0 ×10³/µL)
  copied from the app's own `RESULT_META` — this is lab-science reference
  data, not PHI, and every lab needs a starting set of ranges.
- `index.html`'s `seedDefaultPrices()` (Price List page → "Load Default
  Prices" button) contains a ~350-line starting fee schedule (registration,
  consultation, lab tests, imaging, theatre procedures) with illustrative
  SDG-denominated prices. This is a price *template*, not real transactional
  data — nothing is inserted until an admin explicitly clicks the button,
  and as of this template it's inserted using the deployment's configured
  `CFG.currency` rather than hardcoded SDG. A new hospital should review and
  adjust every price before relying on it.

**Nothing was removed** — there was nothing to remove.

## Credentials audit

Searched `index.html`, all `migration_v2*.sql` files, and every `.md` file for
Supabase project URLs, JWT-looking API keys (`eyJ...`), `service_role`
mentions, and generic `password=`/`secret=`/`apikey=` patterns:
- The only `supabase.co` references anywhere are the generic placeholder
  `https://xxxx.supabase.co` (shown in the login screen's config-panel
  placeholder text and in two Edge Function source comments) — not a real
  project URL.
- No JWT/anon-key-shaped strings found anywhere.
- No `service_role` key present anywhere — every mention of "service_role"
  in the codebase is a *comment* warning not to use it client-side.
- `.gitignore` already excludes `.env`/`.env.*`/`supabase/.env`, so no local
  secrets were ever tracked in the repo to begin with.

**Nothing was found, nothing needed to be blanked.**
