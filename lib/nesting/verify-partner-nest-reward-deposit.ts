import { Connection, PublicKey } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { getTransactionCached } from '@/lib/solana-rpc-transaction-cache'
import { getFullAccountKeysForTransaction } from '@/lib/verify-transaction'

async function tokenProgramForMint(
  connection: Connection,
  mint: PublicKey
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID | null> {
  const info = await connection.getAccountInfo(mint, 'confirmed')
  if (!info) return null
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID
  return null
}

/**
 * Verify partner SPL deposit into the Nesting reward vault ATA for `rewardMint`.
 */
export async function verifyPartnerNestRewardDepositTx(params: {
  transactionSignature: string
  depositorWallet: string
  vaultWallet: string
  rewardMint: string
  expectedAmountUi: number
  decimals: number
  allowOlderThanHour?: boolean
}): Promise<{ valid: boolean; error?: string; amountUi?: number }> {
  const {
    transactionSignature,
    depositorWallet,
    vaultWallet,
    rewardMint,
    expectedAmountUi,
    decimals,
  } = params

  try {
    if (!Number.isFinite(expectedAmountUi) || expectedAmountUi <= 0) {
      return { valid: false, error: 'Expected deposit amount must be positive.' }
    }
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      return { valid: false, error: 'Invalid reward token decimals.' }
    }

    const rpcUrl = resolveServerSolanaRpcUrl()
    const connection = new Connection(rpcUrl, 'confirmed')
    const vaultPubkey = new PublicKey(vaultWallet.trim())
    const depositorPubkey = new PublicKey(depositorWallet.trim())
    const mint = new PublicKey(rewardMint.trim())

    const transaction = await getTransactionCached(transactionSignature, async () => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      let tx = await connection.getTransaction(transactionSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })
      if (!tx) {
        tx = await connection.getTransaction(transactionSignature, { commitment: 'confirmed' })
      }
      if (!tx) {
        await new Promise((resolve) => setTimeout(resolve, 800))
        tx = await connection.getTransaction(transactionSignature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        })
      }
      return tx
    })

    if (!transaction) {
      return { valid: false, error: 'Transaction not found. It may still be confirming — try again shortly.' }
    }

    if (!params.allowOlderThanHour) {
      const blockTime = (transaction as { blockTime?: number | null }).blockTime
      if (typeof blockTime === 'number') {
        const ageSeconds = Date.now() / 1000 - blockTime
        if (ageSeconds > 3600) {
          return {
            valid: false,
            error: 'Transaction is older than 1 hour and cannot be used for reward deposit verification.',
          }
        }
      }
    }

    if (transaction.meta?.err) {
      return { valid: false, error: 'Transaction failed on-chain.' }
    }
    if (!transaction.meta) {
      return { valid: false, error: 'Transaction metadata not available.' }
    }

    const message = transaction.transaction.message
    const accountKeys =
      'staticAccountKeys' in message
        ? (message as { staticAccountKeys?: unknown }).staticAccountKeys
        : (message as { accountKeys?: unknown }).accountKeys
    const feePayerKey = Array.isArray(accountKeys) ? accountKeys[0] : null
    const feePayerMatches =
      feePayerKey != null &&
      (typeof feePayerKey === 'string'
        ? feePayerKey === depositorWallet
        : (feePayerKey as PublicKey).equals(depositorPubkey))
    if (!feePayerMatches) {
      return { valid: false, error: 'Transaction must be signed by the connected partner wallet.' }
    }

    const programId = await tokenProgramForMint(connection, mint)
    if (!programId) {
      return { valid: false, error: 'Reward mint is missing on-chain or is not SPL Token / Token-2022.' }
    }

    const vaultAta = await getAssociatedTokenAddress(
      mint,
      vaultPubkey,
      false,
      programId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )

    const accountKeysFull = getFullAccountKeysForTransaction({
      transaction: transaction.transaction,
      meta: transaction.meta,
    })
    const recipientTokenIndex = accountKeysFull.findIndex((key: PublicKey) => key.equals(vaultAta))
    if (recipientTokenIndex === -1) {
      return { valid: false, error: 'Reward vault token account not found in transaction.' }
    }

    const preTokenBalances = transaction.meta.preTokenBalances || []
    const postTokenBalances = transaction.meta.postTokenBalances || []
    const matchingPost = postTokenBalances.find((b) => b.accountIndex === recipientTokenIndex)
    const postRaw = matchingPost?.uiTokenAmount?.amount
    if (postRaw == null) {
      return { valid: false, error: 'Could not read vault token balance change.' }
    }
    if (matchingPost?.mint && matchingPost.mint !== mint.toBase58()) {
      return { valid: false, error: 'Deposit mint does not match this nest’s reward mint.' }
    }

    const matchingPre = preTokenBalances.find((b) => b.accountIndex === recipientTokenIndex)
    const preRaw =
      matchingPre?.uiTokenAmount?.amount != null ? BigInt(matchingPre.uiTokenAmount.amount) : 0n
    const increaseRaw = BigInt(postRaw) - preRaw
    const expectedRaw = BigInt(Math.round(expectedAmountUi * Math.pow(10, decimals)))
    const toleranceRaw = BigInt(2)
    if (increaseRaw < expectedRaw - toleranceRaw || increaseRaw > expectedRaw + toleranceRaw) {
      const observedUi = Number(increaseRaw) / Math.pow(10, decimals)
      return {
        valid: false,
        error: `Amount mismatch: expected ${expectedAmountUi}, observed ~${observedUi}.`,
      }
    }

    const amountUi = Number(increaseRaw) / Math.pow(10, decimals)
    return { valid: true, amountUi }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { valid: false, error: `Verification error: ${msg}` }
  }
}
