import { NextRequest, NextResponse } from 'next/server'
import bs58 from 'bs58'
import { getMerkleProof, getMerkleRoot } from '@metaplex-foundation/mpl-candy-machine'

import { listGen1MerkleWallets } from '@/lib/db/gen2-gen1-snapshot'
import { listWlMerkleWallets } from '@/lib/db/owl-center-wl-allocations'
import { listGen2PresaleMerkleWallets } from '@/lib/gen2-presale/db'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * Merkle allowlist root + per-wallet proof for the Gen2 Candy Machine allowList guard.
 *
 * Sources (must be FROZEN before the corresponding on-chain merkle root is set — see
 * docs/OWL_CENTER_ARWEAVE_COLLECTION_PIPELINE.md launch checklist):
 * - phase=WHITELIST                  → owl_center_wl_allocations (allowed_mints > 0)
 * - phase=PRESALE | PRESALE_OVERAGE  → gen2_presale_balances (purchased or gifted credits)
 *                                      plus gen2_presale_overage_allocations (Presale+13)
 * - phase=AIRDROP                    → gen2_gen1_airdrop_snapshot (admin-taken Gen1 holder
 *                                      snapshot; /api/admin/owl-center/gen2/gen1-snapshot)
 *
 * Operators: call without `wallet` to get the canonical `merkle_root` (base58) for
 * `sugar guard` / candy guard config. Minters: the client calls with `wallet` to build
 * the allowList `route` (proof) instruction before `mintV2`.
 */

type AllowlistSource = 'WHITELIST' | 'PRESALE' | 'AIRDROP'

function sourceForPhase(phaseRaw: string | null): AllowlistSource | null {
  const phase = phaseRaw?.trim().toUpperCase()
  if (phase === 'WHITELIST') return 'WHITELIST'
  if (phase === 'PRESALE' || phase === 'PRESALE_OVERAGE') return 'PRESALE'
  if (phase === 'AIRDROP') return 'AIRDROP'
  return null
}

// Allowlists are frozen pre-launch; short cache absorbs mint-window bursts.
const CACHE_TTL_MS = 30_000
const cache = new Map<AllowlistSource, { wallets: string[]; at: number }>()

async function getAllowlist(source: AllowlistSource): Promise<string[]> {
  const hit = cache.get(source)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.wallets
  const wallets =
    source === 'WHITELIST'
      ? await listWlMerkleWallets()
      : source === 'AIRDROP'
        ? await listGen1MerkleWallets()
        : await listGen2PresaleMerkleWallets()
  cache.set(source, { wallets, at: Date.now() })
  return wallets
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-gen2-wl-proof:${ip}`, 60, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const source = sourceForPhase(request.nextUrl.searchParams.get('phase'))
  if (!source) {
    return NextResponse.json(
      { error: 'Unsupported phase — allowlist proofs exist for AIRDROP, PRESALE, PRESALE_OVERAGE and WHITELIST.' },
      { status: 422 }
    )
  }

  const wallets = await getAllowlist(source)
  if (wallets.length === 0) {
    return NextResponse.json(
      {
        error:
          source === 'AIRDROP'
            ? 'Gen1 snapshot is empty — take one via /api/admin/owl-center/gen2/gen1-snapshot first.'
            : 'Allowlist is empty — not configured yet',
      },
      { status: 404 }
    )
  }

  const merkleRoot = bs58.encode(getMerkleRoot(wallets))

  const walletRaw = request.nextUrl.searchParams.get('wallet')?.trim()
  if (!walletRaw) {
    // Operator mode: root + count only (paste root into candy guard config).
    return NextResponse.json({ source, merkle_root: merkleRoot, count: wallets.length })
  }

  const wallet = normalizeSolanaWalletAddress(walletRaw)
  if (!wallet) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  }
  if (!wallets.includes(wallet)) {
    return NextResponse.json(
      {
        error:
          source === 'AIRDROP'
            ? 'Wallet not in the Gen1 holder snapshot. The snapshot is final — wallets that acquired Gen1 after it do not qualify for the holder mint.'
            : 'Wallet not on allowlist for this phase',
      },
      { status: 404 }
    )
  }

  const proof = getMerkleProof(wallets, wallet).map((node) => bs58.encode(node))
  return NextResponse.json({ source, merkle_root: merkleRoot, count: wallets.length, wallet, proof })
}
