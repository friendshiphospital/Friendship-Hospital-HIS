-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.16_reagent_inventory_rls.sql
-- Closes the reagent_inventory RLS gap flagged in migration_v2.14's
-- closing note.
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
--   migration_v2.8_rls_security.sql locked down 16 tables but never
--   included reagent_inventory — it predates that migration and was
--   simply missed. Every inventory table added afterwards in
--   migration_v2.14_inventory_upgrade.sql (inventory_batches,
--   stock_requisitions, purchase_orders, purchase_order_items) IS
--   properly locked down. reagent_inventory itself is the one gap left:
--   right now any authenticated user (any staff login, via the public
--   anon key) can read or write any row in it directly through the
--   PostgREST API, regardless of role.
--
-- THIS FILE DOES NOT REPLACE OR MODIFY migration_v2.8 OR migration_v2.14.
-- It depends on the helper functions migration_v2.8 already created
-- (public.is_admin(), public.is_clinical_staff(), public.is_billing_staff())
-- and adds one new helper in the same style for the one role grouping
-- that doesn't already have a helper matching it.
--
-- WHO ACTUALLY READS/WRITES reagent_inventory TODAY (from index.html)
--   1. Every authenticated session, regardless of role, reads it once per
--      notification-bell refresh — refreshNotifications() unconditionally
--      queries reagent_inventory for low-stock items and shows them to
--      whoever is logged in; it has no role check at all (see the
--      'Phase 6' notification-bell code, ~line 7017 in index.html). So
--      empirically, SELECT is used by all 9 roles today, not just the
--      ones with the Inventory page.
--   2. Full read/write via the Inventory page itself (loadInventory(),
--      editInventoryItem()/saveInventoryItem(), receiveBatchStock(),
--      dispenseFromInventoryFefo(), markBatchOpened()) is only reachable
--      by roles ROLE_PAGES grants the 'inventory' page to: admin, nurse,
--      lab_tech, lab_supervisor, theatre_nurse, radiologist. Doctor,
--      receptionist, and cashier have no 'inventory' entry in ROLE_PAGES
--      and no UI path to reach these functions.
--   3. There is no hard .delete() call on reagent_inventory anywhere in
--      index.html — "removing" an item is a soft-delete
--      (.update({is_active:false})). DELETE is still locked to admin-only
--      below, matching every other table in this project (defense in
--      depth, same as migration_v2.8/v2.14's convention).
--
-- DESIGN DECISION
--   SELECT is granted broadly (every role) to match what the app already
--   does today (#1 above) — tightening it to inventory-page roles only
--   would silently break the low-stock notification bell for doctor/
--   receptionist/cashier sessions, which is a behavior change outside
--   this migration's scope. INSERT/UPDATE is scoped to the roles that
--   actually have a UI path to mutate this table (#2 above), via a new
--   public.is_inventory_staff() helper — none of migration_v2.8's
--   existing helpers match this exact role set (is_clinical_staff()
--   includes doctor, who has no inventory access; is_lab_staff() is
--   narrower than the app's actual inventory-page grant).
--
-- Run this in the Supabase SQL editor, after migration_v2.8 and
-- migration_v2.14. Idempotent — safe to re-run. This file only produces
-- SQL for review; it is not applied automatically.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 1 — new helper: public.is_inventory_staff()
-- ───────────────────────────────────────────────────────────────────────
-- Matches ROLE_PAGES['inventory'] in index.html exactly, minus admin
-- (admin is always checked separately via is_admin() alongside this, same
-- convention as every other policy in migration_v2.8): nurse, lab_tech,
-- lab_supervisor, theatre_nurse, radiologist. Deliberately excludes
-- doctor, receptionist, cashier — none of those roles have the
-- 'inventory' page in ROLE_PAGES today.

create or replace function public.is_inventory_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_staff_role() in
    ('nurse','lab_tech','lab_supervisor','theatre_nurse','radiologist');
$$;

comment on function public.is_inventory_staff() is
  'Roles ROLE_PAGES grants the Inventory page to, excluding admin (checked separately): nurse, lab_tech, lab_supervisor, theatre_nurse, radiologist. Used to scope reagent_inventory writes to roles with an actual UI path to mutate it.';

revoke execute on function public.is_inventory_staff() from public;
grant execute on function public.is_inventory_staff() to authenticated;


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 2 — reagent_inventory
-- ───────────────────────────────────────────────────────────────────────

alter table public.reagent_inventory enable row level security;

drop policy if exists reagent_inventory_select on public.reagent_inventory;
create policy reagent_inventory_select on public.reagent_inventory
  for select
  using (
    public.is_admin() or public.is_clinical_staff() or public.is_billing_staff()
  );

drop policy if exists reagent_inventory_insert on public.reagent_inventory;
create policy reagent_inventory_insert on public.reagent_inventory
  for insert
  with check (public.is_admin() or public.is_inventory_staff());

drop policy if exists reagent_inventory_update on public.reagent_inventory;
create policy reagent_inventory_update on public.reagent_inventory
  for update
  using (public.is_admin() or public.is_inventory_staff())
  with check (public.is_admin() or public.is_inventory_staff());

drop policy if exists reagent_inventory_delete on public.reagent_inventory;
create policy reagent_inventory_delete on public.reagent_inventory
  for delete
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────
-- SECTION 3 — Defense-in-depth: make sure `anon` has nothing here
-- ───────────────────────────────────────────────────────────────────────
-- Same belt-and-suspenders revoke migration_v2.8's Section 12 applies to
-- its own table list — reagent_inventory was left out of that list since
-- it wasn't in scope there, so it gets its own copy of the same revoke.

revoke all on public.reagent_inventory from anon;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.16_reagent_inventory_rls.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'reagent_inventory'
--     order by cmd;
--
-- Then re-test the low-stock notification bell for a receptionist/cashier/
-- doctor login (should still show low-stock counts — SELECT is broad) and
-- the Inventory page's add/edit/receive-stock/dispense flows for
-- nurse/lab_tech/lab_supervisor/theatre_nurse/radiologist/admin logins
-- (should still work) before rolling this out to the live project.
-- ═══════════════════════════════════════════════════════════════════════
