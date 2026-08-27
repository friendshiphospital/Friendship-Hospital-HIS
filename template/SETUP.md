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
  - Resynced 2026-08-26 against root `index.html` via a 3-way merge (base:
    the pre-template-creation commit; ours: the original 2026-08-14
    de-identified snapshot; theirs: current root), so it now carries every
    feature root has gained since — doctor-type/specialty consultation-fee
    routing, the shared Procedures-ordering component, the Billing Report
    section, and root's `CFG.currency` hardcoding fixes — while keeping the
    de-identification intact: `CFG.name`/`CFG.addr` default to `''` (not a
    hospital name), and `printHeader()`/`openPrintWin()`/thermal-receipt/
    sick-leave/referral all fall back to generic placeholder text
    (`YOUR HOSPITAL NAME`, `Set hospital address in Settings`, `Hospital`)
    when unconfigured, instead of ever showing Friendship Hospital's name.
    Verified: `node --check` clean, function list is root's 867 plus 2
    template-only onboarding helpers (`applyCurrencyDefaults`,
    `applyHospitalIdentity`), full-file grep shows zero remaining
    `Friendship Hospital`/`Al Damazin`/`Blue Nile` matches outside one
    unrelated insurance-dropdown sample option and one code comment, and a
    live run against the mocked test harness confirms both an unconfigured
    project (shows the generic placeholders) and a configured one (shows
    the custom name/address/currency) render correctly.
  - **Keeping it in sync going forward:** this is a snapshot, not a
    symlink, so it will drift again as root gains features. There is no
    automatic sync — re-run the same 3-way-merge resync (or ask Claude Code
    to do it) periodically, or at minimum before using this template for a
    new deployment, rather than assuming it's current.
