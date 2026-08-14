-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.20_bed_status_expansion.sql
-- Bed Management (IPD) overhaul, Phase 2 — expand beds.status beyond
-- Available/Occupied so the visual ward bed-grid can show four states.
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   public.beds (id, ward, room, bed_number, status, current_patient_id,
--   current_admission_id) is a pre-existing table (older than the
--   numbered migration_v2.x series — no migration file in this repo
--   created it). Every place in index.html that writes beds.status today
--   only ever writes 'Available' or 'Occupied':
--     addBedConfig()      -> insert status:'Available'
--     submitAdmission()   -> update status:'Occupied' (on admit)
--     saveDischarge()     -> update status:'Available' (on discharge)
--     (bulk cleanup path) -> update status:'Available'
--   There is no evidence beds.status currently has a check constraint at
--   all (nothing in this repo defines one), but since the column has only
--   ever been written as one of those two literal strings, whatever
--   constraint (if any) exists in the live database was likely never
--   exercised beyond them. This migration is defensive either way: it
--   drops any existing check constraint by name (if present) and adds a
--   new one covering all five values, which is a no-op for existing rows
--   since 'Available'/'Occupied' are both still included.
--
-- WHAT THIS ADDS
--   Two more states so the bed-grid (Phase 2) can render:
--     Available        (green)  — unchanged, already exists
--     Occupied          (red)   — unchanged, already exists
--     Cleaning          (amber) — bed vacated, being turned over
--     Maintenance       (amber) — bed out of service (repair, etc.)
--     Discharge Pending (blue)  — patient still physically in the bed,
--                                  discharge process started but the bed
--                                  is not free yet
--   'Cleaning' and 'Maintenance' are kept as two distinct values (not
--   collapsed into one "Cleaning/Maintenance" string) because Phase 5b's
--   turnaround SLA timer needs to know which one it's timing, even though
--   both currently render with the same amber tile treatment in the grid.
--
-- Nothing in this file touches current_patient_id/current_admission_id
-- semantics or any existing row's status value — purely additive.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.19.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.beds drop constraint if exists beds_status_check;

alter table public.beds add constraint beds_status_check
  check (status in ('Available','Occupied','Cleaning','Maintenance','Discharge Pending'));

alter table public.beds alter column status set default 'Available';

comment on column public.beds.status is
  'Bed-grid status (Bed Management / IPD, index.html). Available/Occupied are the original two values, written by submitAdmission()/saveDischarge(). Cleaning, Maintenance and Discharge Pending are set manually from the bed-grid tile menu (setBedStatus() in index.html) — Cleaning/Maintenance block new admissions client-side; Discharge Pending is informational only (the bed frees for real when saveDischarge() actually runs).';

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.20_bed_status_expansion.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select status, count(*) from public.beds group by status;
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.beds'::regclass;
-- ═══════════════════════════════════════════════════════════════════════
