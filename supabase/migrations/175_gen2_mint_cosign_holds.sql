-- Gen2 free-phase co-sign holds.
--
-- The gen1 airdrop + presale phases mint for free, so the on-chain candy guard can only verify
-- allowlist *membership*, not the per-wallet count (which varies and cannot fit on-chain). To close
-- the website-bypass over-mint edge case we add a `thirdPartySigner` guard whose key is server-held;
-- /api/owl-center/gen2/cosign-mint co-signs each free mint only after checking remaining credits.
--
-- This table is the concurrency guard for that endpoint: a short-lived, CONSERVATIVE hold so two
-- in-flight cosign requests for the same wallet cannot each see the full remaining allowance. Holds
-- only ever make a wallet appear to have LESS (never more), so there is no over-mint window; they
-- expire after 5 minutes and confirmed mints (owl_center_mint_events) are the durable source of
-- truth the eligibility max already reflects.

create table if not exists public.gen2_mint_cosign_holds (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null,
  wallet text not null,
  phase text not null,
  network text not null default 'mainnet',
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_gen2_cosign_holds_lookup
  on public.gen2_mint_cosign_holds (launch_id, wallet, phase, network, expires_at);

alter table public.gen2_mint_cosign_holds enable row level security;
-- No policies: only the service role (which bypasses RLS) touches this table, via the RPC below.

-- Atomically place a co-sign hold for a wallet+phase, bounded by p_max_allowed (the eligibility
-- max_mintable, which already subtracts confirmed mints). Returns { ok, active_holds, max_allowed }.
create or replace function public.gen2_cosign_hold(
  p_launch_id uuid,
  p_wallet text,
  p_phase text,
  p_network text,
  p_quantity integer,
  p_max_allowed integer
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_active integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_quantity');
  end if;
  if p_max_allowed is null or p_max_allowed <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_allowance', 'max_allowed', coalesce(p_max_allowed, 0));
  end if;

  -- Serialize concurrent cosign requests for the same wallet+phase within this launch.
  perform pg_advisory_xact_lock(
    hashtextextended(p_launch_id::text || '|' || p_wallet || '|' || p_phase || '|' || p_network, 0)
  );

  -- Drop this wallet+phase's expired holds so abandoned mint sessions free their allowance.
  delete from public.gen2_mint_cosign_holds
   where launch_id = p_launch_id
     and wallet = p_wallet
     and phase = p_phase
     and network = p_network
     and expires_at < now();

  select coalesce(sum(quantity), 0) into v_active
    from public.gen2_mint_cosign_holds
   where launch_id = p_launch_id
     and wallet = p_wallet
     and phase = p_phase
     and network = p_network;

  if v_active + p_quantity > p_max_allowed then
    return jsonb_build_object(
      'ok', false,
      'reason', 'over_limit',
      'active_holds', v_active,
      'requested', p_quantity,
      'max_allowed', p_max_allowed
    );
  end if;

  insert into public.gen2_mint_cosign_holds (launch_id, wallet, phase, network, quantity, expires_at)
  values (p_launch_id, p_wallet, p_phase, p_network, p_quantity, now() + interval '5 minutes');

  return jsonb_build_object(
    'ok', true,
    'active_holds', v_active + p_quantity,
    'max_allowed', p_max_allowed
  );
end;
$$;

-- The co-sign endpoint calls this via the service-role client.
grant execute on function public.gen2_cosign_hold(uuid, text, text, text, integer, integer) to service_role;
