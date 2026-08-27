-- ═══════════════════════════════════════════════════════════════════════
-- migration_v2.53_beds_realtime_publication.sql
--
-- Wires the `beds` table into the `supabase_realtime` publication so the
-- bed-grid's Postgres Changes subscription actually receives live updates.
--
-- index.html's loadBedGrid() multi-device sync (sb.channel('beds-grid-
-- realtime').on('postgres_changes', {event:'*', schema:'public',
-- table:'beds'}, ...)) has been in the app since the bed-grid feature was
-- built, but no migration ever added `beds` to the `supabase_realtime`
-- publication — the one piece of DB-level config Supabase's Postgres
-- Changes feature actually requires per table. Confirmed via a live
-- introspection diff (2026-08-26) against both Friendship Hospital's real
-- production project and a fresh throwaway project: `select * from
-- pg_publication_tables where pubname = 'supabase_realtime'` returns zero
-- rows on BOTH — so this has never worked on production either, not just
-- on fresh projects. Not a fresh-vs-real gap; a standalone bug.
--
-- Idempotent — ADD TABLE IF NOT EXISTS wasn't available for publications
-- until relatively recent Postgres versions, so this guards manually via
-- pg_publication_tables instead of assuming a bare ADD TABLE won't error
-- on a second run.
-- ═══════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'beds'
  ) then
    alter publication supabase_realtime add table public.beds;
  end if;
end $$;

-- To confirm it's now live:
--   select * from pg_publication_tables where pubname = 'supabase_realtime';
-- Should include a row for schemaname='public', tablename='beds'.
