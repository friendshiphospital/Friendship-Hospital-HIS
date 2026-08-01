-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.14_inventory_upgrade.sql
-- Upgrades the existing single-table Inventory module (reagent_inventory)
-- into a departmental, batch-tracked, requisition-capable system.
-- ═══════════════════════════════════════════════════════════════════════
--
-- Run this in the Supabase SQL editor, after migration_v2.8_rls_security.sql
-- (depends on public.is_admin()/is_clinical_staff()/is_lab_staff()/
-- current_staff_role()). Idempotent — safe to re-run.
--
-- WHAT WAS AUDITED FIRST (per the request that triggered this migration):
-- index.html already had a working Inventory page (#page-inventory) backed
-- by reagent_inventory — item_name/category/analyzer/current_stock/unit/
-- min_level/lot_no/expiry_date/supplier, with low-stock notifications
-- already wired in refreshNotifications(). That table supports exactly
-- ONE lot/expiry per item, one flat category, no barcode, no department
-- taxonomy, and no requisition/transfer workflow — this migration adds
-- those on top of it rather than replacing it, and existing rows/queries
-- (including the low-stock notification) keep working unchanged.
--
-- DESIGN DECISIONS
--   1. reagent_inventory.current_stock stays the source of truth read by
--      existing code (notifications, dashboards) — it's now an aggregate
--      kept in sync by inventory_batches operations (receive/dispense/
--      adjust all update it), rather than something the new batch table
--      replaces.
--   2. Multiple batches per item (inventory_batches) is the actual fix for
--      "Batch & Expiry Management" — the old schema could only ever
--      remember one lot/expiry per item, which breaks FEFO by definition
--      (you need >1 batch on hand to have a "first" one to expire).
--   3. Department taxonomy (reagent_inventory.department) is a fixed set
--      matching the request's 5 categories; sub-category stays in the
--      existing `category` column, now populated from a per-department
--      list client-side (see INVENTORY_TAXONOMY in index.html) rather than
--      a fixed global enum, since sub-categories genuinely differ by dept.

-- ── 1. Extend reagent_inventory ─────────────────────────────────────────
alter table public.reagent_inventory add column if not exists department text;
alter table public.reagent_inventory add column if not exists barcode text;
alter table public.reagent_inventory add column if not exists onboard_stability_days integer;
comment on column public.reagent_inventory.department is
  'One of: Laboratory, Radiology & Imaging, Surgical & OT Supplies, General Medical & Nursing, Equipment & Maintenance. NULL for pre-existing rows created before this migration — the UI treats NULL as "Uncategorized" until edited.';
comment on column public.reagent_inventory.onboard_stability_days is
  'For liquid reagents only: how many days the item remains usable after being opened, independent of its printed/unopened expiry_date. NULL = not tracked for this item. See inventory_batches.opened_date for the per-batch open date this is measured from.';

create index if not exists reagent_inventory_department_idx on public.reagent_inventory (department);
create index if not exists reagent_inventory_barcode_idx on public.reagent_inventory (barcode);

-- ── 2. Batch tracking (the real fix for FEFO) ───────────────────────────
create table if not exists public.inventory_batches (
  id              bigint generated always as identity primary key,
  item_id         uuid not null references public.reagent_inventory(id) on delete cascade,
  batch_no        text,
  quantity        numeric not null default 0 check (quantity >= 0),
  unit_cost       numeric,
  received_date   date not null default current_date,
  expiry_date     date,
  is_opened       boolean not null default false,
  opened_date     date,
  is_active       boolean not null default true,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now()
);

create index if not exists inventory_batches_item_idx on public.inventory_batches (item_id);
create index if not exists inventory_batches_expiry_idx on public.inventory_batches (expiry_date);

alter table public.inventory_batches enable row level security;

drop policy if exists inventory_batches_select on public.inventory_batches;
create policy inventory_batches_select on public.inventory_batches
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists inventory_batches_insert on public.inventory_batches;
create policy inventory_batches_insert on public.inventory_batches
  for insert with check (public.is_admin() or public.is_clinical_staff());

drop policy if exists inventory_batches_update on public.inventory_batches;
create policy inventory_batches_update on public.inventory_batches
  for update using (public.is_admin() or public.is_clinical_staff());

revoke all on public.inventory_batches from anon;
grant select, insert, update on public.inventory_batches to authenticated;
grant usage, select on sequence inventory_batches_id_seq to authenticated;

-- ── 3. Departmental Requisition & Transfer workflow ─────────────────────
create table if not exists public.stock_requisitions (
  id                    bigint generated always as identity primary key,
  requesting_department text not null,   -- e.g. 'ICU', 'Radiology', 'Theatre' — free text, the requesting ward/unit, distinct from reagent_inventory.department (the item's own catalog department)
  item_id               uuid not null references public.reagent_inventory(id),
  qty_requested         numeric not null check (qty_requested > 0),
  status                text not null default 'pending' check (status in ('pending','approved','rejected','fulfilled')),
  notes                 text,
  requested_by          uuid,
  requested_by_name     text,
  decided_by            uuid,
  decided_by_name       text,
  decision_note         text,
  decided_at            timestamptz,
  fulfilled_at          timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists stock_requisitions_status_idx on public.stock_requisitions (status);
create index if not exists stock_requisitions_created_at_idx on public.stock_requisitions (created_at desc);

alter table public.stock_requisitions enable row level security;

-- Any clinical/lab/admin staff can see the requisition queue (a ward needs
-- to see its own request's status; central store needs to see everyone's).
drop policy if exists stock_requisitions_select on public.stock_requisitions;
create policy stock_requisitions_select on public.stock_requisitions
  for select using (public.is_admin() or public.is_clinical_staff());

drop policy if exists stock_requisitions_insert on public.stock_requisitions;
create policy stock_requisitions_insert on public.stock_requisitions
  for insert with check (public.is_admin() or public.is_clinical_staff());

-- Approve/reject/fulfill is a Central Store (admin/lab_supervisor) action,
-- not something the requesting ward can do to its own request.
drop policy if exists stock_requisitions_update on public.stock_requisitions;
create policy stock_requisitions_update on public.stock_requisitions
  for update using (public.is_admin() or public.current_staff_role() = 'lab_supervisor');

revoke all on public.stock_requisitions from anon;
grant select, insert, update on public.stock_requisitions to authenticated;
grant usage, select on sequence stock_requisitions_id_seq to authenticated;

-- ── 4. Purchase Orders (Reorder / Par Stock alerts → PO) ────────────────
create table if not exists public.purchase_orders (
  id          bigint generated always as identity primary key,
  po_no       text not null,
  supplier    text,
  status      text not null default 'draft' check (status in ('draft','sent','received','cancelled')),
  notes       text,
  created_by  uuid,
  created_by_name text,
  created_at  timestamptz not null default now()
);
create table if not exists public.purchase_order_items (
  id                bigint generated always as identity primary key,
  po_id             bigint not null references public.purchase_orders(id) on delete cascade,
  item_id           uuid references public.reagent_inventory(id),
  item_name_snapshot text not null,   -- kept even if the catalog item is later renamed/removed
  qty_ordered       numeric not null check (qty_ordered > 0),
  unit_cost_estimate numeric
);

create index if not exists purchase_order_items_po_idx on public.purchase_order_items (po_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders
  for select using (public.is_admin() or public.is_lab_staff());
drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders
  for insert with check (public.is_admin() or public.is_lab_staff());
drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update on public.purchase_orders
  for update using (public.is_admin() or public.is_lab_staff());

drop policy if exists purchase_order_items_select on public.purchase_order_items;
create policy purchase_order_items_select on public.purchase_order_items
  for select using (public.is_admin() or public.is_lab_staff());
drop policy if exists purchase_order_items_insert on public.purchase_order_items;
create policy purchase_order_items_insert on public.purchase_order_items
  for insert with check (public.is_admin() or public.is_lab_staff());

revoke all on public.purchase_orders from anon;
revoke all on public.purchase_order_items from anon;
grant select, insert, update on public.purchase_orders to authenticated;
grant select, insert on public.purchase_order_items to authenticated;
grant usage, select on sequence purchase_orders_id_seq to authenticated;
grant usage, select on sequence purchase_order_items_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.14_inventory_upgrade.sql
--
-- NOTE ON A PRE-EXISTING GAP (not introduced by this migration, flagging
-- rather than silently leaving it): reagent_inventory itself was never
-- listed in migration_v2.8_rls_security.sql's scope and has no RLS policy
-- of its own — any authenticated user can currently read/write any row.
-- The new tables above ARE properly locked down. If you want
-- reagent_inventory itself locked down to match, that's a small follow-up
-- migration (same pattern as this file's Section 2) rather than something
-- folded in here silently.
-- ═══════════════════════════════════════════════════════════════════════
