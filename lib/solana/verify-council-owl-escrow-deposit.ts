/**
 * Verify a confirmed tx moved OWL from payer to the council escrow wallet (any positive amount ≥ min).
 */
import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { getSolanaConnection } from '@/lib/solana/connection'
import { getCouncilOwlEscrowPublicKeyBase58 } from '@/lib/council/council-owl-escrow-keypair'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

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

export type VerifyCouncilOwlEscrowDepositResult =
  | { ok: true; amountRaw: bigint; parsedTransaction: ParsedTransactionWithMeta }
  | { ok: false; error: string }

export async function verifyCouncilOwlEscrowDeposit(params: {
  signature: string
  payerWallet: string
  minRaw: bigint
}): Promise<VerifyCouncilOwlEscrowDepositResult> {
  const sig = params.signature.trim()
  if (!sig) return { ok: false, error: 'Missing transaction signature' }

  if (!isOwlEnabled()) {
    return { ok: false, error: 'OWL token is not configured on this deployment' }
  }

  const escrowB58 = getCouncilOwlEscrowPublicKeyBase58()
  if (!escrowB58) {
    return { ok: false, error: 'Council OWL escrow is not configured' }
  }

  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress) {
    return { ok: false, error: 'OWL mint not configured' }
  }

  let payer: PublicKey
  try {
    payer = new PublicKey(params.payerWallet.trim())
  } catch {
    return { ok: false, error: 'Invalid payer wallet' }
  }

  const mintB58 = owl.mintAddress
  const escrowDelta = (meta: NonNullable<ParsedTransactionWithMeta['meta']>) =>
    tokenDeltaForOwnerMint(meta, escrowB58, mintB58)
  const payerDelta = (meta: NonNullable<ParsedTransactionWithMeta['meta']>) =>
    tokenDeltaForOwnerMint(meta, payer.toBase58(), mintB58)

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

  const ed = escrowDelta(meta)
  const pd = payerDelta(meta)
  const tolerance = 1n

  if (ed < params.minRaw - tolerance) {
    return {
      ok: false,
      error: 'OWL credit to council escrow is below the minimum for this deposit.',
    }
  }

  if (pd > -ed + tolerance || pd < -ed - tolerance) {
    return {
      ok: false,
      error: 'OWL debit from your wallet does not match the escrow credit in this transaction',
    }
  }

  if (ed <= 0n) {
    return { ok: false, error: 'No OWL was credited to the council escrow in this transaction' }
  }

  return { ok: true, amountRaw: ed, parsedTransaction: tx }
}
