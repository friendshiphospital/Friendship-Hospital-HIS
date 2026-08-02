-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.23_discharge_planning_started_at.sql
-- Bed Management (IPD) overhaul, Phase 5c — discharge-readiness flag
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   The spec's second trigger condition ("a discharge summary exists in
--   draft but hasn't been finalized") assumes draft semantics that do not
--   exist in this schema: discharge_summaries has no status/draft column
--   at all, and saveDischarge() (index.html) is atomic — filling in the
--   discharge form and submitting it inserts the summary, marks the
--   admission Discharged, AND frees the bed all in one action. There is
--   no half-finished state a discharge summary can be left in today, and
--   building one (a real "Save Draft" vs "Finalize Discharge" split)
--   would restructure a working, tested flow far beyond what a tile badge
--   calls for.
--
--   The honest, low-risk equivalent implemented instead: track when
--   discharge PLANNING started (the Discharge form was opened for this
--   admission) via one new nullable timestamp column, set once by
--   openDischarge() and left alone afterward. If the admission is still
--   Active despite that timestamp being set, discharge was started but
--   never completed — the same practical signal the spec's condition was
--   after, without inventing draft-state schema/UI nothing else asked for.
--
-- WHAT THIS ADDS
--   admissions.discharge_planning_started_at, read by
--   dischargeReadinessFlag() in index.html (bed-grid tile badge, Occupied/
--   Discharge Pending beds only) alongside the LOS-vs-ward-average
--   condition — either is sufficient to show the "🏁 Check discharge?"
--   badge. Purely a prompt for the charge nurse; nothing reads or writes
--   this column to change behavior automatically.
--
-- Idempotent — safe to re-run. This file only produces SQL for review; it
-- is not applied automatically. Run after migration_v2.22.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.admissions add column if not exists discharge_planning_started_at timestamptz;

comment on column public.admissions.discharge_planning_started_at is
  'Set once, the first time openDischarge() (index.html) opens the discharge form for this admission. Read by dischargeReadinessFlag() as one of two rule-based, non-predictive triggers for the bed-grid "Check discharge?" badge — the other is LOS exceeding the ward''s own current average. Never cleared, but only matters while admissions.status is still Active (a Discharged admission is no longer shown as an Occupied bed-grid tile at all).';

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.23_discharge_planning_started_at.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select status, count(*) filter (where discharge_planning_started_at is not null)
--     from public.admissions group by status;
-- ═══════════════════════════════════════════════════════════════════════
