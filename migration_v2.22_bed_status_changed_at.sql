-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.22_bed_status_changed_at.sql
-- Bed Management (IPD) overhaul, Phase 5b — bed-turnaround SLA timer
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   public.beds has no timestamp column at all today, so there was no way
--   to know how long a bed had been sitting in any given status. This
--   codebase never uses database triggers for timestamp bookkeeping —
--   every other "when did this last change" field (e.g. results_*.
--   verified_at, doctor_consultations.signed_off_at) is set explicitly by
--   the client at write time, not by a trigger — so this migration keeps
--   that same convention rather than introducing the first trigger.
--
-- WHAT THIS ADDS
--   beds.status_changed_at, set by index.html on every write that changes
--   beds.status: submitAdmission() (Available -> Occupied), saveDischarge()
--   and submitBedTransfer() (-> Available / -> Occupied), setBedStatus()
--   (the bed-grid tile's manual status menu — Cleaning/Maintenance/
--   Discharge Pending), and addBedConfig() (initial insert). The bed-grid
--   tile (renderBedGrid() / bedTurnaroundMinutes() in index.html) reads
--   this to show elapsed time on Cleaning/Maintenance beds and escalate
--   the tile's colour past the two admin-configurable thresholds
--   (Settings -> Bed Turnaround SLA card).
--
-- Existing rows get status_changed_at backfilled to now() (Section 2) —
-- there's no earlier truth to backfill from, so "as of when this
-- migration ran" is the only honest starting point; every write after
-- that keeps it accurate going forward.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.21.
-- ═══════════════════════════════════════════════════════════════════════

-- SECTION 1 — add the column
alter table public.beds add column if not exists status_changed_at timestamptz;

comment on column public.beds.status_changed_at is
  'When beds.status last changed, set explicitly by index.html on every status-changing write (never a trigger — see migration file header). Drives the bed-grid turnaround SLA timer for Cleaning/Maintenance tiles.';

-- SECTION 2 — one-time backfill for existing rows only (does not touch
-- rows that already have a value, e.g. from a re-run of this migration)
update public.beds set status_changed_at = now() where status_changed_at is null;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.22_bed_status_changed_at.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select status, count(*), min(status_changed_at), max(status_changed_at)
--     from public.beds group by status;
-- ═══════════════════════════════════════════════════════════════════════
