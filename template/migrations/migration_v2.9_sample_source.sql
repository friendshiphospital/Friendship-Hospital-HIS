-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.9_sample_source.sql
-- Adds sample source tracking to sample_records (Phase 1 of the
-- barcode-scanning / sample-source feature pass)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- sample_source records where a sample was collected from (ICU, Phlebotomy,
-- Theatre/OT, Room 1-4, or a free-text "Other Departments" value), set via
-- the required "Sample Source" dropdown on the Sample Collection page and
-- surfaced as a filterable/sortable column on the Lab Worklist. Plain text
-- column, matching how sample_records.status and every other
-- dropdown-driven field in this schema is stored (no CHECK constraint —
-- validation happens client-side, consistent with the rest of the app).

alter table public.sample_records add column if not exists sample_source text;

comment on column public.sample_records.sample_source is
  'Where the sample was collected from: ICU, Phlebotomy, Theatre/OT, Room 1-4, or a free-text value when "Other Departments" was picked. Set at collection via the Sample Collection page; shown as a filterable/sortable column on the Lab Worklist.';

-- No RLS policy changes needed: this is a new column on an existing table,
-- and sample_records' existing INSERT/UPDATE policies (see
-- migration_v2.8_rls_security.sql) already cover row-level access —
-- RLS does not do column-level restriction, so nothing to update there.

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.9_sample_source.sql
-- ═══════════════════════════════════════════════════════════════════════
