import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { getTokenInfo } from '@/lib/tokens'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { getTransactionCached } from '@/lib/solana-rpc-transaction-cache'

function asPublicKey(k: PublicKey | string): PublicKey {
  return k instanceof PublicKey ? k : new PublicKey(k)
}

function getFullAccountKeysForTransaction(tx: {
  transaction: { message: unknown }
  meta: NonNullable<NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>['meta']>
}): PublicKey[] {
  const message = tx.transaction.message as {
    staticAccountKeys?: (PublicKey | string)[]
    accountKeys?: (PublicKey | string)[]
  }
  if (message.staticAccountKeys?.length) {
    const keys = message.staticAccountKeys.map(asPublicKey)
    const loaded = tx.meta.loadedAddresses
    if (loaded?.writable?.length) {
      keys.push(...loaded.writable.map(asPublicKey))
    }
    if (loaded?.readonly?.length) {
      keys.push(...loaded.readonly.map(asPublicKey))
    }
    return keys
  }
  const legacy = message.accountKeys
  return legacy?.length ? legacy.map(asPublicKey) : []
}

/**
 * Verify that `transactionSignature` sends at least `expectedAmount` of SOL/USDC to the bidder (buyout refund).
 */
export async function verifyBuyoutRefundTx(params: {
  transactionSignature: string
  bidderWallet: string
  expectedAmount: number
  currency: 'SOL' | 'USDC'
}): Promise<{ valid: boolean; error?: string }> {
  const { transactionSignature, bidderWallet, expectedAmount, currency } = params
  try {
    const rpcUrl = resolveServerSolanaRpcUrl()
    const connection = new Connection(rpcUrl, 'confirmed')
    const bidderPubkey = new PublicKey(bidderWallet.trim())

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

    if (transaction.meta?.err) {
      return { valid: false, error: 'Transaction failed on-chain.' }
    }
    if (!transaction.meta) {
      return { valid: false, error: 'Transaction metadata not available.' }
    }

    const accountKeysFull = getFullAccountKeysForTransaction({
      transaction: transaction.transaction,
      meta: transaction.meta,
    })

    const tolerance = 0.001

    if (currency === 'SOL') {
      const recipientIndex = accountKeysFull.findIndex((key: PublicKey) => key.equals(bidderPubkey))
      if (recipientIndex === -1) {
        return { valid: false, error: `Bidder wallet ${bidderWallet} not found in transaction.` }
      }
      const balanceIncrease =
        (transaction.meta.postBalances[recipientIndex] - transaction.meta.preBalances[recipientIndex]) /
        LAMPORTS_PER_SOL
      if (balanceIncrease + tolerance < expectedAmount) {
        return {
          valid: false,
          error: `SOL amount mismatch: expected at least ${expectedAmount} SOL to bidder, observed ~${balanceIncrease.toFixed(6)} SOL.`,
        }
      }
      return { valid: true }
    }

    if (currency === 'USDC') {
      const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
      const decimals = getTokenInfo('USDC').decimals
      const preTokenBalances = transaction.meta.preTokenBalances || []
      const postTokenBalances = transaction.meta.postTokenBalances || []

      const recipientTokenAddress = await getAssociatedTokenAddress(USDC_MINT, bidderPubkey)
      const recipientTokenIndex = accountKeysFull.findIndex((key: PublicKey) =>
        key.equals(recipientTokenAddress),
      )
      if (recipientTokenIndex === -1) {
        return { valid: false, error: 'Bidder USDC token account not found in transaction.' }
      }
      const matchingPostBalance = postTokenBalances.find((b) => b.accountIndex === recipientTokenIndex)
      const rawPostUsdc = matchingPostBalance?.uiTokenAmount?.amount
      if (rawPostUsdc == null) {
        return { valid: false, error: 'Could not read bidder USDC balance change.' }
      }
      const matchingPreBalance = preTokenBalances.find((b) => b.accountIndex === recipientTokenIndex)
      const preRaw =
        matchingPreBalance?.uiTokenAmount?.amount != null ? BigInt(matchingPreBalance.uiTokenAmount.amount) : BigInt(0)
      const increaseRaw = BigInt(rawPostUsdc) - preRaw
      const expectedRaw = BigInt(Math.round(Number(expectedAmount) * Math.pow(10, decimals)))
      const toleranceRaw = BigInt(2)
      if (increaseRaw < expectedRaw - toleranceRaw) {
        return {
          valid: false,
          error: `USDC amount mismatch: expected at least ${expectedAmount} USDC to bidder.`,
        }
      }
      return { valid: true }
    }

    return { valid: false, error: 'Unsupported currency for buyout refund.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { valid: false, error: `Verification error: ${msg}` }
  }
}
