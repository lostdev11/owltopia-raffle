import { Connection, PublicKey } from '@solana/web3.js'

import {
  fetchParsedTransactionWithPoll,
  feePayerMatchesBuyer,
  collectParsedTransactionAccountKeys,
} from '@/lib/gen2-presale/verify-payment'
import {
  owlCenterPlatformMintFeeVerifyBand,
  owlCenterPlatformMintFeeVerifyFallbackBand,
  resolveOwlCenterPlatformMintFeeLamports,
  verifyOwlCenterPlatformMintFeeSol,
} from '@/lib/solana/owl-center-platform-mint-fee'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { resolveOwlCenterMintVerifyRpcUrl, type OwlMintNetwork } from '@/lib/solana/network'
import { pollTransactionSignatureStatus } from '@/lib/solana/recover-candy-machine-mint'

export type VerifyGen2MintTxResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'failed' | 'fee_payer_mismatch' | 'candy_machine_missing' | 'platform_fee_missing' }

/**
 * Confirms the signature exists, succeeded, and fee payer matches minter.
 * Optionally ensures the configured Candy Machine pubkey appears in loaded account keys.
 *
 * TODO: Devnet CM smoke tests; strict ix decode (mintV2) + guard group; Helius enhanced txs.
 * TODO: Parse minted NFT mint addresses from inner instructions for reconciliation.
 */
export async function verifyGen2MintTransaction(params: {
  txSignature: string
  wallet: string
  candyMachineId?: string | null
  /** When set, selects RPC (devnet vs mainnet verification). */
  network?: OwlMintNetwork
  /** When true, require SOL platform fee credit to OWL_PLATFORM_FEE_TREASURY_WALLET in the same tx. */
  requirePlatformMintFee?: boolean
  /** Number of NFTs minted in this tx — scales expected platform fee when batched. */
  mintQuantity?: number
}): Promise<VerifyGen2MintTxResult> {
  const net = params.network ?? 'mainnet'
  const rpcUrl = resolveOwlCenterMintVerifyRpcUrl(net)
  const connection = new Connection(rpcUrl, 'confirmed')
  await pollTransactionSignatureStatus(rpcUrl, params.txSignature, {
    maxWaitMs: 5000,
    intervalMs: 200,
    minCommitment: 'processed',
  })
  const parsed = await fetchParsedTransactionWithPoll(connection, params.txSignature, {
    maxWaitMs: 3000,
    intervalMs: 200,
  })
  if (!parsed) return { ok: false, reason: 'not_found' }
  if (parsed.meta?.err) return { ok: false, reason: 'failed' }

  const buyer = new PublicKey(normalizeSolanaWalletAddress(params.wallet) ?? params.wallet)
  if (!feePayerMatchesBuyer(parsed, buyer)) {
    return { ok: false, reason: 'fee_payer_mismatch' }
  }

  const cm = params.candyMachineId?.trim()
  if (cm) {
    try {
      const cmPk = new PublicKey(cm)
      const flat = collectParsedTransactionAccountKeys(parsed)
      const hit = flat.some((k) => k.equals(cmPk))
      if (!hit) {
        return { ok: false, reason: 'candy_machine_missing' }
      }
    } catch {
      return { ok: false, reason: 'candy_machine_missing' }
    }
  }

  if (params.requirePlatformMintFee) {
    const mintQty = Math.max(1, Math.floor(params.mintQuantity ?? 1))
    const feeQuote = await resolveOwlCenterPlatformMintFeeLamports()
    const band = feeQuote.ok
      ? owlCenterPlatformMintFeeVerifyBand(feeQuote.lamports * BigInt(mintQty))
      : owlCenterPlatformMintFeeVerifyFallbackBand(mintQty)
    const feeCheck = verifyOwlCenterPlatformMintFeeSol({
      parsed,
      minLamports: band.minLamports,
      maxLamports: band.maxLamports,
    })
    if (!feeCheck.ok) {
      return { ok: false, reason: 'platform_fee_missing' }
    }
  }

  return { ok: true }
}
