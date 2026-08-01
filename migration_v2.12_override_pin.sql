-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.12_override_pin.sql
-- Adds an optional fast "Quick PIN" path to the anti-fraud admin
-- override flow (void/refund/discount-above-threshold), alongside the
-- existing full email+password re-authentication.
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
--   The override flow (see requireOverride()/submitOverride() in
--   index.html) originally only supported full admin re-authentication
--   against Supabase Auth — deliberately, since a short static PIN is
--   weaker than a real password (shared between staff, rarely rotated,
--   easy to observe over someone's shoulder at a counter). That trade-off
--   is still true. This migration adds a PIN as an OPTIONAL faster path
--   for counter-speed approvals, not a replacement — full re-auth remains
--   available and is still the stronger option for high-value actions.
--
-- HOW THE PIN IS KEPT SAFE
--   1. Stored bcrypt-hashed (pgcrypto's crypt()/gen_salt('bf')), never
--      plaintext.
--   2. The hash is NEVER returned to any client. Both reading (to verify)
--      and writing (to set) happen exclusively inside SECURITY DEFINER
--      functions that return only a boolean or an admin's identity — the
--      hash itself never crosses the wire.
--   3. Column-level REVOKE on staff.override_pin_hash means even a query
--      like `select * from staff` from an ordinary authenticated session
--      cannot see this column at all, regardless of whatever row-level
--      staff-directory read policies already exist (e.g. for populating
--      doctor dropdowns). The two functions below still work because a
--      SECURITY DEFINER function executes with the DEFINER's privileges
--      (the role that ran this migration), not the caller's — so it
--      bypasses the column-level revoke placed on `authenticated`/`anon`
--      while ordinary queries from any role other than the definer stay
--      blocked from ever selecting the column.
--   4. An admin may only ever set/change their OWN PIN
--      (set_override_pin() resolves the caller's own staff row via
--      auth.uid() — there is no "set someone else's PIN" path at all).
--
-- KNOWN LIMITATION (documented, not silently ignored): there is no
-- failed-attempt lockout/rate-limit on verify_override_pin() in this
-- pass. A 6+ digit numeric PIN has a large enough space that casual
-- guessing isn't practical, but a scripted brute-force against the RPC
-- itself isn't blocked at the database layer. If that matters for your
-- deployment, consider adding a failed-attempts counter + temporary
-- lockout as a follow-up — flagging it explicitly rather than pretending
-- this closes that gap.
--
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.

create extension if not exists pgcrypto;

alter table public.staff add column if not exists override_pin_hash text;

comment on column public.staff.override_pin_hash is
  'Bcrypt hash of this admin''s optional Quick-PIN for the anti-fraud override flow. Never selected directly by client code — only read/written inside set_override_pin()/verify_override_pin(), both SECURITY DEFINER. See migration_v2.12 for the full security rationale.';

-- Lock the raw hash column away from ordinary row-level access, even
-- though existing staff-directory SELECT policies (from migration_v2.8)
-- may otherwise let any authenticated user read other columns on other
-- staff rows (e.g. for doctor-name dropdowns).
revoke select (override_pin_hash) on public.staff from authenticated;
revoke select (override_pin_hash) on public.staff from anon;

-- An admin sets/changes ONLY their own PIN — resolved via auth.uid(),
-- never trusts a client-supplied staff id.
create or replace function public.set_override_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_role text;
begin
  select id, role into v_staff_id, v_role from public.staff where user_id = auth.uid();
  if v_staff_id is null then
    raise exception 'No staff record linked to this account';
  end if;
  if v_role <> 'admin' then
    raise exception 'Only an admin may set an override PIN';
  end if;
  if p_pin is null or length(p_pin) < 6 then
    raise exception 'PIN must be at least 6 digits';
  end if;
  if p_pin !~ '^[0-9]+$' then
    raise exception 'PIN must be numeric only';
  end if;

  update public.staff set override_pin_hash = crypt(p_pin, gen_salt('bf')) where id = v_staff_id;
  return true;
end;
$$;

revoke execute on function public.set_override_pin(text) from public;
grant execute on function public.set_override_pin(text) to authenticated;

-- Verifies a PIN against every admin's stored hash and returns the
-- matching admin's identity (or zero rows if no match) — this is the
-- ONLY way the hash is ever read, and it never leaves this function.
create or replace function public.verify_override_pin(p_pin text)
returns table(admin_id uuid, admin_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select s.id, s.full_name
    from public.staff s
    where s.role = 'admin'
      and s.override_pin_hash is not null
      and s.override_pin_hash = crypt(p_pin, s.override_pin_hash)
    limit 1;
end;
$$;

revoke execute on function public.verify_override_pin(text) from public;
grant execute on function public.verify_override_pin(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.12_override_pin.sql
--
-- AFTER APPLYING, verify with:
--   select public.set_override_pin('123456');           -- run while logged in as an admin (via SQL editor this runs as postgres, not a real admin session — real verification happens from the app itself, see below)
--   select * from public.verify_override_pin('123456');  -- should return 0 rows unless called by/for a real admin session
-- Real end-to-end verification happens from the app: an admin sets their
-- PIN via Settings, then a cashier triggers a void/refund and picks
-- "Quick PIN" in the authorization modal.
-- ═══════════════════════════════════════════════════════════════════════
