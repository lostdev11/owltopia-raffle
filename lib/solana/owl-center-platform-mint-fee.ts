import type { Context, TransactionBuilder } from '@metaplex-foundation/umi'
import { publicKey } from '@metaplex-foundation/umi'
import {
  createIdempotentAssociatedToken,
  findAssociatedTokenPda,
  transferTokens,
} from '@metaplex-foundation/mpl-toolbox'
import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'

import {
  isOwlCenterPlatformMintFeeEnabled,
  owlCenterPlatformMintFeeUsdc,
  owlCenterPlatformMintFeeUsdcRaw,
} from '@/lib/owl-center/platform-mint-fee'
import {
  getOwlCenterPlatformTreasuryWallet,
  getOwlCenterPlatformTreasuryWalletClient,
} from '@/lib/owl-center/platform-treasury'
import { usdcMintForOwlCenterNetwork } from '@/lib/owl-center/usdc-mint'
import type { OwlMintNetwork } from '@/lib/solana/network'

export function shouldCollectOwlCenterPlatformMintFeeClient(): boolean {
  return isOwlCenterPlatformMintFeeEnabled() && !!getOwlCenterPlatformTreasuryWalletClient()
}

/** Append USDC platform fee transfer to an Owl Center mint transaction (minter pays). */
export function appendOwlCenterPlatformMintFeeUsdc(
  umi: Pick<Context, 'identity' | 'programs' | 'eddsa' | 'payer'>,
  network: OwlMintNetwork,
  builder: TransactionBuilder
): { ok: true; builder: TransactionBuilder } | { ok: false; error: string } {
  if (!isOwlCenterPlatformMintFeeEnabled()) {
    return { ok: true, builder }
  }

  const treasury = getOwlCenterPlatformTreasuryWalletClient()
  if (!treasury) {
    return {
      ok: false,
      error: 'Platform treasury not configured — set NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET',
    }
  }

  const mintStr = usdcMintForOwlCenterNetwork(network)
  if (!mintStr) {
    return { ok: false, error: 'USDC mint not configured for this network' }
  }

  const feeRaw = owlCenterPlatformMintFeeUsdcRaw()
  if (feeRaw <= 0n) return { ok: true, builder }

  const usdcMint = publicKey(mintStr)
  const treasuryPk = publicKey(treasury)
  const [sourceAta] = findAssociatedTokenPda(umi, { mint: usdcMint, owner: umi.identity.publicKey })
  const [destAta] = findAssociatedTokenPda(umi, { mint: usdcMint, owner: treasuryPk })

  const next = builder
    .add(
      createIdempotentAssociatedToken(umi, {
        ata: destAta,
        owner: treasuryPk,
        mint: usdcMint,
      })
    )
    .add(transferTokens(umi, { source: sourceAta, destination: destAta, amount: feeRaw }))

  return { ok: true, builder: next }
}

export type VerifyOwlCenterPlatformMintFeeResult = { ok: true } | { ok: false; error: string }

/**
 * Confirms treasury USDC increased by the configured platform mint fee in this transaction.
 */
export function verifyOwlCenterPlatformMintFeeUsdc(params: {
  parsed: ParsedTransactionWithMeta
  network: OwlMintNetwork
}): VerifyOwlCenterPlatformMintFeeResult {
  if (!isOwlCenterPlatformMintFeeEnabled()) {
    return { ok: true }
  }

  const treasury = getOwlCenterPlatformTreasuryWallet()
  if (!treasury) {
    return { ok: false, error: 'Platform treasury not configured (RAFFLE_RECIPIENT_WALLET)' }
  }

  const mintStr = usdcMintForOwlCenterNetwork(params.network)
  if (!mintStr) {
    return { ok: false, error: 'USDC mint not configured for this network' }
  }

  const expectedRaw = owlCenterPlatformMintFeeUsdcRaw()
  if (expectedRaw <= 0n) return { ok: true }

  const meta = params.parsed.meta
  if (!meta || meta.err) {
    return { ok: false, error: 'Transaction failed on-chain' }
  }

  let treasuryPk: PublicKey
  try {
    treasuryPk = new PublicKey(treasury)
  } catch {
    return { ok: false, error: 'Invalid platform treasury wallet' }
  }

  const treasuryB58 = treasuryPk.toBase58()
  const mintB58 = mintStr
  const pre = meta.preTokenBalances ?? []
  const post = meta.postTokenBalances ?? []
  const postB = post.find((b) => b.mint === mintB58 && b.owner === treasuryB58)
  const preB = pre.find((b) => b.mint === mintB58 && b.owner === treasuryB58)
  const postAmt = postB?.uiTokenAmount?.amount
  if (postAmt == null) {
    return {
      ok: false,
      error: `Missing $${owlCenterPlatformMintFeeUsdc()} USDC platform fee to treasury in this transaction`,
    }
  }
  const preAmt = preB?.uiTokenAmount?.amount != null ? preB.uiTokenAmount.amount : '0'
  const increase = BigInt(postAmt) - BigInt(preAmt)
  const tolerance = 1n
  if (increase < expectedRaw - tolerance || increase > expectedRaw + tolerance) {
    return {
      ok: false,
      error: `Platform fee mismatch: expected ${owlCenterPlatformMintFeeUsdc()} USDC to treasury, observed raw delta ${increase.toString()}`,
    }
  }

  return { ok: true }
}
