import { NextRequest, NextResponse } from 'next/server'

import { buildSimpleMintEligibility } from '@/lib/owl-center/simple-mint-eligibility'
import type { OwlCenterPhase } from '@/lib/owl-center/types'
import { verifyGen2MintTransaction } from '@/lib/owl-center/verify-gen2-mint-tx'
import { getOwlCenterLaunchBySlug, getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { getLaunchCandyMachineId, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { owlCenterSolanaExplorerTxUrl, owlMintNetworkFromParam, type OwlMintNetwork } from '@/lib/solana/network'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const SIG_REGEX = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-col-confirm:${ip}`, 45, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { slug: raw } = await context.params
  const slug = raw?.trim().toLowerCase() ?? ''
  if (!SLUG_RE.test(slug) || slug === 'gen2') {
    return NextResponse.json({ error: 'Invalid collection slug' }, { status: 400 })
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
  const phase = (body.phase?.trim().toUpperCase() ?? 'PUBLIC') as OwlCenterPhase

  let network: OwlMintNetwork = resolveLaunchMintNetwork(
    (await getOwlCenterLaunchBySlugAdmin(slug)) ?? { mint_mode: 'public_simple', mint_network: null }
  )
  if (body.network?.trim()) {
    const parsed = owlMintNetworkFromParam(body.network)
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid network — use devnet or mainnet' }, { status: 400 })
    }
    network = parsed
  }

  if (!wallet || !SIG_REGEX.test(txSig) || !Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json({ error: 'Invalid wallet, signature, or quantity' }, { status: 400 })
  }

  if (phase !== 'PUBLIC') {
    return NextResponse.json({ error: 'Invalid phase — public_simple collections mint in PUBLIC only' }, { status: 400 })
  }

  const launch = await getOwlCenterLaunchBySlugAdmin(slug)
  if (!launch) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  if (launch.mint_mode !== 'public_simple') {
    return NextResponse.json({ error: 'This collection does not use the public mint console' }, { status: 400 })
  }

  const candyMachineId = getLaunchCandyMachineId(launch, network)
  if (!candyMachineId.trim()) {
    return NextResponse.json(
      { error: network === 'devnet' ? 'Missing devnet Candy Machine ID' : 'Missing Candy Machine ID' },
      { status: 400 }
    )
  }

  const verified = await verifyGen2MintTransaction({ txSignature: txSig, wallet, candyMachineId, network })
  if (!verified.ok) {
    const map: Record<string, string> = {
      not_found: 'Transaction not found on the selected network RPC',
      failed: 'Mint transaction failed on-chain',
      fee_payer_mismatch: 'Fee payer does not match wallet',
      candy_machine_missing: 'Transaction does not reference the configured Candy Machine',
    }
    return NextResponse.json({ error: map[verified.reason] ?? 'Verification failed' }, { status: 400 })
  }

  const mintedList = Array.isArray(body.mintedNftMints)
    ? body.mintedNftMints.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : []

  const eligibilityPre = await buildSimpleMintEligibility(slug, wallet)
  if (!eligibilityPre) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  if (eligibilityPre.active_phase !== phase) {
    return NextResponse.json({ error: 'Phase mismatch — refresh and try again' }, { status: 400 })
  }
  const absQtyCap = 10
  if (qty > absQtyCap) {
    return NextResponse.json({ error: `Quantity cannot exceed ${absQtyCap} per transaction` }, { status: 400 })
  }
  if (!eligibilityPre.is_eligible || qty > eligibilityPre.max_mintable) {
    return NextResponse.json(
      { error: 'Not eligible for this mint quantity — refresh your allocation' },
      { status: 400 }
    )
  }

  const db = getSupabaseAdmin()
  const { data, error } = await db.rpc('confirm_owl_center_gen2_mint', {
    p_launch_slug: slug,
    p_wallet: wallet,
    p_tx_signature: txSig,
    p_quantity: qty,
    p_phase: phase,
    p_minted_nft_mints: mintedList,
    p_network: network,
    p_event_candy_machine_id: candyMachineId,
  })

  if (error) {
    console.error('confirm_owl_center_gen2_mint', slug, error)
    return NextResponse.json(
      { error: 'Transaction succeeded but database record failed — contact support with your signature.' },
      { status: 500 }
    )
  }

  const row = data as { ok?: boolean; error?: string } | null
  if (!row || row.ok !== true) {
    const err = typeof row?.error === 'string' ? row.error : 'confirm_failed'
    const status =
      err === 'duplicate_tx' ? 409 : err === 'mint_paused' || err === 'mint_closed' ? 403 : 400
    const human: Record<string, string> = {
      duplicate_tx: 'This transaction was already recorded',
      mint_paused: 'Mint temporarily paused',
      mint_closed: 'Mint is closed for this launch',
      phase_mismatch: 'Phase mismatch — refresh and try again',
      exceeds_supply: 'Would exceed total supply',
      wallet_mint_limit: 'Wallet mint limit reached',
      launch_not_found: 'Launch not found',
      invalid_quantity: 'Invalid quantity',
    }
    return NextResponse.json({ error: human[err] ?? err }, { status })
  }

  const [eligibility, launchPublic] = await Promise.all([
    buildSimpleMintEligibility(slug, wallet),
    getOwlCenterLaunchBySlug(slug),
  ])

  let sellout_prep: Awaited<ReturnType<typeof import('@/lib/owl-center/sellout-marketplace-prep').runSelloutMarketplacePrep>> | null =
    null
  const resultRow = data as { ok?: boolean; active_phase?: string; status?: string } | null
  if (
    launchPublic &&
    (resultRow?.active_phase === 'SOLD_OUT' || resultRow?.status === 'SOLD_OUT' || launchPublic.active_phase === 'SOLD_OUT')
  ) {
    const { runSelloutMarketplacePrep } = await import('@/lib/owl-center/sellout-marketplace-prep')
    sellout_prep = await runSelloutMarketplacePrep(launchPublic)
  }

  const launchAfter = sellout_prep?.ok
    ? await getOwlCenterLaunchBySlug(slug)
    : launchPublic

  return NextResponse.json({
    ok: true,
    result: data,
    eligibility,
    launch: launchAfter ?? launchPublic,
    sellout_prep,
    explorerUrl: owlCenterSolanaExplorerTxUrl(txSig, network),
  })
}
