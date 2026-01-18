import { NextRequest, NextResponse } from 'next/server'
import { getEntriesByRaffleId, getRaffleById } from '@/lib/db/raffles'
import { updateEntryStatus } from '@/lib/db/entries'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import type { Entry, Raffle } from '@/lib/types'

// Force dynamic rendering to prevent caching stale entry data
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET entries for a specific raffle
 * Query params: raffleId - the ID of the raffle
 * 
 * Automatically verifies pending entries with transaction signatures in the background
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const raffleId = searchParams.get('raffleId')

    if (!raffleId) {
      return NextResponse.json(
        { error: 'Missing required parameter: raffleId' },
        { status: 400 }
      )
    }

    const entries = await getEntriesByRaffleId(raffleId)

    // Automatically verify pending entries with transaction signatures in the background
    // This runs asynchronously so it doesn't block the response
    const pendingWithSignatures = entries.filter(
      e => e.status === 'pending' && e.transaction_signature
    )
    
    if (pendingWithSignatures.length > 0) {
      // Run verification in background (don't await)
      verifyPendingEntries(raffleId, pendingWithSignatures).catch(error => {
        console.error('Error in background verification:', error)
      })
    }

    // Return response with no-cache headers to ensure fresh data
    return NextResponse.json(entries, { 
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    })
  } catch (error) {
    console.error('Error fetching entries:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

/**
 * Verify pending entries in the background
 */
async function verifyPendingEntries(raffleId: string, pendingEntries: Entry[]) {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) return

  for (const entry of pendingEntries) {
    if (!entry.transaction_signature) continue

    try {
      const verificationResult = await verifyTransaction(
        entry.transaction_signature,
        entry,
        raffle
      )

      if (verificationResult.valid) {
        await updateEntryStatus(entry.id, 'confirmed', entry.transaction_signature ?? undefined)
        console.log(`Auto-verified entry ${entry.id} for raffle ${raffleId}`)
      } else {
        // Only reject if it's clearly invalid, otherwise leave as pending for retry
        if (verificationResult.error?.includes('Transaction not found')) {
          // Transaction might still be confirming, don't reject yet
          continue
        }
        await updateEntryStatus(entry.id, 'rejected', entry.transaction_signature ?? undefined)
        console.log(`Auto-rejected entry ${entry.id}: ${verificationResult.error}`)
      }
    } catch (error: any) {
      console.error(`Error auto-verifying entry ${entry.id}:`, error.message)
      // Don't update status on error, let it retry next time
    }
  }
}

/**
 * Verify transaction on Solana blockchain
 * Same logic as in /api/entries/verify
 */
async function verifyTransaction(
  transactionSignature: string,
  entry: Entry,
  raffle: Raffle
): Promise<{ valid: boolean; error?: string }> {
  try {
    let rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 
                 process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
                 'https://api.mainnet-beta.solana.com'
    
    if (rpcUrl && !rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://')) {
      if (rpcUrl && !rpcUrl.includes('://')) {
        rpcUrl = `https://${rpcUrl}`
      } else {
        rpcUrl = 'https://api.mainnet-beta.solana.com'
      }
    }
    
    if (!rpcUrl || (!rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://'))) {
      return { valid: false, error: 'Invalid RPC URL configuration' }
    }
    
    const connection = new Connection(rpcUrl, 'confirmed')
    
    const recipientWallet = process.env.RAFFLE_RECIPIENT_WALLET || 
                           process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET
    
    if (!recipientWallet) {
      return { valid: true } // Allow in development
    }
    
    const recipientPubkey = new PublicKey(recipientWallet)
    
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    let transaction = await connection.getTransaction(transactionSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    })
    
    if (!transaction) {
      transaction = await connection.getTransaction(transactionSignature, {
        commitment: 'confirmed'
      })
    }
    
    if (!transaction) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      transaction = await connection.getTransaction(transactionSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      })
    }
    
    if (!transaction) {
      return { 
        valid: false, 
        error: `Transaction not found: ${transactionSignature}` 
      }
    }
    
    if (transaction.meta?.err) {
      return { 
        valid: false, 
        error: `Transaction failed: ${JSON.stringify(transaction.meta.err)}` 
      }
    }
    
    if (!transaction.meta) {
      return { valid: false, error: 'Transaction metadata not available' }
    }
    
    const expectedAmount = entry.amount_paid
    const expectedCurrency = entry.currency
    
    if (expectedCurrency === 'SOL') {
      const message = transaction.transaction.message
      const accountKeys = 'staticAccountKeys' in message
        ? (message as any).staticAccountKeys
        : (message as any).accountKeys
      
      const recipientIndex = accountKeys.findIndex(
        (key: PublicKey) => key.equals(recipientPubkey)
      )
      
      if (recipientIndex === -1) {
        return { valid: false, error: 'Recipient wallet not found in transaction' }
      }
      
      const preBalance = transaction.meta.preBalances[recipientIndex]
      const postBalance = transaction.meta.postBalances[recipientIndex]
      const balanceIncrease = (postBalance - preBalance) / LAMPORTS_PER_SOL
      
      const tolerance = 0.001
      if (Math.abs(balanceIncrease - expectedAmount) > tolerance) {
        return { 
          valid: false, 
          error: `SOL amount mismatch: expected ${expectedAmount}, got ${balanceIncrease}` 
        }
      }
    } else if (expectedCurrency === 'USDC') {
      const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
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
        if (matchingPostBalance) {
          const amount = parseFloat(matchingPostBalance.uiTokenAmount?.uiAmountString || '0')
          const matchingPreBalance = preTokenBalances.find(b => b.accountIndex === recipientTokenIndex)
          const preAmount = matchingPreBalance ? parseFloat(matchingPreBalance.uiTokenAmount?.uiAmountString || '0') : 0
          const increase = amount - preAmount
          const tolerance = 0.01
          
          if (Math.abs(increase - expectedAmount) <= tolerance) {
            return { valid: true }
          } else {
            return { 
              valid: false, 
              error: `USDC amount mismatch: expected ${expectedAmount}, got ${increase}` 
            }
          }
        }
      }
      
      return { 
        valid: false, 
        error: `USDC verification failed: Could not verify transfer of ${expectedAmount} USDC` 
      }
    } else {
      return { valid: false, error: `Unsupported currency: ${expectedCurrency}` }
    }
    
    return { valid: true }
  } catch (error: any) {
    const errorMessage = error?.message || String(error)
    return { 
      valid: false, 
      error: `Verification error: ${errorMessage}` 
    }
  }
}