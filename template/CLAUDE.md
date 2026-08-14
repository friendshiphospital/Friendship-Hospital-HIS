# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Friendship Hospital HIS (Hospital Information System) for Friendship Hospital, Al Damazin, Blue Nile State, Sudan — a single-page vanilla HTML/CSS/JS application backed by Supabase (PostgreSQL + Auth). There is no build step, no bundler, no npm, and no test framework: `index.html` **is** the application, loaded directly by the browser.

- Currency: SDG (Sudanese Pounds)
- Clinical standards referenced in the code/UI: ISO 15189, CLSI GP41, CAP, NEWS2, NPUAP
- Current version: v2.7 (see `<span class="ver">HIS v2.7</span>` / `<span class="auth-ver">` in `index.html`, and `CHANGELOG.md` for history up to v2.6)

## Repository structure

```
index.html        The entire application: <style>, markup, and one big <script> block (~12k lines total)
sw.js              Service worker — caches the app shell + Supabase JS CDN script for offline load (never caches Supabase API traffic)
CHANGELOG.md        Version history and required SQL migration order (up through v2.6)
README.md           Setup instructions, module summary, role/page access table
Old*.index.html, G.34.index.html, Ol*.index.html, iold.*.index.html
                     Superseded snapshots of index.html from earlier versions, kept as history via GitHub's
                     web-upload "rename" workflow (see git log: each is a renamed prior index.html).
                     Do not edit these or treat them as current — only index.html is live.
```

There is no `package.json`, build tooling, or automated test suite. SQL migration files referenced in `README.md`/`CHANGELOG.md` (`FriendshipHospital_HIS_v1_Schema.sql`, `migration_v2*.sql`) are not present in this checkout — schema changes historically shipped as separate SQL files applied manually in the Supabase SQL editor; if you need to change the schema, write a new migration SQL file rather than assuming one exists.

## Development workflow

There is no build/install command — this is deployed by uploading `index.html` directly (e.g. to Vercel, which auto-deploys on push). To work on it:

1. Edit `index.html` directly (or `sw.js` for offline-caching behavior).
2. Check JS syntax before committing, since there's no linter or test runner. The inline `<script>` block can be checked with Node by extracting it:
   ```bash
   awk '/^<script>$/{flag=1;next}/^<\/script>$/{flag=0}flag' index.html > /tmp/_extracted.js && node --check /tmp/_extracted.js
   ```
   (There is only one `<script>...</script>` block containing app logic — the other two `<script src=...>` tags near the top are CDN includes for Supabase JS and JsBarcode.)
3. Manually verify in a browser against a real (or scratch) Supabase project — enter the Supabase URL/anon key via the "⚙ Supabase Configuration" panel on the login screen (stored in `localStorage` as `sb_url`/`sb_key`).
4. There is no automated test suite. Verifying a change means exercising the relevant page/role in the browser and checking the Supabase tables directly.

When making changes, keep everything in the single `index.html` file consistent with the existing patterns below — this codebase intentionally has no module system, so new code should follow the same globals/functions style rather than introducing imports, bundling, or frameworks.

## Architecture

### Single-file SPA, hash-free client routing

All "pages" are `<div class="page" id="page-<name>">` elements in the DOM at once; only one has the `active` class at a time. Navigation goes through `goPage(pageName)` (~line 5422), which:
- Enforces role access via `ROLE_PAGES[role]` (an admin bypasses this check entirely).
- Toggles `.active` on the target `#page-<name>` and the matching sidebar `.sb-item[data-p="<name>"]`.
- Updates the topbar title from `PAGE_TITLES`.
- Runs page-specific init/load calls (e.g. `p==='dashboard'` → `loadDashboard()`), including setting default date inputs and kicking off async loaders — this function is the de facto router + controller dispatch table, so any new page must be wired in here.

The sidebar (`#sidebar`) is grouped by department (Reception, Hospital, Laboratory, Billing, Analytics, Administration) and every item calls `goPage(...)` directly via inline `onclick`.

### Auth and role-based access control

- Auth is Supabase Auth (`sb.auth.signInWithPassword`). On login, `loadProfile()` fetches the matching row from the `staff` table by `user_id` (Supabase Auth UUID) to get `full_name`/`role`; if no staff row is linked, it silently defaults to `role:'admin'`.
- `currentUser` / `currentProfile` are the two global session objects everything else reads.
- `ROLE_PAGES` (~line 5199) is the single source of truth mapping each role (`admin`, `doctor`, `nurse`, `lab_tech`, `lab_supervisor`, `receptionist`, `cashier`, `theatre_nurse`, `radiologist`) to its allowed page IDs. `filterSidebar()` hides disallowed sidebar items visually; `goPage()` enforces it functionally. Both must be consistent with any new page.
- There is no server-side page-level authorization in this file — RLS policies in Supabase are the real security boundary; the client-side role gating is UX only.

