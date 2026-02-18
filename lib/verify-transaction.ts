import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import type { Entry, Raffle } from '@/lib/types'
import { getTokenInfo } from '@/lib/tokens'

/**
 * Verify transaction on Solana blockchain
 * Checks that the transaction actually sent funds to the raffle wallet
 * 
 * This is a shared utility used by multiple API routes
 */
export async function verifyTransaction(
  transactionSignature: string,
  entry: Entry,
  raffle: Raffle
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Get Solana RPC URL from environment
    let rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 
                 process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
                 'https://api.mainnet-beta.solana.com'
    
    // Validate and sanitize RPC URL
    if (rpcUrl && !rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://')) {
      if (rpcUrl && !rpcUrl.includes('://')) {
        rpcUrl = `https://${rpcUrl}`
      } else {
        console.warn(`Invalid RPC URL format: ${rpcUrl}. Using fallback.`)
        rpcUrl = 'https://api.mainnet-beta.solana.com'
      }
    }
    
    if (!rpcUrl || (!rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://'))) {
      const error = `Invalid RPC URL configuration. Endpoint URL must start with 'http:' or 'https:'. Current value: ${rpcUrl || 'undefined'}`
      console.error(error)
      return { valid: false, error }
    }
    
    const connection = new Connection(rpcUrl, 'confirmed')
    
    // Treasury/recipient wallet (same for SOL, USDC, OWL). Verification ensures
    // funds were sent to this wallet (native SOL) or its token accounts (USDC/OWL).
    const recipientWallet = process.env.RAFFLE_RECIPIENT_WALLET || 
                           process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET
    
    if (!recipientWallet) {
      console.error('Recipient wallet not configured for verification')
      return { valid: false, error: 'Recipient wallet not configured. Set RAFFLE_RECIPIENT_WALLET.' }
    }
    
    const recipientPubkey = new PublicKey(recipientWallet)
    
    // Wait a moment for transaction to be fully confirmed on RPC
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Get transaction details - try with versioned transactions first
    let transaction = await connection.getTransaction(transactionSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    })
    
    // If not found, try without versioned transaction support (legacy transaction)
    if (!transaction) {
      transaction = await connection.getTransaction(transactionSignature, {
        commitment: 'confirmed'
      })
    }
    
    // Retry once more if still not found (RPC might be slow)
    if (!transaction) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      transaction = await connection.getTransaction(transactionSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      })
    }
    
    if (!transaction) {
      const error = `Transaction not found: ${transactionSignature}. It may still be confirming. Please try again in a moment. Raffle: ${raffle.slug} (${raffle.title})`
      console.error(error)
      return { valid: false, error }
    }

    // Reject transactions older than 1 hour
    const txWithBlockTime = transaction as { blockTime?: number | null }
    if (typeof txWithBlockTime.blockTime === 'number') {
      const ageSeconds = Date.now() / 1000 - txWithBlockTime.blockTime
      const maxAgeSeconds = 3600 // 1 hour
      if (ageSeconds > maxAgeSeconds) {
        const error = `Transaction expired. Transactions older than 1 hour cannot be used for verification. This transaction is ${Math.round(ageSeconds / 60)} minutes old.`
        console.error(error)
        return { valid: false, error }
      }
    }

    // Ensure the transaction was signed by the entry's wallet (fee payer = first account)
    const message = transaction.transaction.message
    const accountKeys = 'staticAccountKeys' in message
      ? (message as any).staticAccountKeys
      : (message as any).accountKeys
    const feePayerKey = accountKeys?.[0]
    const expectedWalletPubkey = new PublicKey(entry.wallet_address)
    const feePayerMatches =
      feePayerKey != null &&
      (typeof feePayerKey === 'string'
        ? feePayerKey === entry.wallet_address
        : (feePayerKey as PublicKey).equals(expectedWalletPubkey))
    if (!feePayerMatches) {
      const error = `Transaction wallet mismatch: this transaction was not signed by the entry wallet (${entry.wallet_address}). Verification denied.`
      console.error(error)
      return { valid: false, error }
    }
    
    // Check if transaction was successful
    if (transaction.meta?.err) {
      const error = `Transaction failed on-chain: ${JSON.stringify(transaction.meta.err)}. Raffle: ${raffle.slug} (${raffle.title})`
      console.error(error)
      return { valid: false, error }
    }
    
    // Verify transaction was confirmed
    if (!transaction.meta) {
      const error = 'Transaction metadata not available'
      console.error(error)
      return { valid: false, error }
    }
    
    const expectedAmount = entry.amount_paid
    const expectedCurrency = entry.currency
    
    // Verify based on currency type
    if (expectedCurrency === 'SOL') {
      const message = transaction.transaction.message
      const accountKeys = 'staticAccountKeys' in message
        ? (message as any).staticAccountKeys
        : (message as any).accountKeys
      
      const senderPubkey = new PublicKey(entry.wallet_address)
      const senderIndex = accountKeys.findIndex(
        (key: PublicKey) => key.equals(senderPubkey)
      )
      const recipientIndex = accountKeys.findIndex(
        (key: PublicKey) => key.equals(recipientPubkey)
      )
      
      if (senderIndex === -1) {
        const error = `Sender wallet ${entry.wallet_address} not found in transaction`
        console.error(error)
        return { valid: false, error }
      }
      
      if (recipientIndex === -1) {
        const error = `Recipient wallet ${recipientWallet} not found in transaction`
        console.error(error)
        return { valid: false, error }
      }
      
      const preBalance = transaction.meta.preBalances[recipientIndex]
      const postBalance = transaction.meta.postBalances[recipientIndex]
      const balanceIncrease = (postBalance - preBalance) / LAMPORTS_PER_SOL
      
      const tolerance = 0.001 // 0.001 SOL tolerance
      if (Math.abs(balanceIncrease - expectedAmount) > tolerance) {
        const error = `SOL amount mismatch: expected ${expectedAmount}, got ${balanceIncrease} (tolerance: ${tolerance}). Raffle: ${raffle.slug} (${raffle.title}), Entry ID: ${entry.id}`
        console.error(error)
        return { valid: false, error }
      }
    } else if (expectedCurrency === 'USDC') {
      const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
      const decimals = getTokenInfo('USDC').decimals

      const recipientTokenAddress = await getAssociatedTokenAddress(
        USDC_MINT,
        recipientPubkey
      )
      
      const preTokenBalances = transaction.meta.preTokenBalances || []
      const postTokenBalances = transaction.meta.postTokenBalances || []
      
      const message = transaction.transaction.message
      const accountKeys = 'staticAccountKeys' in message
        ? (message as any).staticAccountKeys
        : (message as any).accountKeys
      
      const recipientTokenIndex = accountKeys.findIndex(
        (key: PublicKey) => key.equals(recipientTokenAddress)
      )
      
      if (recipientTokenIndex !== -1) {
        const matchingPostBalance = postTokenBalances.find(b => b.accountIndex === recipientTokenIndex)
        const rawPostUsdc = matchingPostBalance?.uiTokenAmount?.amount
        if (rawPostUsdc != null) {
          const postRaw = BigInt(rawPostUsdc)
          const matchingPreBalance = preTokenBalances.find(b => b.accountIndex === recipientTokenIndex)
          const preRaw = matchingPreBalance?.uiTokenAmount?.amount != null
            ? BigInt(matchingPreBalance.uiTokenAmount.amount)
            : BigInt(0)
          const increaseRaw = postRaw - preRaw
          const expectedRaw = BigInt(Math.round(Number(expectedAmount) * Math.pow(10, decimals)))
          const toleranceRaw = BigInt(1)
          if (increaseRaw >= expectedRaw - toleranceRaw && increaseRaw <= expectedRaw + toleranceRaw) {
            return { valid: true }
          }
          const error = `USDC amount mismatch: expected ${expectedAmount}, got ${increaseRaw.toString()} raw. Raffle: ${raffle.slug} (${raffle.title}), Entry ID: ${entry.id}`
          console.error(error)
          return { valid: false, error }
        }
      }
      
      return { 
        valid: false, 
        error: `USDC verification failed: Could not verify transfer of ${expectedAmount} USDC to raffle wallet. Transaction may still be processing. Raffle: ${raffle.slug} (${raffle.title}), Entry ID: ${entry.id}` 
      }
    } else if (expectedCurrency === 'OWL') {
      const tokenInfo = getTokenInfo('OWL')
      if (!tokenInfo.mintAddress) {
        const error = 'OWL mint address not configured'
        console.error(error)
        return { valid: false, error }
      }
      const decimals = tokenInfo.decimals
      const OWL_MINT = new PublicKey(tokenInfo.mintAddress)
      
      const recipientTokenAddress = await getAssociatedTokenAddress(
        OWL_MINT,
        recipientPubkey
      )
      
      const preTokenBalances = transaction.meta.preTokenBalances || []
      const postTokenBalances = transaction.meta.postTokenBalances || []
      
      const message = transaction.transaction.message
      const accountKeys = 'staticAccountKeys' in message
        ? (message as any).staticAccountKeys
        : (message as any).accountKeys
      
      const recipientTokenIndex = accountKeys.findIndex(
        (key: PublicKey) => key.equals(recipientTokenAddress)
      )
      
      if (recipientTokenIndex !== -1) {
        const matchingPostBalance = postTokenBalances.find(b => b.accountIndex === recipientTokenIndex)
        const rawPostOwl = matchingPostBalance?.uiTokenAmount?.amount
        if (rawPostOwl != null) {
          const postRaw = BigInt(rawPostOwl)
          const matchingPreBalance = preTokenBalances.find(b => b.accountIndex === recipientTokenIndex)
          const preRaw = matchingPreBalance?.uiTokenAmount?.amount != null
            ? BigInt(matchingPreBalance.uiTokenAmount.amount)
            : BigInt(0)
          const increaseRaw = postRaw - preRaw
          const expectedRaw = BigInt(Math.round(Number(expectedAmount) * Math.pow(10, decimals)))
          const toleranceRaw = BigInt(1)
          if (increaseRaw >= expectedRaw - toleranceRaw && increaseRaw <= expectedRaw + toleranceRaw) {
            return { valid: true }
          }
          const error = `OWL amount mismatch: expected ${expectedAmount}, got ${increaseRaw.toString()} raw. Raffle: ${raffle.slug} (${raffle.title}), Entry ID: ${entry.id}`
          console.error(error)
          return { valid: false, error }
        }
      }
      
      return { 
        valid: false, 
        error: `OWL verification failed: Could not verify transfer of ${expectedAmount} OWL to raffle wallet. Transaction may still be processing. Raffle: ${raffle.slug} (${raffle.title}), Entry ID: ${entry.id}` 
      }
    } else {
      const error = `Unsupported currency: ${expectedCurrency}`
      console.error(error)
      return { valid: false, error }
    }
    
    console.log(
      `Transaction verified: ${expectedAmount} ${expectedCurrency} sent to raffle wallet`
    )
    return { valid: true }
  } catch (error: any) {
    const errorMessage = error?.message || String(error)
    console.error('Error verifying transaction:', error)
    return { 
      valid: false, 
      error: `Verification error: ${errorMessage}. This may be a temporary issue. Please try again.` 
    }
  }
}
