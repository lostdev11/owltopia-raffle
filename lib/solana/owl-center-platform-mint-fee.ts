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

/**
 * Fail fast before wallet simulation when the platform SOL fee + mint rent + the on-chain mint
 * PRICE cannot be paid. `mintPriceLamportsPerNft` is the candy-guard `solPayment` (+ any
 * `freezeSolPayment` deposit) for the active phase — 0 for free phases. Omitting it would let an
 * under-funded WL/public wallet sign a mint that bot-taxes (platform fee + bot tax charged, no NFT,
 * mint price never taken), which is exactly the "charged fees but got nothing" failure.
 */
export async function assertOwlCenterPlatformMintFeeSolBalance(
  wallet: string,
  network: OwlMintNetwork,
  feeLamports: bigint,
  rpcUrl?: string,
  mintQuantity = 1,
  prefetchedBalanceLamports?: bigint | null,
  mintPriceLamportsPerNft: bigint = 0n
): Promise<{ ok: true; balance: bigint } | { ok: false; error: string; balance: bigint }> {
  const pricePerNft = mintPriceLamportsPerNft > 0n ? mintPriceLamportsPerNft : 0n
  if ((!isOwlCenterPlatformMintFeeEnabled() || feeLamports <= 0n) && pricePerNft <= 0n) {
    return { ok: true, balance: prefetchedBalanceLamports ?? 0n }
  }

  const qty = Math.max(1, Math.floor(mintQuantity))
  const feeEnabled = isOwlCenterPlatformMintFeeEnabled() && feeLamports > 0n
  const totalFee = feeEnabled ? feeLamports * BigInt(qty) : 0n
  const totalPrice = pricePerNft * BigInt(qty)

  try {
    const owner = new PublicKey(wallet)
    const conn = new Connection(rpcUrl?.trim() || getLaunchSolanaRpcUrl(network), 'confirmed')
    const balance =
      prefetchedBalanceLamports ?? BigInt(await conn.getBalance(owner, 'confirmed'))
    const needed = totalFee + totalPrice + OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS * BigInt(qty)
    if (balance < needed) {
      const priceSol = Number(totalPrice) / LAMPORTS_PER_SOL
      const feeSol = Number(totalFee) / LAMPORTS_PER_SOL
      const reserveSol = (Number(OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS) * qty) / LAMPORTS_PER_SOL
      const haveSol = Number(balance) / LAMPORTS_PER_SOL
      const usd = owlCenterPlatformMintFeeUsd()
      const perNft = qty > 1 ? ` (${qty} NFTs)` : ''
      const priceCopy = priceSol > 0 ? `the ${priceSol.toFixed(3)} SOL mint price${perNft}, ` : ''
      return {
        ok: false,
        balance,
        error: `Need ~${(priceSol + feeSol + reserveSol).toFixed(3)} SOL for ${priceCopy}the ~$${usd.toFixed(usd % 1 === 0 ? 0 : 2)} platform fee${priceSol > 0 ? '' : perNft} and rent (your wallet has ~${haveSol.toFixed(3)} SOL).`,
      }
    }
    return { ok: true, balance }
  } catch {
    return { ok: false, balance: prefetchedBalanceLamports ?? 0n, error: 'Could not read wallet SOL balance — check your connection and retry.' }
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

/**
 * Wide fallback band when Jupiter pricing is unavailable at confirm time.
 * Covers ~$0.40–$2.50 notional at SOL/USD between ~40 and ~250.
 */
export function owlCenterPlatformMintFeeVerifyFallbackBand(mintQuantity = 1): {
  minLamports: bigint
  maxLamports: bigint
} {
  const qty = Math.max(1, Math.floor(mintQuantity))
  const unit = owlCenterPlatformMintFeeVerifyFallbackBandUnit()
  return {
    minLamports: unit.minLamports * BigInt(qty),
    maxLamports: unit.maxLamports * BigInt(qty),
  }
}

function owlCenterPlatformMintFeeVerifyFallbackBandUnit(): {
  minLamports: bigint
  maxLamports: bigint
} {
  const usd = owlCenterPlatformMintFeeUsd()
  if (usd <= 0) return { minLamports: 0n, maxLamports: 0n }
  const minLamports = BigInt(Math.max(2_000_000, Math.floor((usd * 0.4 / 250) * LAMPORTS_PER_SOL)))
  const maxLamports = BigInt(Math.ceil((usd * 2.5 / 40) * LAMPORTS_PER_SOL))
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
