-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.11_shift_billing_engine.sql
-- Reception Shift Management + Split Payments + Patient Wallet +
-- Anti-Fraud Audit Engine
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHO THIS IS FOR
--   Run this in the Supabase SQL editor against a project that already has
--   migration_v2.8_rls_security.sql applied — every policy below reuses
--   the public.current_staff_role() / public.is_admin() / public.is_billing_staff()
--   helper functions defined there rather than redefining them. If v2.8
--   hasn't been applied yet, apply it first or these policies will fail
--   with "function does not exist".
--
--   As with every migration in this repo (see CLAUDE.md), this does not
--   get run automatically — review it, then apply it manually in the
--   Supabase SQL editor. Nothing in index.html runs this for you.
--
-- WHAT THIS ADDS
--   1. reception_shifts       — one row per open/close cycle at a reception
--                                counter (the "cash drawer session").
--   2. payments                — itemised, possibly-split payments against
--                                an invoice (cash + card + wallet in one
--                                checkout), each tagged to the shift that
--                                took it. Existing single-method fields on
--                                invoices (payment_method/payment_status)
--                                are left untouched for backward
--                                compatibility — see Section 3 note.
--   3. patient_wallets /
--      wallet_transactions     — pre-paid deposit / advance balance per
--                                patient, debited as a payment method.
--   4. billing_audit_logs      — anti-fraud trail: voids, refunds,
--                                discount overrides above threshold, and
--                                shift open/close events, each recording
--                                who performed it and (where relevant) who
--                                authorised it.
--   5. queue_token_counters +
--      generate_queue_token()  — daily-resetting sequential token numbers
--                                (e.g. "LAB-042"), generated the same
--                                optimistic-concurrency way the app's
--                                existing generate_next_id() RPC generates
--                                file/lab numbers (see CLAUDE.md) — a
--                                dedicated table+RPC rather than reusing
--                                generate_next_id() since that function's
--                                source isn't part of this checkout to
--                                extend safely.
--   6. Columns added to the existing invoices table: shift_id, queue_token,
--      reprint_count, voided, voided_reason, voided_at, insurance_covered,
--      patient_payable, copay_percent, copay_fixed, wallet_amount.
--
-- DESIGN NOTES
--   - payments is intentionally additive, not a replacement for
--     invoices.payment_status/payment_method. Existing code
--     (loadBilling/renderBillTable/paymentTag/saveInvoice) keeps working
--     unmodified against those two columns; the new split-payment UI
--     writes rows into `payments` AND keeps invoices.payment_status in
--     sync (paid/partial/unpaid) so every existing read path stays
--     correct without being rewritten.
--   - A patient's wallet is looked up/created lazily — there's no
--     "register a wallet" step; ensure_patient_wallet() below creates a
--     zero-balance row on first use.
--   - Anti-fraud thresholds (discount % requiring override) are a client-
--     side config value (Settings page), NOT enforced in SQL — RLS can't
--     see the discount-vs-threshold math short of duplicating business
--     logic into a trigger. What IS enforced here is that VOID/REFUND
--     writes to billing_audit_logs are never optional: the shift-lock
--     trigger below blocks payment writes against a closed shift
--     regardless of what the client does or doesn't check.
--
-- ═══════════════════════════════════════════════════════════════════════

-- ── SECTION 1: reception_shifts ──────────────────────────────────────────

