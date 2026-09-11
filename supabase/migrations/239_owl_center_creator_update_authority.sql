-- Creator Core update authority handoff tracking (Owl Center).
-- onchain_update_authority: root collection UA after deploy/claim (creator wallet).
-- platform_update_delegate: IRYS deployer retained as Core UpdateDelegate.

alter table public.owl_center_launches
  add column if not exists onchain_update_authority text,
  add column if not exists platform_update_delegate text;

comment on column public.owl_center_launches.onchain_update_authority is
  'On-chain Core collection update authority (creator wallet after handoff).';
comment on column public.owl_center_launches.platform_update_delegate is
  'Platform IRYS pubkey retained as Core UpdateDelegate for reveal/refresh/thaw ops.';
