-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.35_inventory_phase5_fields.sql
-- Documentation/Logbook expansion, Phase 5 (Inventory)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1. inventory_batches wastage/discard columns — ports Blood Bank's
--    existing discard pattern (reason code + mandatory notes, no silent
--    removals) to general Inventory. Before this, general Inventory had
--    no discard flow at all: expired batches were only ever visually
--    flagged (computeExpiryStatus()), never formally written off with a
--    reason. Discarding sets is_active=false (already used everywhere
--    else in the code as the "exclude from active FEFO pool" flag) plus
--    these new attribution columns.
--
-- 2. stock_requisitions.status gets a new terminal state, 'received',
--    confirmed by the ORIGINAL REQUESTER (not the admin/lab_supervisor
--    who approved+fulfilled it) — closing a gap the Phase 0 audit found:
--    the pipeline previously ended at 'fulfilled' with no step for the
--    requesting department to confirm the stock actually arrived in the
--    expected quantity.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.inventory_batches
  add column if not exists discard_reason_code text
    check (discard_reason_code in ('Expired','Damaged','Contaminated','Other')),
  add column if not exists discard_notes text,
  add column if not exists discarded_by uuid references auth.users(id),
  add column if not exists discarded_by_name text,
  add column if not exists discarded_at timestamptz;

comment on column public.inventory_batches.discard_reason_code is 'Closed-enum reason for discard — mirrors blood_units.discard_reason_code. Set only via index.html submitDiscardBatch(), never a plain delete.';
comment on column public.inventory_batches.discard_notes is 'Mandatory free-text detail for the discard — submitDiscardBatch() blocks saving without it, same rule as Blood Bank''s unit discard flow.';

-- Widen the existing status check constraint (added in migration_v2.14)
-- to include the new 'received' terminal state. Drops and recreates by
-- name so this is safe to re-run even if the constraint name differs
-- slightly in your instance — adjust the constraint name below to match
-- your actual schema if `stock_requisitions_status_check` isn't it.
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'stock_requisitions' and constraint_name = 'stock_requisitions_status_check'
  ) then
    alter table public.stock_requisitions drop constraint stock_requisitions_status_check;
  end if;
end $$;
alter table public.stock_requisitions
  add constraint stock_requisitions_status_check
  check (status in ('pending','approved','rejected','fulfilled','received'));

alter table public.stock_requisitions
  add column if not exists received_confirmed_by uuid references auth.users(id),
  add column if not exists received_confirmed_by_name text,
  add column if not exists received_confirmed_at timestamptz;

comment on column public.stock_requisitions.received_confirmed_by is 'The ORIGINAL REQUESTER (requested_by) confirming the stock arrived — a distinct actor from decided_by/whoever fulfilled it. Set via index.html confirmRequisitionReceipt().';
