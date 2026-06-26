import { NextRequest, NextResponse } from 'next/server'



import { buildGen2Eligibility } from '@/lib/owl-center/gen2-eligibility'

import { evaluateGen2MintMilestones } from '@/lib/owl-center/gen2-milestones/evaluate'

import { getOwlCenterLaunchBySlug, getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'

import { getLivePhases } from '@/lib/owl-center/phase-schedule'

import { gen2GuardGroupLabel, isGen2MintablePhase } from '@/lib/solana/gen2-guards'

import type { OwlCenterPhase } from '@/lib/owl-center/types'

import { verifyGen2MintTransaction } from '@/lib/owl-center/verify-gen2-mint-tx'

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

    minMintedNfts: qty,

    expectedGuardGroupLabel,

  })

  if (!verified.ok) {

    const map: Record<string, string> = {

      not_found: 'Transaction not found on the selected network RPC',

      failed: 'Mint transaction failed on-chain',

      fee_payer_mismatch: 'Fee payer does not match wallet',

      candy_machine_missing: 'Transaction does not reference the configured Candy Machine',

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