- `migrations/` — every `migration_v2*.sql` file from the repo (47 files,
  `v2.8` through `v2.53`, kept in sync as of 2026-08-27), plus
  `COMBINED_full_setup_base_through_v2.53.sql` — the base schema and all 47
  migrations already concatenated in the correct run order, verified
  end-to-end on a local Postgres database with zero errors (see "First-time
  setup checklist" below — this is the recommended way to run setup).
- `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `BLOOD_BANK_WALKTHROUGH.md`,
  `proposed-features.md`, `tests-README.md` — full contents of every `.md` file
  in the repo, copied as-is (these describe the app generically; nothing in them
  needed hospital-identity changes).

## First-time setup checklist

1. **Create a new Supabase project** (your own — do not reuse Friendship
   Hospital's project). Note its Project URL and `anon public` API key
   (Settings → API). Never use the `service_role` key client-side.
   - ⚠️ Prefer starting from a genuinely untouched project (no extra
     Dashboard options/extensions/security features enabled first) —
     `migrations/COMBINED_full_setup_base_through_v2.53.sql` below now
     defends against the one known collision this can cause (`ensure_rls`
     already existing, confirmed live 2026-08-26), but a clean starting
     point is still simpler and keeps every hospital's project configured
     by the SQL alone rather than by whatever was clicked beforehand.
2. **Run `migrations/COMBINED_full_setup_base_through_v2.53.sql`** — paste
   this ONE file into the Supabase SQL Editor and run it top to bottom.
   It's the base schema (67 tables, constraints, indexes, RLS policies,
   functions, triggers) plus every incremental migration `v2.8` through
   `v2.53`, already concatenated in the correct numeric order (not
   filename order — `v2.9` sorts before `v2.10` the wrong way
   alphabetically), with every fix found during dry-run testing already
   folded in: the 14 tables whose `id` column was missing its sequence
   default, the defensive `ensure_rls` drop-before-create, and
   `migration_v2.53`'s beds Realtime publication fix. Verified end-to-end
   on a local Postgres database with zero errors and zero warnings
   (2026-08-27).
   - **The one thing you must come back for afterward:** this file
     deliberately leaves `migration_v2.46`'s `select cron.schedule(...)`
     call **commented out** (clearly marked `>>>>>>>> COMMENTED OUT`, near
     the end of the file) instead of leaving `<YOUR-PROJECT-REF>` /
     `<YOUR-CRON-SECRET>` placeholders active — those would not error the
     run out (they're just string literals), they'd silently schedule a
     cron job that calls a fake URL with a fake secret forever, which is
     worse than an error because nothing would tell you it's broken. Once
     you've deployed the `backup-verify` Edge Function (step 4 below) and
     have its real secret, come back to that block, uncomment it, fill in
     both real values, and run just that block on its own.
   - If your SQL Editor rejects the whole file with something like
     `relation "AS" does not exist` (a parser-level error, not a real
     missing-table error), that's a paste getting corrupted on its way
     into a browser code editor, not a problem with the file — see
     "Manual step-by-step alternative" below for a way to split it up.
3. **Deploy the Edge Functions** from `../supabase/functions/` using the
   Supabase CLI (`supabase functions deploy <name>` for each of the 5
   folders: `create-staff-account`, `send-email`, `send-sms`,
   `reception-shift-notify`, `backup-verify`). `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the platform for
   every function — nothing to set for those. Beyond that, each function
   needs its own secrets configured in **Project Settings → Edge Functions →
   Secrets** (or `supabase secrets set`):

   | Function | Required for | Secrets to set |
   |---|---|---|
   | `create-staff-account` | Creating staff logins from the in-app Staff page | *(none — uses only the auto-injected ones)* |
   | `send-email` | Generic email dispatch (low-stock alerts, reminders, etc.) | `RESEND_API_KEY` (from [resend.com](https://resend.com) → API Keys), `EMAIL_FROM` |
   | `send-sms` | SMS/WhatsApp appointment & follow-up reminders | `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER_ID` (optional) — from whichever SMS gateway you pick; there's no single universal source, this depends on your provider |
   | `reception-shift-notify` | Open/Close Shift email notifications | `RESEND_API_KEY`, `EMAIL_FROM` (same Resend account as `send-email`) |
   | `backup-verify` | Automated backup-verification alert (cron-triggered) | `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL` (alert recipient), `BACKUP_VERIFY_SECRET` (a secret you invent, used to authenticate the cron trigger's call to this function) |

   ⚠️ **None of these functions work until their secrets above are set —
   this is expected on a fresh project, not a bug.** In particular, Open/
   Close Shift email notifications will fail with a toast like "Email
   provider not configured — set RESEND_API_KEY via `supabase secrets
   set`" until `reception-shift-notify`'s secrets are configured; this
   never blocks opening or closing the shift itself, it only means the
   admin notification email doesn't go out yet. **Verify every function's
   deployment + secret status from inside the app**: Settings → Edge
   Function Health Check pings each function with a harmless test payload
   and reports whether it's deployed and whether its secret is configured
   — check it after step 4 below (deploying the app), before assuming a
   notification failure is a real bug rather than a not-yet-configured
   secret.

   ⚠️ **Set `EMAIL_FROM` explicitly — don't rely on the code default.** All
   three email-sending functions fall back to
   `"Friendship Hospital HIS <noreply@friendshiphospital.example>"` if
   `EMAIL_FROM` isn't set, which would put *Friendship Hospital's* name on a
   different hospital's outgoing email. Set it to something like
   `"Your Hospital Name <noreply@yourdomain.com>"` — using a sender address
   on a domain you've verified with your email provider (a free provider
   sandbox address like `onboarding@resend.dev` also works as a stopgap, but
   typically only delivers to the account owner's own inbox until a domain is
   verified).
4. **Deploy the whole folder** (`index.html` plus `assets/`, `sw.js`, etc. —
   not just the `index.html` file on its own) to your static host, e.g.
   Vercel connected to this repo via its Git integration. No build step.
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

### Manual step-by-step alternative (base schema + each migration separately)

Prefer running the setup in smaller pieces — e.g. because your SQL Editor
chokes on one very large paste — instead of the combined file in step 2
above? The same content is also available split into its original files,
run in this exact order:

1. `migrations/FriendshipHospital_HIS_v1_Schema.sql` — the base schema.
   Two of its `CREATE EXTENSION` statements (`pg_cron`, `pg_net`) require
   those extensions enabled for your project — Supabase enables them by
   default on new projects, but if either errors out as unavailable,
   enable it under Database → Extensions first and re-run.
   - If the SQL Editor itself rejects the file with something like
     `relation "AS" does not exist` (a parser-level error, not a real
     missing-table error), that's a paste getting corrupted on its way
     into a browser code editor — split it into smaller chunks and paste
     each separately. Confirmed reproducible this way once; splitting the
     same unmodified file into 5 pieces (by object type:
     extensions/sequences/tables/constraints, FK/CHECK constraints,
     indexes, RLS/functions/triggers, policies) and running each on its
     own applied every statement with zero errors.
2. Then every incremental migration, in **numeric version order** (not
   filename string order — `v2.9` sorts before `v2.10` the wrong way in a
   plain file listing):
   ```
   v2.8 → v2.9 → v2.10 → v2.11 → v2.12 → v2.13 → v2.14 → v2.15 → v2.16 →
   v2.17 → v2.18 → v2.19 → v2.20 → v2.21 → v2.22 → v2.23 → v2.24 → v2.25 →
   v2.26 → v2.27 → v2.28 → v2.29 → v2.30 → v2.31 → v2.32 → v2.33 → v2.34 →
   v2.35 → v2.36 → v2.37 → v2.38 → v2.39 → v2.40 → v2.41 → v2.42 → v2.43 →
   v2.44 → v2.45 (both files) → v2.46 → v2.47 → v2.48 → v2.49 → v2.50 →
   v2.51 → v2.52 → v2.53
   ```
   Two files share the `v2.45` version number
   (`migration_v2.45_lab_reference_ranges.sql` and
   `migration_v2.45_followup_reminders.sql`) — both are independent, order
   between the two of them doesn't matter, but both must run after every
   lower-numbered file and before `v2.46`.
   - `migration_v2.46_backup_verify_cron.sql` has two placeholders
     (`<YOUR-PROJECT-REF>`, `<YOUR-CRON-SECRET>`) that must be hand-edited
     before running it — it is not paste-and-run like the others. See that
     file's own header comment for what to fill in and when.
   - `migration_v2.52_rls_gap_closure.sql` closes a real security gap (15
     tables had zero row-level security before it). **Do not skip it.**
   - `migration_v2.53_beds_realtime_publication.sql` fixes the live
     bed-grid's Realtime sync, which silently doesn't work without it.
   - This full chain — base schema through `v2.53` — is exactly what
     `COMBINED_full_setup_base_through_v2.53.sql` above already is, just
     split back into its original per-file pieces.

## Testing branding/assets before going live

`index.html`'s logo and login/launcher background image
(`assets/branding/elmohajir-logo.png`, `assets/branding/login-bg-glow.png`)
are referenced by a plain relative path, so they resolve correctly wherever
the `assets/` folder sits alongside `index.html` — a real deployment serving
the whole repo, or a full local clone/download opened directly in a browser
(confirmed working via `file://` too). The only way branding breaks is
copying just the single `index.html` file somewhere without its `assets/`
folder (GitHub's "raw" single-file view, an email attachment, pasting the
file alone into an empty folder) — that's a missing-files situation, not a
bug in the app or in your hospital's configuration, and it's unrelated to
whether Supabase is connected yet (the login screen renders branding before
any backend call).

**Recommended: verify with a real (even throwaway) deployment** before
considering setup done — it exercises the exact same path production uses,
and catches anything else path-related beyond just the logo:

1. On vercel.com: **Add New → Project → Import Git Repository**, connect
   your GitHub account (granting it access to this repo if it's private),
   and select it.
2. Framework Preset: **Other**. Leave Build Command and Output Directory
   blank — there's no build step. Set **Root Directory** to `template` to
   test this de-identified starter kit specifically (so
   `template/index.html` becomes that deployment's `/`); leave it at the
   repo root to test the live Friendship Hospital `index.html` instead.
3. Click **Deploy**. This creates a new, separate Vercel project — it does
   not touch or affect your real production deployment, regardless of which
   branch you point it at.
4. Open the resulting `<project>.vercel.app` URL. The login screen should
   show the Elmohajir logo and background glow immediately.
5. Delete the throwaway project afterward (Project Settings → Delete) once
   you're satisfied.

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
