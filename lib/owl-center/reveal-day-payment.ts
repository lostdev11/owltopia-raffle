import 'server-only'

import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

import {
  isOwlCenterRevealDayFeeEnabled,
  owlCenterRevealDayFeeLamports,
  owlCenterRevealDayFeeUsd,
  owlCenterRevealDayFeeVerifyBand,
  owlCenterRevealDayFeeVerifyFallbackBand,
} from '@/lib/owl-center/reveal-day-fee'
import { getOwlCenterPlatformTreasuryWallet } from '@/lib/owl-center/platform-treasury'
import { collectParsedTransactionAccountKeys } from '@/lib/gen2-presale/verify-payment'
import type { VerifyOwlCenterPlatformMintFeeResult } from '@/lib/solana/owl-center-platform-mint-fee'
import { getLaunchSolanaRpcUrl } from '@/lib/solana/launch-cm'
import type { OwlMintNetwork } from '@/lib/solana/network'

function treasurySolIncrease(parsed: ParsedTransactionWithMeta, treasuryB58: string): bigint | null {
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

export async function verifyOwlCenterRevealDayPayment(params: {
  txSignature: string
  network: OwlMintNetwork
  quotedLamports?: bigint | null
}): Promise<VerifyOwlCenterPlatformMintFeeResult> {
  if (!isOwlCenterRevealDayFeeEnabled()) return { ok: true }

  const treasury = getOwlCenterPlatformTreasuryWallet()
  if (!treasury) {
    return { ok: false, error: 'Platform treasury not configured (OWL_PLATFORM_FEE_TREASURY_WALLET)' }
  }

  const conn = new Connection(getLaunchSolanaRpcUrl(params.network), 'confirmed')
  const parsed = await conn.getParsedTransaction(params.txSignature, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  })
  if (!parsed) return { ok: false, error: 'Transaction not found — wait for confirmation and retry.' }

  const meta = parsed.meta
  if (!meta || meta.err) {
    return { ok: false, error: 'Transaction failed on-chain' }
  }

  const increase = treasurySolIncrease(parsed, treasury)
  if (increase == null) {
    return { ok: false, error: 'Treasury wallet not credited in this transaction' }
  }

  let band: { minLamports: bigint; maxLamports: bigint }
  if (params.quotedLamports && params.quotedLamports > 0n) {
    band = owlCenterRevealDayFeeVerifyBand(params.quotedLamports)
  } else {
    const live = await owlCenterRevealDayFeeLamports()
    band = live ? owlCenterRevealDayFeeVerifyBand(live.lamports) : owlCenterRevealDayFeeVerifyFallbackBand()
  }

  if (increase < band.minLamports || increase > band.maxLamports) {
    const usd = owlCenterRevealDayFeeUsd()
    return {
      ok: false,
      error: `Reveal Day fee mismatch: expected ~$${usd} SOL transfer to treasury, observed ${(Number(increase) / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
    }
  }

  return { ok: true }
}