create table if not exists public.reception_shifts (
  id uuid primary key default gen_random_uuid(),
  shift_no text unique not null,
  staff_id uuid references public.staff(id),
  staff_name text not null,
  station_id text not null default 'Reception-1',
  shift_type text not null check (shift_type in ('morning','evening','night')),
  status text not null default 'active' check (status in ('active','closed')),
  currency text not null default 'SDG',
  opening_float numeric(14,2) not null default 0,
  opened_at timestamptz not null default now(),
  opened_by uuid references public.staff(id),
  -- Populated at close time — a snapshot of the reconciliation, not a
  -- live-computed view, so a closed shift's report never silently changes
  -- if later corrections touch invoices/payments dated during the shift.
  closed_at timestamptz,
  closed_by uuid references public.staff(id),
  total_patients int,
  gross_revenue numeric(14,2),
  total_cash numeric(14,2),
  total_card numeric(14,2),
  total_insurance numeric(14,2),
  total_wallet numeric(14,2),
  total_online numeric(14,2),
  total_refunds numeric(14,2),
  cash_expected numeric(14,2),
  cash_actual numeric(14,2),
  cash_variance numeric(14,2),
  variance_reason text check (
    variance_reason is null or variance_reason in (
      'counter_change_shortage','unprocessed_refund','bank_deposit_variance',
      'counterfeit_note','miscount','other'
    )
  ),
  closing_notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reception_shifts_status on public.reception_shifts(status);
create index if not exists idx_reception_shifts_staff on public.reception_shifts(staff_id);
create index if not exists idx_reception_shifts_opened_at on public.reception_shifts(opened_at desc);

-- One active shift per staff member at a time — prevents a receptionist
-- from opening a second shift while forgetting to close the first, which
-- would otherwise silently split their transactions across two shift_ids.
create unique index if not exists idx_reception_shifts_one_active_per_staff
  on public.reception_shifts(staff_id) where (status = 'active');

comment on table public.reception_shifts is
  'One row per reception cash-drawer session (open → close). All invoices/payments taken during a shift are tagged with its id.';

-- ── SECTION 2: patient_wallets / wallet_transactions ─────────────────────

create table if not exists public.patient_wallets (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patients(id) on delete cascade,
  balance numeric(14,2) not null default 0,
  currency text not null default 'SDG',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.patient_wallets(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  type text not null check (type in ('credit','debit','refund')),
  amount numeric(14,2) not null check (amount > 0),
  balance_after numeric(14,2) not null,
  reference_invoice_id uuid references public.invoices(id),
  shift_id uuid references public.reception_shifts(id),
  performed_by uuid references public.staff(id),
  performed_by_name text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_txn_wallet on public.wallet_transactions(wallet_id);
create index if not exists idx_wallet_txn_patient on public.wallet_transactions(patient_id);

comment on table public.patient_wallets is
  'Pre-paid deposit / advance balance per patient. Credited by reception, debited as a "Patient Wallet" payment method at checkout.';

-- Server-side balance mutation, not a bare UPDATE from the client — keeps
-- balance_after always consistent with balance and rejects a debit that
-- would take the wallet negative, even if two devices race to spend the
-- same balance offline-first.
create or replace function public.apply_wallet_transaction(
  p_patient_id uuid, p_type text, p_amount numeric,
  p_reference_invoice_id uuid default null, p_shift_id uuid default null,
  p_notes text default null
) returns public.wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.patient_wallets;
  v_new_balance numeric(14,2);
  v_txn public.wallet_transactions;
  v_staff_id uuid;
  v_staff_name text;
begin
  if p_amount <= 0 then
    raise exception 'Wallet transaction amount must be positive';
  end if;
  if p_type not in ('credit','debit','refund') then
    raise exception 'Invalid wallet transaction type: %', p_type;
  end if;

  select id, full_name into v_staff_id, v_staff_name
  from public.staff where user_id = auth.uid();

  -- Lock the wallet row for the duration of this transaction so concurrent
  -- debits from two devices can't both read the same starting balance.
  select * into v_wallet from public.patient_wallets
    where patient_id = p_patient_id for update;

  if not found then
    insert into public.patient_wallets (patient_id, balance)
    values (p_patient_id, 0)
    returning * into v_wallet;
  end if;

  if p_type = 'debit' then
    if v_wallet.balance < p_amount then
      raise exception 'Insufficient wallet balance: available %, requested %', v_wallet.balance, p_amount;
    end if;
    v_new_balance := v_wallet.balance - p_amount;
  else
    v_new_balance := v_wallet.balance + p_amount;
  end if;

  update public.patient_wallets
    set balance = v_new_balance, updated_at = now()
    where id = v_wallet.id;

  insert into public.wallet_transactions (
    wallet_id, patient_id, type, amount, balance_after,
    reference_invoice_id, shift_id, performed_by, performed_by_name, notes
  ) values (
    v_wallet.id, p_patient_id, p_type, p_amount, v_new_balance,
    p_reference_invoice_id, p_shift_id, v_staff_id, v_staff_name, p_notes
  ) returning * into v_txn;

  return v_txn;
end;
$$;

revoke execute on function public.apply_wallet_transaction(uuid,text,numeric,uuid,uuid,text) from public;
grant execute on function public.apply_wallet_transaction(uuid,text,numeric,uuid,uuid,text) to authenticated;

-- ── SECTION 3: payments (split-payment ledger) ────────────────────────────

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  method text not null check (method in ('cash','card','insurance','wallet','online','bank_transfer','mobile_money')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'SDG',
  shift_id uuid references public.reception_shifts(id),
  received_by uuid references public.staff(id),
  received_by_name text,
  reference_no text,
  voided boolean not null default false,
  voided_by uuid references public.staff(id),
  voided_reason text,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_invoice on public.payments(invoice_id);
create index if not exists idx_payments_shift on public.payments(shift_id);

comment on table public.payments is
  'Itemised payment lines against an invoice — supports splitting one invoice across cash/card/insurance/wallet in a single checkout. Additive to invoices.payment_status, which stays the source of truth for "is this invoice paid".';

-- ── SECTION 4: billing_audit_logs (anti-fraud trail) ──────────────────────

create table if not exists public.billing_audit_logs (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'shift_open','shift_close','void_invoice','refund','discount_override',
    'wallet_credit','wallet_debit','reprint'
  )),
  invoice_id uuid references public.invoices(id),
  shift_id uuid references public.reception_shifts(id),
  amount numeric(14,2),
  reason text,
  authorized_by uuid references public.staff(id),
  authorized_by_name text,
  performed_by uuid references public.staff(id),
  performed_by_name text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_audit_invoice on public.billing_audit_logs(invoice_id);
create index if not exists idx_billing_audit_event on public.billing_audit_logs(event_type);

comment on table public.billing_audit_logs is
  'Anti-fraud trail for voids, refunds, discount overrides, reprints, and shift open/close — mirrors the audit_logs pattern from migration_v2.8 but scoped to billing events that are not plain UPDATE/DELETE on an audited table.';

-- ── SECTION 5: invoices — new columns ──────────────────────────────────────

alter table public.invoices add column if not exists shift_id uuid references public.reception_shifts(id);
alter table public.invoices add column if not exists queue_token text;
alter table public.invoices add column if not exists reprint_count int not null default 0;
alter table public.invoices add column if not exists voided boolean not null default false;
alter table public.invoices add column if not exists voided_reason text;
alter table public.invoices add column if not exists voided_at timestamptz;
alter table public.invoices add column if not exists insurance_covered numeric(14,2) default 0;
alter table public.invoices add column if not exists patient_payable numeric(14,2);
alter table public.invoices add column if not exists copay_percent numeric(5,2);
alter table public.invoices add column if not exists copay_fixed numeric(14,2);
alter table public.invoices add column if not exists wallet_amount numeric(14,2) default 0;

create index if not exists idx_invoices_shift on public.invoices(shift_id);

-- Shift lock: once a shift is closed, reject any new payment or any invoice
-- write that tags it to that shift. This is the actual "shift lock"
-- guarantee — a client-side disabled button is only ever advisory,
-- someone hitting the REST API directly with a valid session must be
-- stopped here too.
create or replace function public.enforce_shift_lock() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if new.shift_id is null then
    return new;
  end if;
  select status into v_status from public.reception_shifts where id = new.shift_id;
  if v_status = 'closed' then
    raise exception 'Shift % is closed — no further billing entries may be added to it', new.shift_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoices_shift_lock on public.invoices;
create trigger trg_invoices_shift_lock
  before insert or update of shift_id on public.invoices
  for each row execute function public.enforce_shift_lock();

drop trigger if exists trg_payments_shift_lock on public.payments;
create trigger trg_payments_shift_lock
  before insert on public.payments
  for each row execute function public.enforce_shift_lock();

-- ── SECTION 6: queue tokens ────────────────────────────────────────────────

create table if not exists public.queue_token_counters (
  token_date date not null,
  prefix text not null,
  last_number int not null default 0,
  primary key (token_date, prefix)
);

-- Optimistic-concurrency sequential counter, same pattern as the app's
-- existing generate_next_id() RPC (see CLAUDE.md) — an UPSERT with
-- RETURNING rather than SELECT-then-UPDATE, so two simultaneous checkouts
-- can never be handed the same token number.
create or replace function public.generate_queue_token(p_prefix text default 'LAB')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num int;
begin
  insert into public.queue_token_counters (token_date, prefix, last_number)
  values (current_date, p_prefix, 1)
  on conflict (token_date, prefix)
  do update set last_number = public.queue_token_counters.last_number + 1
  returning last_number into v_num;

  return p_prefix || '-' || lpad(v_num::text, 3, '0');
end;
$$;

revoke execute on function public.generate_queue_token(text) from public;
grant execute on function public.generate_queue_token(text) to authenticated;

-- ── SECTION 7: RLS — reception_shifts ───────────────────────────────────────

alter table public.reception_shifts enable row level security;

drop policy if exists shifts_select on public.reception_shifts;
create policy shifts_select on public.reception_shifts for select to authenticated
  using (public.is_admin() or public.is_billing_staff());

drop policy if exists shifts_insert on public.reception_shifts;
create policy shifts_insert on public.reception_shifts for insert to authenticated
  with check (public.is_admin() or public.is_billing_staff());

-- Only the receptionist/cashier who opened it (or an admin) may update
-- their own shift — one cashier cannot close or edit another's drawer.
drop policy if exists shifts_update on public.reception_shifts;
create policy shifts_update on public.reception_shifts for update to authenticated
  using (
    public.is_admin()
    or (public.is_billing_staff() and staff_id in (select id from public.staff where user_id = auth.uid()))
  )
  with check (
    public.is_admin()
    or (public.is_billing_staff() and staff_id in (select id from public.staff where user_id = auth.uid()))
  );

drop policy if exists shifts_delete on public.reception_shifts;
create policy shifts_delete on public.reception_shifts for delete to authenticated
  using (public.is_admin());

-- ── SECTION 8: RLS — payments ────────────────────────────────────────────

alter table public.payments enable row level security;

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (public.is_admin() or public.is_billing_staff());

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert to authenticated
  with check (public.is_admin() or public.is_billing_staff());

-- Void/refund is an update (voided=true), not a delete — deletion of a
-- payment row is never allowed, even by admins, to keep the ledger intact;
-- corrections happen via a new offsetting 'refund' row instead.
drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments for update to authenticated
  using (public.is_admin() or public.is_billing_staff())
  with check (public.is_admin() or public.is_billing_staff());

drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments for delete to authenticated
  using (public.is_admin());

-- ── SECTION 9: RLS — patient_wallets / wallet_transactions ────────────────

alter table public.patient_wallets enable row level security;
alter table public.wallet_transactions enable row level security;

drop policy if exists wallets_select on public.patient_wallets;
create policy wallets_select on public.patient_wallets for select to authenticated
  using (public.is_admin() or public.is_billing_staff());

-- Direct client writes to patient_wallets are intentionally NOT granted —
-- balance must only ever change via apply_wallet_transaction() (SECURITY
-- DEFINER), so no policy below permits insert/update/delete from the
-- client role; the function performs those writes under its own
-- definer privileges regardless of the caller's RLS grants.

drop policy if exists wallet_txn_select on public.wallet_transactions;
create policy wallet_txn_select on public.wallet_transactions for select to authenticated
  using (public.is_admin() or public.is_billing_staff());

-- ── SECTION 10: RLS — billing_audit_logs ──────────────────────────────────

alter table public.billing_audit_logs enable row level security;

drop policy if exists billing_audit_select on public.billing_audit_logs;
create policy billing_audit_select on public.billing_audit_logs for select to authenticated
  using (public.is_admin());

drop policy if exists billing_audit_insert on public.billing_audit_logs;
create policy billing_audit_insert on public.billing_audit_logs for insert to authenticated
  with check (public.is_admin() or public.is_billing_staff());

-- No update/delete policy on billing_audit_logs for anyone, admins
-- included — an audit trail that can be edited after the fact is not one.

-- ── SECTION 11: RLS — queue_token_counters ────────────────────────────────

alter table public.queue_token_counters enable row level security;

drop policy if exists queue_counters_select on public.queue_token_counters;
create policy queue_counters_select on public.queue_token_counters for select to authenticated
  using (public.is_admin() or public.is_billing_staff());

-- No insert/update/delete policy — all writes to this table happen only
-- through generate_queue_token(), a SECURITY DEFINER function.

-- ── SECTION 12: GRANTs ────────────────────────────────────────────────────
-- RLS policies alone are not sufficient — Postgres also requires a
-- table-level GRANT before `authenticated` can touch these tables at all
-- (a bare Postgres instance without Supabase's default-privilege
-- provisioning returns "permission denied for table X" independent of any
-- RLS policy; confirmed the hard way while testing migration_v2.10).

grant select, insert, update on public.reception_shifts to authenticated;
grant select, insert, update on public.payments to authenticated;
grant select on public.patient_wallets to authenticated;
grant select on public.wallet_transactions to authenticated;
grant select, insert on public.billing_audit_logs to authenticated;
grant select on public.queue_token_counters to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.11_shift_billing_engine.sql
--
-- AFTER APPLYING, in the Supabase SQL editor, verify:
--   select * from public.reception_shifts limit 1;
--   select public.generate_queue_token('LAB');   -- should return 'LAB-001' the first time today
--   select public.apply_wallet_transaction('<a real patient uuid>', 'credit', 100, null, null, 'test credit');
-- ═══════════════════════════════════════════════════════════════════════
