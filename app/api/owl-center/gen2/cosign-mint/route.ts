import { NextRequest, NextResponse } from 'next/server'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchCandyMachine, mplCandyMachine, safeFetchMintCounterFromSeeds } from '@metaplex-foundation/mpl-candy-machine'
import { publicKey, type Transaction } from '@metaplex-foundation/umi'

import { buildGen2Eligibility } from '@/lib/owl-center/gen2-eligibility'
import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import type { OwlCenterPhase } from '@/lib/owl-center/types'
import { gen2GuardGroupLabel, type Gen2MintablePhase } from '@/lib/solana/gen2-guards'
import { createGen2CosignerSigner, isGen2CosignerConfigured } from '@/lib/solana/gen2-cosigner'
import { getGen2CandyMachineId, getSolanaRpcUrl, isDevnetMintEnabled } from '@/lib/solana/network'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Co-signs free-phase (gen1 airdrop / presale) Candy Machine mints AFTER verifying the wallet has
 * the credits. The `pre`/`gen1` guard groups carry a `thirdPartySigner` whose key is this server's
 * co-signer, so a mint cannot land without this signature — which we only add up to the exact
 * number of NFTs the wallet is still allowed.
 *
 * Per-wallet enforcement is bounded by the ON-CHAIN mint-counter PDA (tamper-proof: it counts every
 * mint that actually landed, whether or not the site's confirm endpoint was called) plus a short
 * DB hold for in-flight concurrency. This closes the website-bypass over-mint edge case that a flat
 * on-chain mintLimit cannot express (presale amounts vary per wallet).
 */

// Candy Guard program + `mintV2` Anchor discriminator (from @metaplex-foundation/mpl-candy-machine
// generated/instructions/mintV2). Used to find + verify the mint instruction in each tx.
const CANDY_GUARD_PROGRAM_ID = 'Guard1JwRhJkVH6XZhzoYxeBVQe872VH6QggF4BWmS9g'
const MINT_V2_DISCRIMINATOR = [120, 121, 23, 146, 173, 110, 199, 205] as const
// Account index of the Candy Machine within a mintV2 instruction (see the generated instruction).
const MINT_V2_CANDY_MACHINE_ACCOUNT_INDEX = 2

const COSIGNED_PHASES: OwlCenterPhase[] = ['AIRDROP', 'PRESALE', 'PRESALE_OVERAGE']
const MAX_TXS_PER_REQUEST = 25

// On-chain mintLimit guard ids (must match scripts/gen2-cm-setup.ts): gen1=1, pre=4. The counter
// PDA for these ids is the durable per-wallet mint count we bound co-signing against.
const PHASE_MINT_LIMIT_ID: Record<string, number> = {
  AIRDROP: 1,
  PRESALE: 4,
  PRESALE_OVERAGE: 4,
}

// The candy guard pubkey (CM mintAuthority) is immutable for a launch — cache it to drop an RPC
// fetch from the per-mint hot path. Only the per-wallet mint counter is read live each request.
const candyGuardCache = new Map<string, string>()

function dataStartsWithMintV2(data: Uint8Array): boolean {
  if (data.length < MINT_V2_DISCRIMINATOR.length) return false
  for (let i = 0; i < MINT_V2_DISCRIMINATOR.length; i++) {
    if (data[i] !== MINT_V2_DISCRIMINATOR[i]) return false
  }
  return true
}

/**
 * mintV2 data is `discriminator(8) + mintArgs(u32 len + bytes) + group(option<string>)`, so the
 * group label is the LAST field — a umi option `Some` = `0x01 + u32le(len) + utf8`, `None` = `0x00`.
 * Matching the encoded tail avoids a fragile deep import of the instruction serializer.
 */
function expectedGroupTail(label: string | null): Uint8Array {
  if (!label) return Uint8Array.from([0])
  const utf8 = new TextEncoder().encode(label)
  const out = new Uint8Array(1 + 4 + utf8.length)
  out[0] = 1
  new DataView(out.buffer).setUint32(1, utf8.length, true)
  out.set(utf8, 5)
  return out
}

function dataEndsWith(data: Uint8Array, tail: Uint8Array): boolean {
  if (data.length < tail.length) return false
  const start = data.length - tail.length
  for (let i = 0; i < tail.length; i++) {
    if (data[start + i] !== tail[i]) return false
  }
  return true
}

/**
 * Verify a tx is paid by `wallet` and contains EXACTLY ONE mintV2 for OUR Candy Machine and the
 * EXPECTED guard group, so one co-signature can never authorize more than one mint, nor a mint in a
 * different group (which would consume the wrong pool / per-wallet counter).
 */
function verifyMintTx(
  tx: Transaction,
  args: { wallet: string; candyMachineB58: string; groupTail: Uint8Array }
): { ok: true } | { ok: false; reason: string } {
  const accounts = tx.message.accounts.map((a) => String(a))
  if (accounts[0] !== args.wallet) return { ok: false, reason: 'fee_payer' }

  let mintCount = 0
  for (const ix of tx.message.instructions) {
    if (accounts[ix.programIndex] !== CANDY_GUARD_PROGRAM_ID) continue
    if (!dataStartsWithMintV2(ix.data)) continue

    const cmIdx = ix.accountIndexes[MINT_V2_CANDY_MACHINE_ACCOUNT_INDEX]
    if (cmIdx == null || accounts[cmIdx] !== args.candyMachineB58) return { ok: false, reason: 'wrong_cm' }
    if (!dataEndsWith(ix.data, args.groupTail)) return { ok: false, reason: 'wrong_group' }
    mintCount++
  }
  if (mintCount !== 1) return { ok: false, reason: 'mint_count' }
  return { ok: true }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-gen2-cosign:${ip}`, 30, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  if (!isGen2CosignerConfigured()) {
    return NextResponse.json({ error: 'Mint co-signer not configured' }, { status: 503 })
  }

  let body: { wallet?: string; transactions?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const wallet = body.wallet?.trim() ? normalizeSolanaWalletAddress(body.wallet.trim()) : null
  if (!wallet) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  }

  const txsB64 = Array.isArray(body.transactions)
    ? body.transactions.filter((t): t is string => typeof t === 'string' && t.length > 0)
    : []
  if (txsB64.length === 0 || txsB64.length > MAX_TXS_PER_REQUEST) {
    return NextResponse.json({ error: 'Invalid transactions payload' }, { status: 400 })
  }

  // Network is server-authoritative (matches eligibility) — never trust the request, or a parallel
  // mainnet+devnet pair could each get a full hold budget against the same machine.
  const network = isDevnetMintEnabled() ? 'devnet' : 'mainnet'

  const launch = await getOwlCenterLaunchBySlugAdmin('gen2')
  if (!launch) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }
  const candyMachineId = getGen2CandyMachineId(launch).trim()
  if (!candyMachineId) {
    return NextResponse.json({ error: 'Missing Candy Machine ID' }, { status: 400 })
  }

  // The active phase (server-authoritative) decides eligibility + whether co-signing applies.
  const eligibility = await buildGen2Eligibility(wallet)
  if (!eligibility) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }
  const phase = eligibility.active_phase
  if (!COSIGNED_PHASES.includes(phase)) {
    return NextResponse.json({ error: 'Co-sign not required for this phase' }, { status: 400 })
  }
  if (!eligibility.is_eligible || eligibility.max_mintable <= 0) {
    return NextResponse.json({ error: 'Not eligible to mint in this phase' }, { status: 403 })
  }

  const groupTail = expectedGroupTail(gen2GuardGroupLabel(phase as Gen2MintablePhase))
  const mintLimitId = PHASE_MINT_LIMIT_ID[phase]
  if (mintLimitId == null) {
    return NextResponse.json({ error: 'Co-sign not configured for this phase' }, { status: 400 })
  }

  // Total per-wallet entitlement for this group (independent of confirm bookkeeping):
  //  - AIRDROP: Gen1 NFTs held; counter id 1 counts gen1-group mints.
  //  - PRESALE/PRESALE_OVERAGE: purchased + gifted; counter id 4 counts all pre-group mints.
  const entitlement =
    phase === 'AIRDROP'
      ? eligibility.gen1_snapshot?.gen1_nft_count ?? 0
      : (eligibility.presale_balance?.purchased_mints ?? 0) + (eligibility.presale_balance?.gifted_mints ?? 0)

  const umi = createUmi(getSolanaRpcUrl(), { commitment: 'confirmed' }).use(mplCandyMachine())
  const signer = createGen2CosignerSigner(umi)
  if (!signer) {
    return NextResponse.json({ error: 'Mint co-signer not configured' }, { status: 503 })
  }

  // Read the on-chain per-wallet mint count for this group (tamper-proof) and bound co-signing by
  // (entitlement - on-chain minted). Fail CLOSED if the chain can't be read.
  let onChainMinted = 0
  try {
    const cmPk = publicKey(candyMachineId)
    let candyGuardB58 = candyGuardCache.get(candyMachineId)
    if (!candyGuardB58) {
      const cm = await fetchCandyMachine(umi, cmPk)
      candyGuardB58 = String(cm.mintAuthority)
      candyGuardCache.set(candyMachineId, candyGuardB58)
    }
    const counter = await safeFetchMintCounterFromSeeds(umi, {
      id: mintLimitId,
      user: publicKey(wallet),
      candyGuard: publicKey(candyGuardB58),
      candyMachine: cmPk,
    })
    onChainMinted = counter ? Number(counter.count) : 0
  } catch (e) {
    console.error('cosign counter read failed', e)
    return NextResponse.json({ error: 'Could not verify on-chain mint count — try again' }, { status: 503 })
  }

  // Effective cap = the tighter of the phase allowance (pool/supply aware) and the tamper-proof
  // per-wallet remainder. The hold then prevents two in-flight requests double-spending it.
  const securityRemaining = Math.max(0, entitlement - onChainMinted)
  const effectiveCap = Math.min(eligibility.max_mintable, securityRemaining)
  const quantity = txsB64.length
  if (quantity > effectiveCap) {
    return NextResponse.json(
      {
        error:
          securityRemaining <= 0
            ? 'You have already minted all your allotted spots in this phase.'
            : `You can mint ${effectiveCap} more in this phase, not ${quantity}.`,
      },
      { status: 403 }
    )
  }

  const db = getSupabaseAdmin()
  const { data: holdData, error: holdError } = await db.rpc('gen2_cosign_hold', {
    p_launch_id: launch.id,
    p_wallet: wallet,
    p_phase: phase,
    p_network: network,
    p_quantity: quantity,
    p_max_allowed: effectiveCap,
  })
  if (holdError) {
    console.error('gen2_cosign_hold', holdError)
    return NextResponse.json({ error: 'Could not reserve mint — try again' }, { status: 500 })
  }
  const hold = holdData as { ok?: boolean; reason?: string } | null
  if (!hold || hold.ok !== true) {
    return NextResponse.json(
      {
        error:
          hold?.reason === 'over_limit'
            ? 'You already have mints in progress — finish or wait a moment, then retry.'
            : 'Mint allowance exceeded for this phase.',
      },
      { status: 403 }
    )
  }

  // Deserialize + verify each tx (exactly one mintV2 for OUR CM + EXPECTED group, paid by wallet),
  // so a single co-signature can never authorize an extra or out-of-group mint.
  let deserialized: Transaction[]
  try {
    deserialized = txsB64.map((b64) => umi.transactions.deserialize(new Uint8Array(Buffer.from(b64, 'base64'))))
  } catch {
    return NextResponse.json({ error: 'Malformed transaction(s)' }, { status: 400 })
  }
  for (const tx of deserialized) {
    const v = verifyMintTx(tx, { wallet, candyMachineB58: candyMachineId, groupTail })
    if (!v.ok) {
      const map: Record<string, string> = {
        fee_payer: 'Transaction fee payer must be your wallet',
        wrong_cm: 'Transaction targets the wrong collection',
        wrong_group: 'Transaction uses the wrong mint phase',
        malformed: 'Malformed mint transaction',
        mint_count: 'Each transaction must contain exactly one mint for this collection',
      }
      return NextResponse.json({ error: map[v.reason] ?? 'Invalid mint transaction' }, { status: 400 })
    }
  }

  try {
    const cosigned = await signer.signAllTransactions(deserialized)
    const out = cosigned.map((tx) => Buffer.from(umi.transactions.serialize(tx)).toString('base64'))
    return NextResponse.json({ ok: true, transactions: out, phase })
  } catch (e) {
    console.error('cosign sign failed', e)
    return NextResponse.json({ error: 'Co-sign failed — try again' }, { status: 500 })
  }
}
