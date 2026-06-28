import { NextRequest, NextResponse } from 'next/server'

import { waitUntil } from '@vercel/functions'

import { runGen2WalletSafeMetadataFix } from '@/lib/owl-center/wallet-safe-onchain-metadata'

import { buildGen2Eligibility } from '@/lib/owl-center/gen2-eligibility'

import { evaluateGen2MintMilestones } from '@/lib/owl-center/gen2-milestones/evaluate'

import { postGen2MintFeed } from '@/lib/owl-center/gen2-mint-discord-feed'

import { getOwlCenterLaunchBySlug, getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'

import { getLivePhases } from '@/lib/owl-center/phase-schedule'

import { gen2GuardGroupLabel, isGen2MintablePhase } from '@/lib/solana/gen2-guards'

import type { OwlCenterPhase } from '@/lib/owl-center/types'

import { verifyGen2MintTransaction } from '@/lib/owl-center/verify-gen2-mint-tx'

import { shouldRequireOwlCenterPlatformMintFeeServer } from '@/lib/owl-center/platform-mint-fee'

import { getGen2CandyMachineId, owlMintNetworkFromParam, type OwlMintNetwork } from '@/lib/solana/network'

import { getSupabaseAdmin } from '@/lib/supabase-admin'

import { getClientIp, rateLimit } from '@/lib/rate-limit'

import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'



export const dynamic = 'force-dynamic'



const SIG_REGEX = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/



export async function POST(request: NextRequest) {

  const ip = getClientIp(request)

  const rl = rateLimit(`owl-gen2-confirm:${ip}`, 45, 60_000)

  if (!rl.allowed) {

    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  }



  let body: {

    wallet?: string

    txSignature?: string

    quantity?: number

    phase?: string

    mintedNftMints?: string[]

    network?: string

  }

  try {

    body = await request.json()

  } catch {

    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  }



  const wallet = body.wallet?.trim() ? normalizeSolanaWalletAddress(body.wallet.trim()) : null

  const txSig = body.txSignature?.trim() ?? ''

  const qty = Number(body.quantity)

  const phase = body.phase?.trim().toUpperCase() as OwlCenterPhase



  const netRaw = body.network?.trim()

  let network: OwlMintNetwork = 'mainnet'

  if (netRaw) {

    const parsed = owlMintNetworkFromParam(netRaw)

    if (!parsed) {

      return NextResponse.json({ error: 'Invalid network — use devnet or mainnet' }, { status: 400 })

    }

    network = parsed

  }



  if (!wallet || !SIG_REGEX.test(txSig) || !Number.isInteger(qty) || qty <= 0) {

    return NextResponse.json({ error: 'Invalid wallet, signature, or quantity' }, { status: 400 })

  }



  const allowed: OwlCenterPhase[] = ['AIRDROP', 'PRESALE', 'PRESALE_OVERAGE', 'WHITELIST', 'PUBLIC']

  if (!phase || !allowed.includes(phase)) {

    return NextResponse.json({ error: 'Invalid phase' }, { status: 400 })

  }



  const launch = await getOwlCenterLaunchBySlugAdmin('gen2')

  if (!launch) {

    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })

  }



  const candyMachineId = getGen2CandyMachineId(launch)

  if (!candyMachineId.trim()) {

    return NextResponse.json(

      { error: network === 'devnet' ? 'Missing devnet Candy Machine ID' : 'Missing Candy Machine ID' },

      { status: 400 }

    )

  }



  // Bind the confirmed on-chain tx to the guard group of the claimed phase, so a wallet cannot mint
  // in one (cheaper / free) group on-chain and record it under a different live phase.
  const expectedGuardGroupLabel = isGen2MintablePhase(phase) ? gen2GuardGroupLabel(phase) : null

  const verified = await verifyGen2MintTransaction({

    txSignature: txSig,

    wallet,

    candyMachineId,

    network,

    // Enforce the SOL platform fee credit to the treasury in the same tx (when configured), so
    // every recorded gen2 mint actually paid the ~$1 Owltopia fee. One fee transfer per mint tx
    // (gen2 builds one tx per NFT), so the expected amount scales with this call's quantity.
    requirePlatformMintFee: shouldRequireOwlCenterPlatformMintFeeServer(),

    mintQuantity: qty,

    minMintedNfts: qty,

    expectedGuardGroupLabel,

  })

  if (!verified.ok) {

    const map: Record<string, string> = {

      not_found: 'Transaction not found on the selected network RPC',

      failed: 'Mint transaction failed on-chain',

      fee_payer_mismatch: 'Fee payer does not match wallet',

      candy_machine_missing: 'Transaction does not reference the configured Candy Machine',

      platform_fee_missing: 'Transaction must include the SOL platform mint fee to the Owltopia treasury',

      no_nft_minted:
        'No NFT was minted in this transaction — the mint did not go through (you may have only paid the bot tax). Tap Mint to try again.',

      wrong_guard_group: 'Mint phase mismatch — the on-chain mint used a different phase. Refresh and try again.',

    }

    return NextResponse.json({ error: map[verified.reason] ?? 'Verification failed' }, { status: 400 })

  }



  const mintedList = Array.isArray(body.mintedNftMints)

    ? body.mintedNftMints.filter((x): x is string => typeof x === 'string' && x.length > 0)

    : []



  // Coarse gate: the requested phase must be live right now (primary active_phase, an admin-toggled
  // concurrent phase, or the Gen1 7-day window). Replaces the legacy single-active_phase check so
  // wallets can mint in any concurrently-open phase.
  if (!getLivePhases(launch).has(phase)) {

    return NextResponse.json({ error: 'That phase is not live — refresh and try again' }, { status: 400 })

  }

  // Fine gate: evaluate eligibility for THAT specific phase (not just the primary active_phase).

  const eligibilityPre = await buildGen2Eligibility(wallet, phase)

  if (!eligibilityPre) {

    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })

  }

  if (!eligibilityPre.is_eligible || qty > eligibilityPre.max_mintable) {

    return NextResponse.json(

      { error: 'Not eligible for this mint quantity — refresh your allocation checker' },

      { status: 400 }

    )

  }



  const db = getSupabaseAdmin()

  const { data, error } = await db.rpc('confirm_owl_center_gen2_mint', {

    p_launch_slug: 'gen2',

    p_wallet: wallet,

    p_tx_signature: txSig,

    p_quantity: qty,

    p_phase: phase,

    p_minted_nft_mints: mintedList,

    p_network: network,

    p_event_candy_machine_id: candyMachineId,

  })



  if (error) {

    console.error('confirm_owl_center_gen2_mint', error)

    return NextResponse.json(

      { error: 'Transaction succeeded but database record failed — contact support with your signature.' },

      { status: 500 }

    )

  }



  const row = data as { ok?: boolean; error?: string } | null

  if (!row || row.ok !== true) {

    const err = typeof row?.error === 'string' ? row.error : 'confirm_failed'

    const status =

      err === 'duplicate_tx'

        ? 409

        : err === 'mint_paused' || err === 'mint_closed'

          ? 403

          : err === 'exceeds_supply' || err === 'sold_out'

            ? 400

            : 400

    const human: Record<string, string> = {

      duplicate_tx: 'This transaction was already recorded',

      mint_paused: 'Mint temporarily paused by Owl Center',

      mint_closed: 'Mint is closed for this launch',

      phase_mismatch: 'Phase mismatch — refresh and try again',

      insufficient_wl_allocation: 'Insufficient whitelist allocation',

      wl_pool_exhausted: 'WL phase mint cap reached',

      exceeds_supply: 'Would exceed total supply',

      launch_not_found: 'Launch not found',

      invalid_quantity: 'Invalid quantity',

      wallet_mint_limit: 'Wallet mint limit reached',

      presale_pool_exhausted: 'Presale phase mint cap (657) reached',

      not_presale_participant: 'This wallet did not pay during presale',

      no_paid_presale_credits: 'No paid presale credits remaining on this wallet',

      no_presale_credits: 'No presale credits remaining on this wallet',

      presale_credits_in_overage_phase: 'Presale+13 credits — mint when Presale+13 phase is live',

      overage_pool_exhausted: 'All Presale+13 spots minted',

      insufficient_overage_allocation: 'Not on Presale+13 list or no slots left',

      invalid_network: 'Invalid network',

      confirm_route_failed: 'Confirm route failed',

    }

    return NextResponse.json({ error: human[err] ?? err }, { status })

  }



  // Best-effort: immediately re-point the freshly minted NFT(s) at wallet-safe metadata so Solflare
  // can render the art (Sugar config-line JSON uses arweave.net `image` URLs Solflare won't follow via
  // arweave.net's 302 → subdomain redirect). The gen2-metadata-fix cron is the catch-all if this
  // background task is cut short. Never blocks or fails the mint confirmation.
  if (mintedList.length > 0) {
    waitUntil(
      runGen2WalletSafeMetadataFix({
        network,
        mints: mintedList,
        max: mintedList.length,
        timeBudgetMs: 45_000,
      }).catch((e) => console.error('[confirm-mint] wallet-safe metadata fix', e))
    )
  }



  // Best-effort: post the freshly minted owl(s) + a live phase/total progress bar to the GEN2
  // mint-tracker Discord channel. Mainnet only; no-ops when the webhook env is unset. Never blocks
  // or fails the mint confirmation.
  if (network === 'mainnet') {
    waitUntil(
      postGen2MintFeed({
        wallet,
        phase,
        quantity: qty,
        txSignature: txSig,
        mints: mintedList,
        network,
      }).catch((e) => console.error('[confirm-mint] discord mint feed', e))
    )
  }



  const [eligibility, launchPublic] = await Promise.all([buildGen2Eligibility(wallet), getOwlCenterLaunchBySlug('gen2')])



  // Best-effort: evaluate mint milestones against the freshly bumped count.
  // Never let this break the mint confirmation response.
  if (launchPublic) {
    try {
      await evaluateGen2MintMilestones(launchPublic)
    } catch (e) {
      console.error('[confirm-mint] milestone evaluation failed', e)
    }
  }



  return NextResponse.json({

    ok: true,

    result: data,

    eligibility,

    launch: launchPublic,

    explorerUrl:

      network === 'devnet'

        ? `https://explorer.solana.com/tx/${encodeURIComponent(txSig)}?cluster=devnet`

        : `https://explorer.solana.com/tx/${encodeURIComponent(txSig)}`,

  })

}


