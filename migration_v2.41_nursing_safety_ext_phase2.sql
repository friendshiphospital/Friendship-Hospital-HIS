-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.41_nursing_safety_ext_phase2.sql
-- Nursing Safety Extension, Phase 2 (NEWS2 escalation)
-- ═══════════════════════════════════════════════════════════════════════
--
-- NEWS2 >=7 opens a blocking "Strike Rapid Response Team (RRT)" modal
-- (index.html: openRrtAck()/submitRrtAck()), reusing the same acknowledge-
-- with-real-read-back discipline as Critical Values acknowledgement
-- (openCritAck()/submitCritAck()) rather than a bare confirm(). These
-- columns record that acknowledgement on the same vital_signs row the
-- NEWS2 score itself lives on.
--
-- No schema change for the NEWS2 3-6 "hourly monitoring" flag on the
-- Nursing Queue -- it's computed live from the existing news2_score column,
-- no new state to persist for a visible-flag-only feature (explicitly no
-- notification-bell integration in this pass).
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.vital_signs
  add column if not exists rrt_acknowledged boolean,
  add column if not exists rrt_acknowledged_by text,
  add column if not exists rrt_acknowledged_at timestamptz,
  add column if not exists rrt_notified_to text,
  add column if not exists rrt_notes text;

comment on column public.vital_signs.rrt_acknowledged is 'Set true once the nurse confirms Rapid Response Team activation for a NEWS2 >=7 reading (index.html submitRrtAck()) — a real re-typed-score read-back, not a bare confirmation.';
comment on column public.vital_signs.rrt_notified_to is 'Name of the RRT / on-call doctor notified for this escalation.';
