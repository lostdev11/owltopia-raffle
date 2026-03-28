import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import type { Entry, Raffle } from '@/lib/types'
import { getTokenInfo } from '@/lib/tokens'
import { getPaymentSplit } from '@/lib/raffles/split-at-purchase'
import { raffleUsesFundsEscrow } from '@/lib/raffles/ticket-escrow-policy'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'

function asPublicKey(k: PublicKey | string): PublicKey {
  return k instanceof PublicKey ? k : new PublicKey(k)
}

/**
 * Full account list for the fetched tx: static keys + v0 address lookup table loads.
 * Matches indices used by `meta.preBalances`, `meta.postBalances`, and `meta.*TokenBalances[].accountIndex`.
 * Using only `staticAccountKeys` breaks verification for Phantom/Solflare v0 txs when ATAs are loaded from ALTs.
 */
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
 * Verify transaction on Solana blockchain
 * Checks that the transaction actually sent funds to the raffle wallet
 *
 * This is a shared utility used by multiple API routes.
 * The optional options argument allows admin flows to relax certain checks.
 */
export async function verifyTransaction(
  transactionSignature: string,
  entry: Entry,
  raffle: Raffle,
  options?: { allowExpired?: boolean }
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
    const treasuryWallet = process.env.RAFFLE_RECIPIENT_WALLET ||
      process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET

    if (!treasuryWallet) {
      console.error('Recipient wallet not configured for verification')
      return { valid: false, error: 'Recipient wallet not configured. Set RAFFLE_RECIPIENT_WALLET.' }
    }

    const useFundsEscrow = raffleUsesFundsEscrow(raffle)
    const fundsEscrowConfigured =
      (raffle.funds_escrow_address_snapshot?.trim() || getFundsEscrowPublicKey()) ?? ''
    if (useFundsEscrow && !fundsEscrowConfigured) {
      return {
        valid: false,
        error:
          'Funds escrow is not configured. Set FUNDS_ESCROW_SECRET_KEY or apply migration 044.',
      }
    }

    const recipientWallet = useFundsEscrow ? fundsEscrowConfigured : treasuryWallet
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

    // Reject transactions older than 1 hour by default.
    // Admin restore flows can opt out via options.allowExpired.
    if (!options?.allowExpired) {
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

    const accountKeysFull = getFullAccountKeysForTransaction({
      transaction: transaction.transaction,
      meta: transaction.meta,
    })
    
    const expectedAmount = entry.amount_paid
    const expectedCurrency = entry.currency
    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const useSplit = !useFundsEscrow && !!creatorWallet && !!treasuryWallet

    // When split at purchase: expect two recipients (creator + treasury). Funds-escrow raffles: full gross to escrow.
    let expectedCreatorAmount: number
    let expectedTreasuryAmount: number
    if (useSplit) {
      const split = await getPaymentSplit(expectedAmount, creatorWallet)
      expectedCreatorAmount = split.toCreator
      expectedTreasuryAmount = split.toTreasury
    } else {
      expectedCreatorAmount = 0
      expectedTreasuryAmount = expectedAmount
    }

    const creatorPubkey = useSplit ? new PublicKey(creatorWallet) : null
    const treasuryPubkey = new PublicKey(recipientWallet)

    // Verify based on currency type
    if (expectedCurrency === 'SOL') {
      const senderPubkey = new PublicKey(entry.wallet_address)
      if (accountKeysFull.findIndex((key: PublicKey) => key.equals(senderPubkey)) === -1) {
        return { valid: false, error: `Sender wallet ${entry.wallet_address} not found in transaction` }
      }

      const tolerance = 0.001
      if (useSplit && creatorPubkey) {
        const creatorIndex = accountKeysFull.findIndex((key: PublicKey) => key.equals(creatorPubkey))
        const treasuryIndex = accountKeysFull.findIndex((key: PublicKey) => key.equals(treasuryPubkey))

        if (creatorIndex !== -1 && treasuryIndex !== -1) {
          const creatorIncrease =
            (transaction.meta.postBalances[creatorIndex] - transaction.meta.preBalances[creatorIndex]) /
            LAMPORTS_PER_SOL
          const treasuryIncrease =
            (transaction.meta.postBalances[treasuryIndex] - transaction.meta.preBalances[treasuryIndex]) /
            LAMPORTS_PER_SOL

          if (
            Math.abs(creatorIncrease - expectedCreatorAmount) <= tolerance &&
            Math.abs(treasuryIncrease - expectedTreasuryAmount) <= tolerance
          ) {
            return { valid: true }
          }

          // If split amounts don't line up exactly, fall through to
          // single-recipient validation below so legacy "send full
          // amount to treasury only" flows can still succeed.
        }
        // If one of the split recipients is missing, also fall through
        // to the single-recipient SOL check instead of hard failing.
      }

      const recipientIndex = accountKeysFull.findIndex((key: PublicKey) => key.equals(treasuryPubkey))
      if (recipientIndex === -1) {
        return { valid: false, error: `Recipient wallet ${recipientWallet} not found in transaction` }
      }
      const balanceIncrease = (transaction.meta.postBalances[recipientIndex] - transaction.meta.preBalances[recipientIndex]) / LAMPORTS_PER_SOL
      // In some flows, an additional small protocol/platform fee may be included
      // in the same transfer, so the treasury can receive slightly MORE than
      // the entry.amount_paid stored in the DB. Treat expectedAmount as a
      // minimum and allow a small positive delta.
      const maxExtraFee = 0.01 // up to 0.01 SOL extra is allowed
      if (
        balanceIncrease + tolerance < expectedAmount || // sent too little
        balanceIncrease - expectedAmount > maxExtraFee + tolerance // sent way too much (suspicious)
      ) {
        return {
          valid: false,
          error: `SOL amount mismatch: expected ${expectedAmount}, got ${balanceIncrease}. Raffle: ${raffle.slug} (${raffle.title}), Entry ID: ${entry.id}`,
        }
      }
      return { valid: true }
    } else if (expectedCurrency === 'USDC') {
      const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
      const decimals = getTokenInfo('USDC').decimals
      const preTokenBalances = transaction.meta.preTokenBalances || []
      const postTokenBalances = transaction.meta.postTokenBalances || []

      const getUsdcIncrease = (ownerPubkey: PublicKey) => {
        return getAssociatedTokenAddress(USDC_MINT, ownerPubkey).then(ata => {
          const idx = accountKeysFull.findIndex((key: PublicKey) => key.equals(ata))
          if (idx === -1) return null
          const post = postTokenBalances.find(b => b.accountIndex === idx)?.uiTokenAmount?.amount
          const pre = preTokenBalances.find(b => b.accountIndex === idx)?.uiTokenAmount?.amount
          if (post == null) return null
          return BigInt(post) - (pre != null ? BigInt(pre) : BigInt(0))
        })
      }

      if (useSplit && creatorPubkey) {
        const creatorIncrease = await getUsdcIncrease(creatorPubkey)
        const treasuryIncrease = await getUsdcIncrease(treasuryPubkey)
        const expectedCreatorRaw = BigInt(Math.round(expectedCreatorAmount * Math.pow(10, decimals)))
        const expectedTreasuryRaw = BigInt(Math.round(expectedTreasuryAmount * Math.pow(10, decimals)))
        const expectedTotalRaw = BigInt(Math.round(Number(expectedAmount) * Math.pow(10, decimals)))
        const toleranceRaw = BigInt(1)
        const sumToleranceRaw = BigInt(3)
        if (creatorIncrease != null && treasuryIncrease != null &&
            creatorIncrease >= expectedCreatorRaw - toleranceRaw && creatorIncrease <= expectedCreatorRaw + toleranceRaw &&
            treasuryIncrease >= expectedTreasuryRaw - toleranceRaw && treasuryIncrease <= expectedTreasuryRaw + toleranceRaw) {
          return { valid: true }
        }
        // Gross paid matches creator + treasury (rounding across two transfers)
        if (creatorIncrease != null && treasuryIncrease != null) {
          const sum = creatorIncrease + treasuryIncrease
          if (sum >= expectedTotalRaw - sumToleranceRaw && sum <= expectedTotalRaw + sumToleranceRaw) {
            return { valid: true }
          }
        }
        // Same as SOL: fall through so legacy "full USDC to treasury only" still verifies
      }

      const recipientTokenAddress = await getAssociatedTokenAddress(USDC_MINT, treasuryPubkey)
      const recipientTokenIndex = accountKeysFull.findIndex((key: PublicKey) => key.equals(recipientTokenAddress))
      if (recipientTokenIndex !== -1) {
        const matchingPostBalance = postTokenBalances.find(b => b.accountIndex === recipientTokenIndex)
        const rawPostUsdc = matchingPostBalance?.uiTokenAmount?.amount
        if (rawPostUsdc != null) {
          const postRaw = BigInt(rawPostUsdc)
          const matchingPreBalance = preTokenBalances.find(b => b.accountIndex === recipientTokenIndex)
          const preRaw = matchingPreBalance?.uiTokenAmount?.amount != null ? BigInt(matchingPreBalance.uiTokenAmount.amount) : BigInt(0)
          const increaseRaw = postRaw - preRaw
          const expectedRaw = BigInt(Math.round(Number(expectedAmount) * Math.pow(10, decimals)))
          const toleranceRaw = BigInt(1)
          if (increaseRaw >= expectedRaw - toleranceRaw && increaseRaw <= expectedRaw + toleranceRaw) return { valid: true }
          return { valid: false, error: `USDC amount mismatch: expected ${expectedAmount}, got ${increaseRaw.toString()} raw. Raffle: ${raffle.slug} (${raffle.title}), Entry ID: ${entry.id}` }
        }
      }
      return { valid: false, error: `USDC verification failed: Could not verify transfer of ${expectedAmount} USDC. Raffle: ${raffle.slug} (${raffle.title}), Entry ID: ${entry.id}` }
    } else if (expectedCurrency === 'OWL') {
      const tokenInfo = getTokenInfo('OWL')
      if (!tokenInfo.mintAddress) {
        return { valid: false, error: 'OWL mint address not configured' }
      }
      const decimals = tokenInfo.decimals
      const OWL_MINT = new PublicKey(tokenInfo.mintAddress)
      const preTokenBalances = transaction.meta.preTokenBalances || []
      const postTokenBalances = transaction.meta.postTokenBalances || []

      const getOwlIncrease = (ownerPubkey: PublicKey) => {
        return getAssociatedTokenAddress(OWL_MINT, ownerPubkey).then(ata => {
          const idx = accountKeysFull.findIndex((key: PublicKey) => key.equals(ata))
          if (idx === -1) return null
          const post = postTokenBalances.find(b => b.accountIndex === idx)?.uiTokenAmount?.amount
          const pre = preTokenBalances.find(b => b.accountIndex === idx)?.uiTokenAmount?.amount
          if (post == null) return null
          return BigInt(post) - (pre != null ? BigInt(pre) : BigInt(0))
        })
      }

      if (useSplit && creatorPubkey) {
        const creatorIncrease = await getOwlIncrease(creatorPubkey)
        const treasuryIncrease = await getOwlIncrease(treasuryPubkey)
        const expectedCreatorRaw = BigInt(Math.round(expectedCreatorAmount * Math.pow(10, decimals)))
        const expectedTreasuryRaw = BigInt(Math.round(expectedTreasuryAmount * Math.pow(10, decimals)))
        const expectedTotalRaw = BigInt(Math.round(Number(expectedAmount) * Math.pow(10, decimals)))
        const toleranceRaw = BigInt(1)
        const sumToleranceRaw = BigInt(3)
        if (creatorIncrease != null && treasuryIncrease != null &&
            creatorIncrease >= expectedCreatorRaw - toleranceRaw && creatorIncrease <= expectedCreatorRaw + toleranceRaw &&
            treasuryIncrease >= expectedTreasuryRaw - toleranceRaw && treasuryIncrease <= expectedTreasuryRaw + toleranceRaw) {
          return { valid: true }
        }
        if (creatorIncrease != null && treasuryIncrease != null) {
          const sum = creatorIncrease + treasuryIncrease
          if (sum >= expectedTotalRaw - sumToleranceRaw && sum <= expectedTotalRaw + sumToleranceRaw) {
            return { valid: true }
          }
        }
      }

      const recipientTokenAddress = await getAssociatedTokenAddress(OWL_MINT, treasuryPubkey)
      const recipientTokenIndex = accountKeysFull.findIndex((key: PublicKey) => key.equals(recipientTokenAddress))
      if (recipientTokenIndex !== -1) {
        const matchingPostBalance = postTokenBalances.find(b => b.accountIndex === recipientTokenIndex)
        const rawPostOwl = matchingPostBalance?.uiTokenAmount?.amount
        if (rawPostOwl != null) {
          const postRaw = BigInt(rawPostOwl)
          const matchingPreBalance = preTokenBalances.find(b => b.accountIndex === recipientTokenIndex)
          const preRaw = matchingPreBalance?.uiTokenAmount?.amount != null ? BigInt(matchingPreBalance.uiTokenAmount.amount) : BigInt(0)
          const increaseRaw = postRaw - preRaw
          const expectedRaw = BigInt(Math.round(Number(expectedAmount) * Math.pow(10, decimals)))
          const toleranceRaw = BigInt(1)
          if (increaseRaw >= expectedRaw - toleranceRaw && increaseRaw <= expectedRaw + toleranceRaw) return { valid: true }
          return { valid: false, error: `OWL amount mismatch: expected ${expectedAmount}, got ${increaseRaw.toString()} raw. Raffle: ${raffle.slug} (${raffle.title}), Entry ID: ${entry.id}` }
        }
      }
      return { valid: false, error: `OWL verification failed: Could not verify transfer of ${expectedAmount} OWL. Raffle: ${raffle.slug} (${raffle.title}), Entry ID: ${entry.id}` }
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
