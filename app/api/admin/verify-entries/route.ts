import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/db/admins'
import { getEntriesByRaffleId, getRaffleById } from '@/lib/db/raffles'
import { updateEntryStatus, getEntryById } from '@/lib/db/entries'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import type { Entry, Raffle } from '@/lib/types'

// Force dynamic rendering since we use request body
export const dynamic = 'force-dynamic'

/**
 * Admin endpoint to batch verify pending entries for a raffle
 * Checks transaction signatures and verifies payments on-chain
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { raffleId, adminWallet } = body

    if (!raffleId || !adminWallet) {
      return NextResponse.json(
        { error: 'Missing required fields: raffleId and adminWallet' },
        { status: 400 }
      )
    }

    // Check admin status
    const adminStatus = await isAdmin(adminWallet)
    if (!adminStatus) {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      )
    }

    // Get raffle
    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    // Get all entries for the raffle
    const allEntries = await getEntriesByRaffleId(raffleId)
    
    // Filter to pending entries that have transaction signatures
    const pendingEntries = allEntries.filter(
      e => e.status === 'pending' && e.transaction_signature
    )

    if (pendingEntries.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending entries with transaction signatures found',
        verified: 0,
        rejected: 0,
        skipped: 0
      })
    }

    // Verify each pending entry
    const results = {
      verified: 0,
      rejected: 0,
      errors: [] as string[]
    }

    for (const entry of pendingEntries) {
      try {
        const verificationResult = await verifyTransaction(
          entry.transaction_signature!,
          entry,
          raffle
        )

        if (verificationResult.valid) {
          await updateEntryStatus(entry.id, 'confirmed', entry.transaction_signature ?? undefined)
          results.verified++
        } else {
          await updateEntryStatus(entry.id, 'rejected', entry.transaction_signature ?? undefined)
          results.rejected++
          results.errors.push(
            `Entry ${entry.id}: ${verificationResult.error || 'Verification failed'}`
          )
        }
      } catch (error: any) {
        results.rejected++
        results.errors.push(`Entry ${entry.id}: ${error.message || 'Verification error'}`)
        console.error(`Error verifying entry ${entry.id}:`, error)
      }
    }

    return NextResponse.json({
      success: true,
      message: `Verified ${results.verified} entries, rejected ${results.rejected}`,
      verified: results.verified,
      rejected: results.rejected,
      errors: results.errors
    })
  } catch (error) {
    console.error('Error in batch verify entries:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
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
    
    const recipientWallet = process.env.RAFFLE_RECIPIENT_WALLET || 
                           process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET
    
    if (!recipientWallet) {
      console.error('Recipient wallet not configured for verification')
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
        error: `Transaction not found: ${transactionSignature}. It may still be confirming.` 
      }
    }
    
    if (transaction.meta?.err) {
      return { 
        valid: false, 
        error: `Transaction failed on-chain: ${JSON.stringify(transaction.meta.err)}` 
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
      
      const senderPubkey = new PublicKey(entry.wallet_address)
      const senderIndex = accountKeys.findIndex(
        (key: PublicKey) => key.equals(senderPubkey)
      )
      const recipientIndex = accountKeys.findIndex(
        (key: PublicKey) => key.equals(recipientPubkey)
      )
      
      if (senderIndex === -1 || recipientIndex === -1) {
        return { 
          valid: false, 
          error: `Sender or recipient wallet not found in transaction` 
        }
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
    console.error('Error verifying transaction:', error)
    return { 
      valid: false, 
      error: `Verification error: ${errorMessage}` 
    }
  }
}
