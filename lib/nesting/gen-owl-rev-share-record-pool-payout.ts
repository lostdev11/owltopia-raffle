import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getGenOwlRevSharePoolPublicKey } from '@/lib/nesting/gen-owl-rev-share-pool'
import { insertGenOwlRevSharePoolPayout } from '@/lib/db/gen-owl-rev-share-pool-payouts'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { getTransactionCached } from '@/lib/solana-rpc-transaction-cache'
import { getFullAccountKeysForTransaction } from '@/lib/verify-transaction'
import { MAX_SUPPORTED_TRANSACTION_VERSION } from '@/lib/solana/transaction-version'
import { StakingUserError } from '@/lib/nesting/errors'

/**
 * Verify an on-chain pool → wallet SOL transfer and append it to the payout ledger
 * (does not create claim rows — closes coverage holes from orphaned payouts).
 */
export async function recordGenOwlRevSharePoolPayoutFromChain(params: {
  transaction_signature: string
  expected_recipient?: string | null
}): Promise<{
  transaction_signature: string
  recipient_wallet: string
  amount_sol: number
}> {
  const poolWallet = getGenOwlRevSharePoolPublicKey()
  if (!poolWallet) {
    throw new StakingUserError(
      'Rev share pool is not configured. Set GEN_OWL_REV_SHARE_POOL_SECRET_KEY.',
      503
    )
  }

  const sig = params.transaction_signature.trim()
  if (!sig) {
    throw new StakingUserError('Transaction signature is required.', 400)
  }

  const rpcUrl = resolveServerSolanaRpcUrl()
  const connection = new Connection(rpcUrl, 'confirmed')
  const poolPubkey = new PublicKey(poolWallet)

  const transaction = await getTransactionCached(sig, async () => {
    await new Promise((r) => setTimeout(r, 500))
    return connection.getTransaction(sig, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
    })
  })

  if (!transaction) {
    throw new StakingUserError('Transaction not found. It may still be confirming.', 400)
  }
  if (transaction.meta?.err) {
    throw new StakingUserError('Transaction failed on-chain.', 400)
  }
  if (!transaction.meta) {
    throw new StakingUserError('Transaction metadata not available.', 400)
  }

  const accountKeysFull = getFullAccountKeysForTransaction({
    transaction: transaction.transaction,
    meta: transaction.meta,
  })
  const poolIndex = accountKeysFull.findIndex((key: PublicKey) => key.equals(poolPubkey))
  if (poolIndex < 0) {
    throw new StakingUserError('Rev share pool is not in this transaction.', 400)
  }

  const poolDelta =
    (transaction.meta.postBalances[poolIndex] - transaction.meta.preBalances[poolIndex]) /
    LAMPORTS_PER_SOL
  if (poolDelta >= -1e-12) {
    throw new StakingUserError('Pool SOL balance did not decrease in this transaction.', 400)
  }

  // Largest credit among non-pool accounts ≈ the claimer (excludes fee burn).
  let maxCredit = 0
  let creditPk: PublicKey | null = null
  for (let i = 0; i < accountKeysFull.length; i++) {
    if (i === poolIndex) continue
    const delta = transaction.meta.postBalances[i] - transaction.meta.preBalances[i]
    if (delta > maxCredit) {
      maxCredit = delta
      creditPk = accountKeysFull[i] ?? null
    }
  }
  if (!creditPk || maxCredit <= 0) {
    throw new StakingUserError('Could not determine payout recipient from balances.', 400)
  }
  const recipient = creditPk.toBase58()

  if (params.expected_recipient?.trim() && params.expected_recipient.trim() !== recipient) {
    throw new StakingUserError(
      `Recipient mismatch: expected ${params.expected_recipient.trim()}, observed ${recipient}.`,
      400
    )
  }

  const amountSol = maxCredit / LAMPORTS_PER_SOL
  const inserted = await insertGenOwlRevSharePoolPayout({
    transaction_signature: sig,
    recipient_wallet: recipient,
    amount_sol: amountSol,
    amount_usdc: 0,
  })
  if (!inserted) {
    throw new StakingUserError(
      'Could not write payout ledger (apply migration 245_gen_owl_rev_share_pool_payouts).',
      500
    )
  }

  return {
    transaction_signature: sig,
    recipient_wallet: recipient,
    amount_sol: amountSol,
  }
}
