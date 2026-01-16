import { NextRequest, NextResponse } from 'next/server'
import { updateEntryStatus, getEntryById } from '@/lib/db/entries'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import type { Entry, Raffle } from '@/lib/types'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'

// Force dynamic rendering since we use request body
export const dynamic = 'force-dynamic'

/**
 * Server-side payment verification endpoint
 * 
 * This is a placeholder implementation. In production, you would:
 * 1. Verify the transaction signature on Solana RPC
 * 2. Check the transaction amount matches the expected payment
 * 3. Verify the recipient wallet address
 * 4. Check transaction confirmation status
 * 
 * For now, this accepts a transaction signature and marks the entry as confirmed
 * after a brief delay (simulating verification time).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { entryId, transactionSignature } = body

    if (!entryId || !transactionSignature) {
      return NextResponse.json(
        { error: 'Missing entryId or transactionSignature' },
        { status: 400 }
      )
    }

    // Get the entry to check raffle and ticket quantity
    const entry = await getEntryById(entryId)
    if (!entry) {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      )
    }

    // Get the raffle to check max_tickets limit
    const raffle = await getRaffleById(entry.raffle_id)
    if (!raffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    // Check max_tickets limit if set
    if (raffle.max_tickets) {
      const allEntries = await getEntriesByRaffleId(raffle.id)
      const totalConfirmedTickets = allEntries
        .filter(e => e.status === 'confirmed' && e.id !== entryId) // Exclude current entry
        .reduce((sum, e) => sum + e.ticket_quantity, 0)
      
      const wouldExceedLimit = totalConfirmedTickets + entry.ticket_quantity > raffle.max_tickets
      
      if (wouldExceedLimit) {
        // Update entry status to rejected
        await updateEntryStatus(entryId, 'rejected', transactionSignature)
        return NextResponse.json(
          { error: `Cannot confirm entry: would exceed maximum ticket limit of ${raffle.max_tickets}. Only ${raffle.max_tickets - totalConfirmedTickets} tickets remaining.` },
          { status: 400 }
        )
      }
    }

    // Verify the transaction on-chain:
    // 1. Connect to Solana RPC
    // 2. Get transaction details
    // 3. Verify amount, recipient, and confirmation status
    // 4. Only then confirm the entry

    const verificationResult = await verifyTransaction(
      transactionSignature,
      entry,
      raffle
    )

    if (!verificationResult.valid) {
      // Update entry status to rejected
      await updateEntryStatus(entryId, 'rejected', transactionSignature)
      return NextResponse.json(
        { 
          error: 'Transaction verification failed',
          details: verificationResult.error || 'Unknown verification error'
        },
        { status: 400 }
      )
    }

    // Update entry status to confirmed
    const confirmedEntry = await updateEntryStatus(entryId, 'confirmed', transactionSignature)

    if (!confirmedEntry) {
      console.error('Failed to update entry status. Entry ID:', entryId)
      console.error('This is likely due to missing RLS UPDATE policy on entries table.')
      console.error('Please run migration 009_add_entries_update_policy.sql')
      return NextResponse.json(
        { 
          error: 'Failed to update entry. This may be due to database permissions. Please check server logs.',
          details: 'Missing UPDATE policy on entries table. Run migration 009_add_entries_update_policy.sql'
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, entry: confirmedEntry })
  } catch (error) {
    console.error('Error verifying entry:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Verify transaction on Solana blockchain
 * Checks that the transaction actually sent funds to the raffle wallet
 */