### Supabase access + offline-first writes

- `sb` is the single global Supabase client, created by `initSupabase()` from `localStorage` (`sb_url`, `sb_key` — the anon public key only, never `service_role`).
- Reads generally go straight through `sb.from(table).select(...)`.
- Writes should go through `dbWrite(table, op, payload, opts)` (~line 4955), not `sb.from(...)` directly, wherever offline resilience matters — patient registration, results entry, vitals, invoices, etc. `dbWrite`:
  - Tries the network call first (`insert`/`upsert`/`update`).
  - On a genuine network failure (`isNetworkError`), transparently queues the write into IndexedDB (`queueWrite`) instead of throwing, and returns `{ok:true, queued:true}`.
  - Real Postgrest/Supabase errors (bad payload, RLS rejection, etc.) still throw, so existing validation/toast error handling keeps working.
- Queued writes live in IndexedDB (`fh_his_offline` DB, `pending_writes` store) and are flushed by `flushOfflineQueue()`: on `online` events, every 30s while online, and on manual "🔄 Sync Now" from the sync panel (`#sync-panel`, toggled by the connection badge in the sidebar).
- `sw.js` separately caches the app shell (HTML + the Supabase JS CDN bundle) with stale-while-revalidate, explicitly excluding all `supabase.co` API traffic — the service worker is only for making the app loadable offline, not for caching data.
- ID generation: prefer the offline-safe path. Sequential file/lab/radiology/admission numbers are generated via a `generate_next_id()` Supabase RPC (optimistic-concurrency counter table, not `MAX(id)+1` on the live table) so two devices can't collide; `COUNTER_TO_ID_TYPE`/`ID_START`/`maxNumericField()` provide client-side fallback/self-healing if the RPC can't be reached. `genOfflineId(prefix)` is a separate, purely local fallback (date + random suffix) for fully-offline-created records.

### Domain data structures worth knowing before editing lab/results code

- `DEPT_META` (~line 5300) is the hub connecting a lab department (`hem`, `chem`, `sero`, `immuno`, `micro`, `pcr`, `histo`, `cyto`) to its result-entry page ID, patient-ID input field, save function name, print function name, and worklist keyword matching. The unified results-entry page and the worklist department filter both key off this object — add new departments here first.
- `TEST_CATALOG`, `TUBE_TYPES`, and `TEST_TUBE_MAP` define what tests exist per department and which collection tube each test needs; `getRequiredTubes()` dedupes tubes across a patient's ordered tests (e.g. CBC + ESR + Blood Film all share one EDTA tube).
- `CRIT_RANGES` defines the critical-value thresholds (ISO 15189 §5.8) that drive auto-flagging on Haematology/Chemistry save and the Critical Values page/banner.
- Printing is done by building an HTML string and opening it in a new window (`window.open(...)` then `document.write(...)`), styled for A4 with a `.no-print` toolbar — see `printHeader()`/`printFooter()` (~line 5730) for the shared chrome, and the many `print<X>Report()` functions for per-document layouts (discharge summary, prescriptions, lab reports, etc.). Follow this same window.open + document.write pattern for any new printable document rather than introducing a PDF library.

### Configuration

Hospital-level settings (name, address, currency, lab prefix, footer text) are read through the `CFG` object (~line 5189), which is just a thin getter wrapper over `localStorage` values set from the Settings page — not stored in Supabase. Supabase URL/key are similarly `localStorage`-only (`sb_url`, `sb_key`), entered via the login screen's "⚙ Supabase Configuration" panel or the Settings page's Supabase Connection card.

## Roles and page access (from README.md)

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

This table must stay in sync with `ROLE_PAGES` in `index.html` — if you change one, check the other.

## Security notes

- Never commit real Supabase URLs/anon keys into the repo (they're meant to live only in each deployment's `localStorage`, entered at runtime).
- Always use the `anon public` Supabase key client-side — never `service_role`. Row-Level Security (RLS) policies in Supabase are what actually restrict table access per authenticated user; the client-side `ROLE_PAGES`/`filterSidebar` logic is UX convenience only, not a security boundary.
