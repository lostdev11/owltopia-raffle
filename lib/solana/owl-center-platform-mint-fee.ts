import type { Context, TransactionBuilder } from '@metaplex-foundation/umi'
import { lamports, publicKey } from '@metaplex-foundation/umi'
import { transferSol } from '@metaplex-foundation/mpl-toolbox'
import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

import {
  isOwlCenterPlatformMintFeeEnabled,
  OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS,
  owlCenterPlatformMintFeeLamports,
  owlCenterPlatformMintFeeUsd,
} from '@/lib/owl-center/platform-mint-fee'
import {
  getOwlCenterPlatformTreasuryWallet,
  getOwlCenterPlatformTreasuryWalletClient,
} from '@/lib/owl-center/platform-treasury'
import { collectParsedTransactionAccountKeys } from '@/lib/gen2-presale/verify-payment'
import type { OwlMintNetwork } from '@/lib/solana/network'
import { getLaunchSolanaRpcUrl } from '@/lib/solana/launch-cm'

export function shouldCollectOwlCenterPlatformMintFeeClient(): boolean {
  return isOwlCenterPlatformMintFeeEnabled() && !!getOwlCenterPlatformTreasuryWalletClient()
}

/** Append SOL platform fee transfer to an Owl Center mint transaction (minter pays). */
export function appendOwlCenterPlatformMintFeeSol(
  umi: Pick<Context, 'identity' | 'programs'>,
  feeLamports: bigint,
  builder: TransactionBuilder
): { ok: true; builder: TransactionBuilder } | { ok: false; error: string } {
  if (!isOwlCenterPlatformMintFeeEnabled() || feeLamports <= 0n) {
    return { ok: true, builder }
  }

  const treasury = getOwlCenterPlatformTreasuryWalletClient()
  if (!treasury) {
    return {
      ok: false,
      error: 'Platform treasury not configured — set NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET',
    }
  }

  const next = builder.add(
    transferSol(umi, {
      destination: publicKey(treasury),
      amount: lamports(feeLamports),
    })
  )

  return { ok: true, builder: next }
}

/** Fail fast before wallet simulation when platform SOL fee + mint rent cannot be paid. */
export async function assertOwlCenterPlatformMintFeeSolBalance(
  wallet: string,
  network: OwlMintNetwork,
  feeLamports: bigint,
  rpcUrl?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isOwlCenterPlatformMintFeeEnabled() || feeLamports <= 0n) return { ok: true }

  try {
    const owner = new PublicKey(wallet)
    const conn = new Connection(rpcUrl?.trim() || getLaunchSolanaRpcUrl(network), 'confirmed')
    const balance = BigInt(await conn.getBalance(owner, 'confirmed'))
    const needed = feeLamports + OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS
    if (balance < needed) {
      const feeSol = Number(feeLamports) / LAMPORTS_PER_SOL
      const reserveSol = Number(OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS) / LAMPORTS_PER_SOL
      const usd = owlCenterPlatformMintFeeUsd()
      return {
        ok: false,
        error: `Keep ~${feeSol.toFixed(3)} SOL for the ~$${usd.toFixed(usd % 1 === 0 ? 0 : 2)} platform fee plus ~${reserveSol.toFixed(2)} SOL for NFT rent and network fees.`,
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not read wallet SOL balance — check your connection and retry.' }
  }
}

export type VerifyOwlCenterPlatformMintFeeResult = { ok: true } | { ok: false; error: string }

function treasurySolIncrease(
  parsed: ParsedTransactionWithMeta,
  treasuryB58: string
): bigint | null {
  const meta = parsed.meta
  if (!meta?.preBalances?.length || !meta.postBalances?.length) return null

  const flat = collectParsedTransactionAccountKeys(parsed)

  let treasuryPk: PublicKey
  try {
    treasuryPk = new PublicKey(treasuryB58)
  } catch {
    return null
  }

  const idx = flat.findIndex((k) => k.equals(treasuryPk))
  if (idx < 0) return null
  return BigInt(meta.postBalances[idx] ?? 0) - BigInt(meta.preBalances[idx] ?? 0)
}

/**
 * Confirms treasury SOL increased by the configured platform mint fee in this transaction.
 */
export function verifyOwlCenterPlatformMintFeeSol(params: {
  parsed: ParsedTransactionWithMeta
  minLamports: bigint
  maxLamports: bigint
}): VerifyOwlCenterPlatformMintFeeResult {
  if (!isOwlCenterPlatformMintFeeEnabled()) {
    return { ok: true }
  }

  const treasury = getOwlCenterPlatformTreasuryWallet()
  if (!treasury) {
    return { ok: false, error: 'Platform treasury not configured (OWL_PLATFORM_FEE_TREASURY_WALLET)' }
  }

  const meta = params.parsed.meta
  if (!meta || meta.err) {
    return { ok: false, error: 'Transaction failed on-chain' }
  }

  const increase = treasurySolIncrease(params.parsed, treasury)
  if (increase == null) {
    return { ok: false, error: 'Treasury wallet not credited in this transaction' }
  }

  if (increase < params.minLamports || increase > params.maxLamports) {
    const usd = owlCenterPlatformMintFeeUsd()
    return {
      ok: false,
      error: `Platform fee mismatch: expected ~$${usd} SOL transfer to treasury, observed ${(Number(increase) / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
    }
  }

  return { ok: true }
}

/** Band for server-side fee verification (Jupiter drift between build + confirm). */
export function owlCenterPlatformMintFeeVerifyBand(unitLamports: bigint): {
  minLamports: bigint
  maxLamports: bigint
} {
  const tolerance = BigInt(Math.max(50_000, Math.floor(Number(unitLamports) * 0.15)))
  const minLamports = unitLamports > tolerance ? unitLamports - tolerance : 0n
  const maxLamports = unitLamports + tolerance
  return { minLamports, maxLamports }
}

/** Resolve live platform fee lamports for mint / verify flows. */
export async function resolveOwlCenterPlatformMintFeeLamports(): Promise<
  { ok: true; lamports: bigint; solUsdPrice: number } | { ok: false; error: string }
> {
  const quote = await owlCenterPlatformMintFeeLamports()
  if (!quote || quote.lamports <= 0n) {
    return { ok: false, error: 'Could not price platform fee in SOL — retry shortly.' }
  }
  return { ok: true, lamports: quote.lamports, solUsdPrice: quote.solUsdPrice }
}
