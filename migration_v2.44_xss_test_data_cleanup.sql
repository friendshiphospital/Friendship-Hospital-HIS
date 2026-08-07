-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.44_xss_test_data_cleanup.sql
-- Cleanup for the live XSS test payload accepted into a patient name
-- field during an earlier security-testing pass (MRN 522), plus a
-- general sweep for any other row carrying the same class of payload.
-- ═══════════════════════════════════════════════════════════════════════
--
-- CONTEXT: an earlier session confirmed the app's registration form
-- accepted `<img src="x" onerror="stealCookies()" />` (and similar) into
-- a patient name field, and that this rendered as live markup in some
-- (now-fixed) display locations. That test record is still sitting in the
-- live database under MRN 522. index.html now has both defenses in place:
--   - Root-cause: registration blocks HTML metacharacters (< > & " ') in
--     name fields outright (regValidate()/submitRegistration()).
--   - Defense-in-depth: every display location that renders a patient name
--     into HTML now escapes it (escapeHtml()/escAttr()).
-- Neither of those retroactively cleans up data already sitting in the
-- database from BEFORE those fixes existed — that's what this file does.
--
-- SAFE BY DESIGN: this is a two-step, review-first process.
--   Step 1 (SELECT) — run this first and actually look at the results.
--     It finds every row in patients / patients_master / follow_ups whose
--     name-ish fields contain HTML metacharacters, not just MRN 522 --
--     there may be other rows from the same testing session.
--   Step 2 (UPDATE) — commented out by default. Only run it after you've
--     reviewed Step 1's output and confirmed every listed row really is
--     test/poisoned data, not a real patient whose name happens to
--     contain an apostrophe or similar. It does NOT delete anything --
--     it strips HTML metacharacters from the affected text fields in
--     place, preserving the row, its MRN/File/Lab numbers, and every
--     other field untouched.
--
-- Idempotent — safe to re-run; rows already clean simply won't match.
-- ═══════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────
-- STEP 1 — locate every affected row. RUN THIS FIRST AND REVIEW IT.
-- ───────────────────────────────────────────────────────────────────────

select 'patients' as table_name, id, mrn, visit_no, first_name, middle_name, last_name, name, next_of_kin_name, created_at
from public.patients
where first_name ~ '[<>&"'']' or middle_name ~ '[<>&"'']' or last_name ~ '[<>&"'']'
   or name ~ '[<>&"'']' or next_of_kin_name ~ '[<>&"'']'
order by created_at desc;

select 'patients_master' as table_name, mrn, first_name, middle_name, last_name, name
from public.patients_master
where first_name ~ '[<>&"'']' or middle_name ~ '[<>&"'']' or last_name ~ '[<>&"'']' or name ~ '[<>&"'']';

select 'follow_ups' as table_name, id, patient_mrn, scheduled_by_name, reason
from public.follow_ups
where scheduled_by_name ~ '[<>&"'']' or reason ~ '[<>&"'']';

-- Specifically confirm MRN 522's current state:
select id, mrn, visit_no, first_name, middle_name, last_name, name, next_of_kin_name
from public.patients
where mrn = '522';

select mrn, first_name, middle_name, last_name, name
from public.patients_master
where mrn = '522';


-- ───────────────────────────────────────────────────────────────────────
-- STEP 2 — sanitize the affected fields. REVIEW STEP 1's OUTPUT FIRST.
-- Uncomment and run only once you've confirmed these are test/poisoned
-- rows, not a real patient's data. Strips HTML metacharacters ( < > & " ' )
-- from each affected column; every other field on the row is untouched.
-- ───────────────────────────────────────────────────────────────────────

-- update public.patients set
--   first_name       = regexp_replace(first_name, '[<>&"'']', '', 'g'),
--   middle_name      = regexp_replace(middle_name, '[<>&"'']', '', 'g'),
--   last_name        = regexp_replace(last_name, '[<>&"'']', '', 'g'),
--   name             = regexp_replace(name, '[<>&"'']', '', 'g'),
--   next_of_kin_name = regexp_replace(next_of_kin_name, '[<>&"'']', '', 'g')
-- where first_name ~ '[<>&"'']' or middle_name ~ '[<>&"'']' or last_name ~ '[<>&"'']'
--    or name ~ '[<>&"'']' or next_of_kin_name ~ '[<>&"'']';

-- update public.patients_master set
--   first_name  = regexp_replace(first_name, '[<>&"'']', '', 'g'),
--   middle_name = regexp_replace(middle_name, '[<>&"'']', '', 'g'),
--   last_name   = regexp_replace(last_name, '[<>&"'']', '', 'g'),
--   name        = regexp_replace(name, '[<>&"'']', '', 'g')
-- where first_name ~ '[<>&"'']' or middle_name ~ '[<>&"'']' or last_name ~ '[<>&"'']' or name ~ '[<>&"'']';

-- update public.follow_ups set
--   scheduled_by_name = regexp_replace(scheduled_by_name, '[<>&"'']', '', 'g'),
--   reason             = regexp_replace(reason, '[<>&"'']', '', 'g')
-- where scheduled_by_name ~ '[<>&"'']' or reason ~ '[<>&"'']';

-- If, after reviewing Step 1, MRN 522 turns out to be a pure test
-- registration with no real downstream clinical/billing data you need to
-- keep (no genuine orders, results, or invoices attached), you may prefer
-- to delete it outright instead of sanitizing it in place. Left as a
-- manual decision -- deliberately not scripted here, since deleting a
-- patient record is not reversible and this migration can't know whether
-- other tables (results_*, invoices, doctor_orders, etc.) reference it.
