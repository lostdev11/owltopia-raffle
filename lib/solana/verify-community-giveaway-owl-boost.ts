/**
 * Verify a single transaction moved exactly `expectedUiOwl` OWL from payer wallet to raffle treasury.
 */
import { PublicKey } from '@solana/web3.js'
import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { getSolanaConnection } from '@/lib/solana/connection'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

function raffleTreasuryPubkey(): PublicKey | null {
  const w = getRaffleTreasuryWalletAddress()
  if (!w) return null
  try {
    return new PublicKey(w)
  } catch {
    return null
  }
}

function tokenDeltaForOwnerMint(
  meta: NonNullable<ParsedTransactionWithMeta['meta']>,
  ownerB58: string,
  mintB58: string
): bigint {
  const pre = meta.preTokenBalances ?? []
  const post = meta.postTokenBalances ?? []
  const preB = pre.find((b) => b.mint === mintB58 && b.owner === ownerB58)
  const postB = post.find((b) => b.mint === mintB58 && b.owner === ownerB58)
  const preAmt = preB?.uiTokenAmount?.amount != null ? BigInt(preB.uiTokenAmount.amount) : 0n
  const postAmt = postB?.uiTokenAmount?.amount != null ? BigInt(postB.uiTokenAmount.amount) : 0n
  return postAmt - preAmt
}

export type VerifyCommunityGiveawayOwlBoostResult =
  | { ok: true; parsedTransaction: ParsedTransactionWithMeta }
  | { ok: false; error: string }

/**
 * Confirms treasury OWL ATA increased by expected raw amount and payer OWL ATA decreased by the same (±1 atom).
 */
export async function verifyCommunityGiveawayOwlBoostPayment(params: {
  signature: string
  payerWallet: string
  expectedUiOwl: number
}): Promise<VerifyCommunityGiveawayOwlBoostResult> {
  const sig = params.signature.trim()
  if (!sig) return { ok: false, error: 'Missing transaction signature' }

  if (!isOwlEnabled()) {
    return { ok: false, error: 'OWL token is not configured on this deployment' }
  }

  const treasury = raffleTreasuryPubkey()
  if (!treasury) {
    return {
      ok: false,
      error: 'Raffle treasury not configured (RAFFLE_RECIPIENT_WALLET or NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET)',
    }
  }

  const owlInfo = getTokenInfo('OWL')
  if (!owlInfo.mintAddress) {
    return { ok: false, error: 'OWL mint not configured' }
  }

  let payer: PublicKey
  try {
    payer = new PublicKey(params.payerWallet.trim())
  } catch {
    return { ok: false, error: 'Invalid payer wallet' }
  }

  const mintB58 = owlInfo.mintAddress
  const decimals = owlInfo.decimals
  const expectedRaw = BigInt(Math.round(params.expectedUiOwl * Math.pow(10, decimals)))
  if (expectedRaw <= 0n) {
    return { ok: false, error: 'Invalid expected OWL amount' }
  }

  const connection = getSolanaConnection()
  const tx = await connection.getParsedTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  })

  if (!tx) {
    return { ok: false, error: 'Transaction not found or failed on-chain' }
  }
  const meta = tx.meta
  if (!meta || meta.err) {
    return { ok: false, error: 'Transaction not found or failed on-chain' }
  }

  const treasuryB58 = treasury.toBase58()
  const payerB58 = payer.toBase58()

  const treasuryDelta = tokenDeltaForOwnerMint(meta, treasuryB58, mintB58)
  const payerDelta = tokenDeltaForOwnerMint(meta, payerB58, mintB58)

  const tolerance = 1n
  if (treasuryDelta < expectedRaw - tolerance || treasuryDelta > expectedRaw + tolerance) {
    return {
      ok: false,
      error: `OWL amount to treasury mismatch: expected ${params.expectedUiOwl} OWL, observed raw delta ${treasuryDelta.toString()}`,
    }
  }

  if (payerDelta > -expectedRaw + tolerance || payerDelta < -expectedRaw - tolerance) {
    return {
      ok: false,
      error: 'OWL debit from your wallet does not match the treasury credit in this transaction',
    }
  }

  return { ok: true, parsedTransaction: tx }
}
