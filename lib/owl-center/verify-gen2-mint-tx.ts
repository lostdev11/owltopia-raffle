import { Connection, PublicKey } from '@solana/web3.js'

import { fetchParsedTransactionConfirmed, feePayerMatchesBuyer, collectParsedTransactionAccountKeys } from '@/lib/gen2-presale/verify-payment'
import {
  owlCenterPlatformMintFeeVerifyBand,
  resolveOwlCenterPlatformMintFeeLamports,
  verifyOwlCenterPlatformMintFeeSol,
} from '@/lib/solana/owl-center-platform-mint-fee'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { resolveOwlCenterMintVerifyRpcUrl, type OwlMintNetwork } from '@/lib/solana/network'

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
  /** When true, require SOL platform fee credit to RAFFLE_RECIPIENT_WALLET in the same tx. */
  requirePlatformMintFee?: boolean
}): Promise<VerifyGen2MintTxResult> {
  const net = params.network ?? 'mainnet'
  const connection = new Connection(resolveOwlCenterMintVerifyRpcUrl(net), 'confirmed')
  const parsed = await fetchParsedTransactionConfirmed(connection, params.txSignature)
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
    const feeQuote = await resolveOwlCenterPlatformMintFeeLamports()
    if (!feeQuote.ok) {
      return { ok: false, reason: 'platform_fee_missing' }
    }
    const band = owlCenterPlatformMintFeeVerifyBand(feeQuote.lamports)
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
