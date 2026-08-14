-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.42_nursing_safety_ext_phase3.sql
-- Nursing Safety Extension, Phase 3 (Turning Clock, Post-Analgesia,
-- MAR overdue status)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Both new flags are timestamp-anchored, matching the project-wide rule
-- that no timer/countdown may live only in client memory (a page refresh
-- or a device losing power must never reset it) -- overdue state is always
-- recalculated from Date.now() minus the stored timestamp below, on every
-- render (index.html: renderTurningStatus(), renderPostAnalgesiaStatus(),
-- and their re-derivation on the Nursing Queue via nursingQueueAlertBadges()).
--
-- turning_position is set by logTurningPosition() each time a nurse logs a
-- repositioning; the Turning Clock reads the most recent row where this is
-- non-null. analgesia_administered_at is stamped by saveMAR() when an
-- IV/Oral analgesic is marked Given; the post-analgesia flag clears once a
-- vital_signs row with a newer pain_score exists (pain_score already
-- existed on this table before this migration).
--
-- No schema change needed for the MAR overdue (on-time/due/overdue) badge
-- -- it's derived live from each MAR row's existing "Time Due" field
-- (mar_entries[].time, a jsonb value), not persisted separately.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.vital_signs
  add column if not exists turning_position text,
  add column if not exists analgesia_administered_at timestamptz;

comment on column public.vital_signs.turning_position is 'Turning Clock (Nursing Safety Ext. Phase 3) — Left/Right/Supine/Prone, set by logTurningPosition(). The most recent non-null row is the current anchor; overdue = now - that row''s recorded_at >= 2 hours.';
comment on column public.vital_signs.analgesia_administered_at is 'Post-Analgesia Reassessment (Nursing Safety Ext. Phase 3) — stamped by saveMAR() when an IV/Oral analgesic is marked Given. Flag clears once a vital_signs row with a newer pain_score exists.';
