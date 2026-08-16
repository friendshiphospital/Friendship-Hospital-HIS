-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.49_add_missing_is_released_columns.sql
-- Add the release-tracking columns that enforce_result_lock() expects but
-- the results_* tables never actually had
-- ═══════════════════════════════════════════════════════════════════════
--
-- ROOT CAUSE (confirmed live, via the reviewer running the diagnostic
-- queries from the prior message — not guessed):
--
--   public.enforce_result_lock() (a pre-existing BEFORE UPDATE trigger on
--   the results_* tables, not defined in any migration file in this
--   checkout — see migration_v2.8_rls_security.sql's own comments about
--   it) contains:
--
--     if (old.is_verified is true or old.is_released is true) then ...
--
--   `select table_name, column_name, data_type, column_default from
--   information_schema.columns where table_name like 'results_%' and
--   column_name in ('is_verified','is_released')` came back with
--   is_verified present (boolean, default false — NULL on the two
--   *_history tables) on every results_% table, but is_released absent
--   from ALL of them. Referencing old.is_released against a row type that
--   has no such column is exactly what raises Postgres's
--   "record 'old' has no field 'is_released'" — reproduced by entering a
--   fresh result (INSERT succeeds — the trigger only fires on UPDATE, so
--   a brand-new row's own insert never touches this code path) and then
--   clicking Verify (an UPDATE via .upsert(...,{onConflict:'patient_id'}),
--   which does fire the trigger and immediately fails).
--
--   This matches the FIRST fix option from the task, not the other two:
--   the column is genuinely missing, not a case of a generically-shared
--   trigger attached to a table it was never meant to run on (the app's
--   own JS code — releaseResults(), releaseAllUnifiedEntry(),
--   printAllReports(), DEPT_LOAD_MAP — has always read and written
--   is_released/released_at/released_by on all 7 of these tables; the
--   database just never actually had the columns for it to persist to),
--   and not a typo/name-mismatch (is_verified, the sibling column the
--   trigger also checks, exists and works correctly under that exact
--   name).
--
-- SCOPE: the 7 "live" results_* tables the app's Unified Results Entry /
-- Release workflow actually reads and writes per-patient
-- (results_hematology, results_chemistry, results_serology,
-- results_microbiology, results_pcr, results_histopathology,
-- results_cytology) — the same list migration_v2.8_rls_security.sql's
-- audited_tables array uses for the results_* portion of its audit
-- trigger. Deliberately NOT extended to results_hematology_history /
-- results_chemistry_history (the only two *_history tables that matched
-- table_name like 'results_%' in the diagnostic query, which is why they
-- showed up with a NULL is_verified default rather than false): those are
-- written INSERT-only (see logResultHistory() / migration_v2.17 — one row
-- per SAVE, an append-only audit trail, never updated after the fact), so
-- a BEFORE UPDATE trigger never fires against them regardless of which
-- columns they have, and no JS code anywhere reads or writes is_released
-- on either history table. Adding it there would be unused schema, not a
-- fix for anything.
--
-- Types/defaults: is_released matches is_verified's own pattern on these
-- same 7 tables exactly (boolean, not null, default false — a fresh row
-- is never released). released_at/released_by match the existing
-- verified_at/performed_by sibling columns' conventions already used
-- everywhere else in this schema (timestamptz set from the client's
-- new Date().toISOString(), uuid set from currentProfile.id / auth.uid()).
--
-- Uses ADD COLUMN IF NOT EXISTS throughout — idempotent and additive
-- only; safe to re-run, and safe even if a column turns out to already
-- exist under this exact name on some table for a reason this diagnostic
-- pass didn't catch. This migration does not touch enforce_result_lock()
-- itself, any other function, or any existing migration file — once these
-- columns exist, the trigger's existing logic (unmodified) resolves
-- old.is_released correctly on its own.
--
-- NOT applied automatically — for manual review and application in the
-- Supabase SQL editor, per our normal process.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  tbl text;
  tables text[] := array[
    'results_hematology','results_chemistry','results_serology',
    'results_microbiology','results_pcr','results_histopathology','results_cytology'
  ];
begin
  foreach tbl in array tables loop
    execute format('alter table public.%I add column if not exists is_released boolean not null default false', tbl);
    execute format('alter table public.%I add column if not exists released_at timestamptz', tbl);
    execute format('alter table public.%I add column if not exists released_by uuid', tbl);
    raise notice '%: is_released/released_at/released_by present (added if missing)', tbl;
  end loop;
end $$;