async function verifyTransaction(
  transactionSignature: string,
  entry: Entry,
  raffle: Raffle
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Get Solana RPC URL from environment
    // Validate that the RPC URL is a valid HTTP/HTTPS URL
    let rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 
                 process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
                 'https://api.mainnet-beta.solana.com'
    
    // Validate and sanitize RPC URL
    if (rpcUrl && !rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://')) {
      // If it doesn't start with http:// or https://, it might be just a domain
      // Try to construct a valid URL
      if (rpcUrl && !rpcUrl.includes('://')) {
        // Assume HTTPS if no protocol specified
        rpcUrl = `https://${rpcUrl}`
      } else {
        // Invalid format, use fallback
        console.warn(`Invalid RPC URL format: ${rpcUrl}. Using fallback.`)
        rpcUrl = 'https://api.mainnet-beta.solana.com'
      }
    }
    
    // Final validation - ensure it's a valid HTTP/HTTPS URL
    if (!rpcUrl || (!rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://'))) {
      const error = `Invalid RPC URL configuration. Endpoint URL must start with 'http:' or 'https:'. Current value: ${rpcUrl || 'undefined'}`
      console.error(error)
      return { valid: false, error }
    }
    
    const connection = new Connection(rpcUrl, 'confirmed')
    
    // Get recipient wallet from environment
    const recipientWallet = process.env.RAFFLE_RECIPIENT_WALLET || 
                           process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET
    
    if (!recipientWallet) {
      console.error('Recipient wallet not configured for verification')
      // Still allow verification if wallet not configured (for development)
      return { valid: true }
    }
    
    const recipientPubkey = new PublicKey(recipientWallet)
    
    // Wait a moment for transaction to be fully confirmed on RPC
    // Some RPCs need a brief moment after confirmation
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
      const error = `Transaction not found: ${transactionSignature}. It may still be confirming. Please try again in a moment.`
      console.error(error)
      return { valid: false, error }
    }
    
    // Check if transaction was successful
    if (transaction.meta?.err) {
      const error = `Transaction failed on-chain: ${JSON.stringify(transaction.meta.err)}`
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
      // For SOL transfers, check post balances
      // Get account keys - handle both versioned and legacy transactions
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
      
      // Allow small tolerance for fees (amount should be close to expected)
      const tolerance = 0.001 // 0.001 SOL tolerance
      if (Math.abs(balanceIncrease - expectedAmount) > tolerance) {
        const error = `SOL amount mismatch: expected ${expectedAmount}, got ${balanceIncrease} (tolerance: ${tolerance})`
        console.error(error)
        return { valid: false, error }
      }
    } else if (expectedCurrency === 'USDC') {
      // For USDC transfers, check token balance changes
      const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
      
      // Get recipient's associated token address
      const recipientTokenAddress = await getAssociatedTokenAddress(
        USDC_MINT,
        recipientPubkey
      )
      
      // Find token account in pre/post token balances
      const preTokenBalances = transaction.meta.preTokenBalances || []
      const postTokenBalances = transaction.meta.postTokenBalances || []
      
      // Get account keys - handle both versioned and legacy transactions
      const message = transaction.transaction.message
      const accountKeys = 'staticAccountKeys' in message
        ? (message as any).staticAccountKeys
        : (message as any).accountKeys
      
      // Find the token account by matching the account key address
      let preBalance = null
      let postBalance = null
      
      // Check pre token balances
      for (const balance of preTokenBalances) {
        if (balance.accountIndex !== undefined) {
          const accountKey = accountKeys[balance.accountIndex]
          if (accountKey && accountKey.equals(recipientTokenAddress)) {
            preBalance = balance
            break
          }
        }
      }
      
      // Check post token balances
      for (const balance of postTokenBalances) {
        if (balance.accountIndex !== undefined) {
          const accountKey = accountKeys[balance.accountIndex]
          if (accountKey && accountKey.equals(recipientTokenAddress)) {
            postBalance = balance
            break
          }
        }
      }
      
      // Also check if recipient token address appears directly in account keys
      const recipientTokenIndex = accountKeys.findIndex(
        (key: PublicKey) => key.equals(recipientTokenAddress)
      )
      
      // Check if we found the token account in balances
      if (!postBalance) {
        // Try alternative approach: look for any USDC balance changes in the transaction
        // Check if recipient's token account address appears anywhere in the transaction
        const recipientTokenAddressStr = recipientTokenAddress.toString()
        
        // Log all token balances to help debug
        console.log('Looking for recipient token account:', recipientTokenAddressStr)
        console.log('All token balances in transaction:')
        for (const balance of postTokenBalances) {
          const accountKey = balance.accountIndex !== undefined ? accountKeys[balance.accountIndex] : null
          console.log(`  Post balance: accountIndex=${balance.accountIndex}, accountKey=${accountKey?.toString()}, mint=${balance.mint}, amount=${balance.uiTokenAmount?.uiAmountString}`)
        }
        
        // Check if any account key matches the recipient token address
        const matchingAccountIndex = accountKeys.findIndex((key: PublicKey) => key.equals(recipientTokenAddress))
        if (matchingAccountIndex !== -1) {
          // Found the account, check if it's in token balances
          const matchingPostBalance = postTokenBalances.find(b => b.accountIndex === matchingAccountIndex)
          if (matchingPostBalance) {
            const amount = parseFloat(matchingPostBalance.uiTokenAmount?.uiAmountString || '0')
            const matchingPreBalance = preTokenBalances.find(b => b.accountIndex === matchingAccountIndex)
            const preAmount = matchingPreBalance ? parseFloat(matchingPreBalance.uiTokenAmount?.uiAmountString || '0') : 0
            const increase = amount - preAmount
            const tolerance = 0.01
            
            if (Math.abs(increase - expectedAmount) <= tolerance) {
              console.log(`USDC verification passed: expected ${expectedAmount}, got ${increase}`)
              return { valid: true }
            } else {
              const error = `USDC amount mismatch: expected ${expectedAmount}, got ${increase}`
              console.error(error)
              return { valid: false, error }
            }
          }
        }
        
        // Try to get more info about what accounts are in the transaction
        const accountKeysInfo = accountKeys.slice(0, 10).map(
          (key: PublicKey, idx: number) => `${idx}: ${key.toString()}`
        ).join(', ')
        
        const error = `USDC token account not found in transaction balances. Recipient token address: ${recipientTokenAddress.toString()}. Expected amount: ${expectedAmount}. Account keys (first 10): ${accountKeysInfo}`
        console.error(error)
        console.error('Pre token balances:', JSON.stringify(preTokenBalances.slice(0, 5), null, 2))
        console.error('Post token balances:', JSON.stringify(postTokenBalances.slice(0, 5), null, 2))
        return { valid: false, error: `USDC verification failed: Could not verify transfer of ${expectedAmount} USDC to raffle wallet. Transaction may still be processing.` }
      }
      
      // If account didn't exist before, it was created in this transaction
      // Check if it has the expected amount now
      if (!preBalance && postBalance) {
        // Account was created, check post balance
        const amount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0')
        const tolerance = 0.01 // 0.01 USDC tolerance
        if (Math.abs(amount - expectedAmount) > tolerance) {
          const error = `USDC amount mismatch: expected ${expectedAmount}, got ${amount} (tolerance: ${tolerance})`
          console.error(error)
          return { valid: false, error }
        }
      } else if (preBalance && postBalance) {
        // Account existed, check balance increase
        const preAmount = parseFloat(preBalance.uiTokenAmount.uiAmountString || '0')
        const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0')
        const increase = postAmount - preAmount
        const tolerance = 0.01 // 0.01 USDC tolerance
        if (Math.abs(increase - expectedAmount) > tolerance) {
          const error = `USDC amount mismatch: expected ${expectedAmount}, got ${increase} (tolerance: ${tolerance})`
          console.error(error)
          return { valid: false, error }
        }
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
    // In case of verification errors, fail closed (reject transaction)
    // This ensures funds are only confirmed when we can verify they reached the wallet
    return { 
      valid: false, 
      error: `Verification error: ${errorMessage}. This may be a temporary issue. Please try again.` 
    }
  }
}
