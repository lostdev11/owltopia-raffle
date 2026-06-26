/**
 * Gen2 mint-proceeds distribution wallet.
 *
 * The candy-guard `solPayment` can only pay ONE destination, so the enforced (bot-proof) mint
 * price + the freeze escrow both land in this single, SERVER-CONTROLLED wallet. The
 * `/api/cron/gen2-treasury-split` cron then sweeps it 50/50 (per `mint_fund_splits`) to the
 * founder wallets. This keeps the on-chain mint path bot-proof while still funding both founders
 * automatically — the presale-safe outcome without the atomic-mint loophole.
 *
 * Env:
 *   GEN2_MINT_PROCEEDS_SECRET_KEY  base58 or JSON-array secret key (server only — holds revenue
 *                                  between sweeps; keep it out of git and rotate after launch).
 *   GEN2_MINT_PROCEEDS_WALLET      (optional) the base58 address; derived from the secret if unset.
 *
 * Generate one with: npx --yes tsx scripts/gen2-gen-distribution-wallet.ts
 */
import bs58 from 'bs58'
import { Keypair } from '@solana/web3.js'

/** Founder wallet split fallback (mirrors owl_center_launches.mint_fund_splits for slug `gen2`). */
export const GEN2_MINT_FUND_SPLITS_FALLBACK: ReadonlyArray<{ address: string; share: number }> = [
  { address: '7gra2JyY969Lt3BXLb6FMx9DxouXcEpRzpiKnc6wFgrq', share: 50 }, // Founder A
  { address: 'qg7pNNZq7qDQuc6Xkd1x4NvS2VM3aHtCqHEzucZxRGA', share: 50 }, // Founder B
]

export function parseGen2MintProceedsSecret(): Uint8Array | null {
  const raw = process.env.GEN2_MINT_PROCEEDS_SECRET_KEY?.trim()
  if (!raw) return null
  try {
    return bs58.decode(raw)
  } catch {
    try {
      const parsed = JSON.parse(raw) as number[]
      if (Array.isArray(parsed) && parsed.length >= 64) return Uint8Array.from(parsed)
    } catch {
      // not JSON either
    }
  }
  return null
}

/** Distribution wallet keypair (server only). */
export function loadGen2MintProceedsKeypair(): Keypair | null {
  const secret = parseGen2MintProceedsSecret()
  if (!secret) return null
  try {
    return Keypair.fromSecretKey(secret)
  } catch {
    return null
  }
}

/** Distribution wallet base58 address — explicit env, else derived from the secret. */
export function getGen2MintProceedsWalletAddress(): string | null {
  const explicit = process.env.GEN2_MINT_PROCEEDS_WALLET?.trim()
  if (explicit) return explicit
  return loadGen2MintProceedsKeypair()?.publicKey.toBase58() ?? null
}
