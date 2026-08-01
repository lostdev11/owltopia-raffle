-- Explicit deny-all RLS for API + service_role only tables (lint 0008 rls_enabled_no_policy).
-- These tables already had RLS with no policies (implicit deny for anon/authenticated).
-- This migration makes intent explicit and revokes Data API table grants from JWT roles.
-- service_role bypasses RLS; app access remains getSupabaseAdmin() / Next.js APIs.
-- Orphans usernames / notification_emails: keep tables, lock down (do not drop).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'community_giveaway_entries',
    'community_giveaway_owl_boosts',
    'creator_blacklist',
    'creator_moderation_strike_events',
    'dev_tasks',
    'discord_broadcast_schedules',
    'discord_broadcast_send_log',
    'discord_broadcast_templates',
    'discord_giveaway_partner_tenants',
    'discord_partner_payment_intents',
    'discord_role_claims',
    'gen2_gen1_airdrop_snapshot',
    'gen2_gen1_mint_delegations',
    'gen2_mint_cosign_holds',
    'gen2_mint_milestones',
    'gen2_presale_balances',
    'gen2_presale_gift_audit',
    'gen2_presale_mint_delegations',
    'gen2_presale_overage_allocations',
    'gen2_presale_purchases',
    'gen2_presale_refund_audit',
    'gen2_whitelist_wallets',
    'gen_owl_rev_share_claims',
    'gen_owl_rev_share_deposits',
    'gen_owl_rev_share_periods',
    'nft_auction_bids',
    'nft_auctions',
    'nft_giveaways',
    'notification_emails',
    'owl_center_activity_logs',
    'owl_center_asset_packages',
    'owl_center_asset_upload_jobs',
    'owl_center_discord_mint_feed',
    'owl_center_generator_projects',
    'owl_center_marketplace_readiness',
    'owl_center_mint_events',
    'owl_center_partners',
    'owl_center_submissions',
    'owl_center_wl_allocations',
    'owl_council_escrow_balances',
    'owl_council_escrow_ledger',
    'owl_votes',
    'owl_wallet_owl_snapshots',
    'owltopia_holder_snapshots',
    'raffle_admin_deletions',
    'raffle_buyout_offers',
    'raffle_draw_secrets',
    'raffle_milestones',
    'raffle_sentiment',
    'raffle_views',
    'referral_retired_codes',
    'referral_reward_settings',
    'referral_rewards',
    'siws_consumed_nonces',
    'staking_owl_reward_transfers',
    'staking_platform_fee_payments',
    'staking_positions',
    'staking_reward_events',
    'usernames',
    'verified_transactions',
    'wallet_links',
    'wallet_milestones',
    'wallet_referrals'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_deny_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (false) WITH CHECK (false)',
      t || '_deny_all',
      t
    );

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      t
    );
  END LOOP;
END;
$$;
