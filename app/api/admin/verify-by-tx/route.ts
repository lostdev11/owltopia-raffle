import { NextRequest, NextResponse } from 'next/server'
import { getEntryByTransactionSignature, updateEntryStatus, saveTransactionSignature, getEntryById, createEntry, markEntryAsRestored } from '@/lib/db/entries'
import { getRaffleById, getEntriesByRaffleId, getRaffles, getRaffleBySlug } from '@/lib/db/raffles'
import type { Entry, Raffle } from '@/lib/types'
import { verifyTransaction } from '@/lib/verify-transaction'
import { isAdmin } from '@/lib/db/admins'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

/**
 * Verify and update an entry by transaction signature
 * This is useful for manually fixing stuck entries
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { transactionSignature } = body

    if (!transactionSignature) {
      return NextResponse.json(
        { error: 'Missing required field: transactionSignature' },
        { status: 400 }
      )
    }

    // Optional: Check if user is admin (for security)
    const authHeader = request.headers.get('authorization')
    let adminWallet: string | undefined
    if (authHeader) {
      try {
        const walletFromHeader = authHeader.replace('Bearer ', '')
        const isUserAdmin = await isAdmin(walletFromHeader)
        if (!isUserAdmin) {
          return NextResponse.json(
            { error: 'Unauthorized: Admin access required' },
            { status: 403 }
          )
        }
        adminWallet = walletFromHeader
      } catch (e) {
        // If auth check fails, continue anyway (for flexibility)
      }
    }

    // Find entry by transaction signature
    let entry = await getEntryByTransactionSignature(transactionSignature)
    let raffle = null
    let wasRestored = false // Track if this entry was restored (not found by signature initially)
    let hadNoTransactionSignature = false // Track if entry didn't have transaction signature before

    // If not found by signature, try to restore it by:
    // 1. Fetching transaction details from Solana
    // 2. Finding matching pending entries by wallet address and amount, BUT only if:
    //    - The transaction amount matches the raffle's ticket price calculation
    //    - The currency matches the raffle's currency
    // 3. Or creating a new entry if raffleSlug is provided
    if (!entry) {
      wasRestored = true // This entry is being restored
      console.log(`Entry not found by transaction signature. Attempting to restore from transaction: ${transactionSignature}`)
      
      // Get transaction details from Solana
      const txResult = await getTransactionDetails(transactionSignature)
      if (!txResult.ok) {
        const isNotFound = txResult.reason === 'NOT_FOUND'
        const isParseFailed = txResult.reason === 'PARSE_FAILED'
        const isConfig = txResult.reason === 'CONFIG'
        return NextResponse.json(
          {
            error: isNotFound
              ? 'Transaction not found on Solana'
              : isParseFailed
                ? 'Transaction is not a payment to the raffle wallet'
                : 'Server configuration error',
            message: isNotFound
              ? 'No entry exists with this transaction signature, and the transaction could not be found on Solana. It may still be confirming—try again in a minute, or check the signature on Solscan.'
              : isParseFailed
                ? 'The transaction was found but could not be read as a SOL or USDC payment to the configured raffle recipient.'
                : txResult.detail || 'Recipient wallet may not be configured.',
            suggestion: isNotFound
              ? 'Confirm the TX signature is correct (copy from Solscan). If the TX is new, wait a minute and retry.'
              : 'Ensure the transaction is a SOL, USDC, or OWL transfer to the raffle wallet. You can also try verifying by wallet + raffle slug instead.',
          },
          { status: 404 }
        )
      }
      const txDetails = txResult.data

      // CRITICAL: Require raffleSlug to prevent matching wrong raffles
      // This ensures we know which raffle the user actually participated in
      const { raffleSlug } = body
      
      if (raffleSlug) {
        // If raffle slug is provided, use it to find/create entry
        raffle = await getRaffleBySlug(raffleSlug)
        if (!raffle) {
          return NextResponse.json(
            { 
              error: 'Raffle not found',
              message: `No raffle found with slug: ${raffleSlug}`,
            },
            { status: 404 }
          )
        }

        // Verify transaction amount matches raffle's ticket price calculation
        const ticketQuantity = Math.floor(txDetails.amount / raffle.ticket_price)
        const expectedAmount = ticketQuantity * raffle.ticket_price
        
        // Check currency matches
        if (raffle.currency !== txDetails.currency) {
          return NextResponse.json(
            { 
              error: 'Currency mismatch',
              message: `Transaction currency (${txDetails.currency}) does not match raffle currency (${raffle.currency})`,
              transactionDetails: {
                walletAddress: txDetails.walletAddress,
                amount: txDetails.amount,
                currency: txDetails.currency,
              },
              raffleDetails: {
                slug: raffle.slug,
                title: raffle.title,
                currency: raffle.currency,
                ticket_price: raffle.ticket_price,
              }
            },
            { status: 400 }
          )
        }

        // Check if amount is a valid multiple of ticket price (with small tolerance)
        const tolerance = 0.01
        if (ticketQuantity <= 0 || Math.abs(txDetails.amount - expectedAmount) > tolerance) {
          return NextResponse.json(
            { 
              error: 'Amount mismatch',
              message: `Transaction amount (${txDetails.amount} ${txDetails.currency}) does not match raffle ticket price calculation. Expected a multiple of ${raffle.ticket_price} ${raffle.currency}.`,
              transactionDetails: {
                walletAddress: txDetails.walletAddress,
                amount: txDetails.amount,
                currency: txDetails.currency,
              },
              raffleDetails: {
                slug: raffle.slug,
                title: raffle.title,
                ticket_price: raffle.ticket_price,
                currency: raffle.currency,
                calculatedTickets: ticketQuantity,
                expectedAmount: expectedAmount,
              }
            },
            { status: 400 }
          )
        }

        // First, try to find existing entry for this wallet/raffle/amount
        const raffleEntries = await getEntriesByRaffleId(raffle.id)
        const matchingEntries = raffleEntries.filter(e => 
          e.wallet_address.toLowerCase() === txDetails.walletAddress.toLowerCase() &&
          (e.status === 'pending' || e.status === 'rejected') &&
          Math.abs(e.amount_paid - txDetails.amount) < tolerance &&
          e.currency === txDetails.currency
        )

        if (matchingEntries.length > 0) {
          // Found existing entry - use it
          entry = matchingEntries[0]
          const saved = await saveTransactionSignature(entry.id, transactionSignature)
          if (saved) {
            entry = saved
          }
          console.log(`Found matching entry ${entry.id} for transaction ${transactionSignature} in raffle ${raffle.slug}`)
        } else {
          // Create new entry
          console.log(`Creating new entry for transaction ${transactionSignature} in raffle ${raffle.slug}`)
          entry = await createEntry({
            raffle_id: raffle.id,
            wallet_address: txDetails.walletAddress,
            ticket_quantity: ticketQuantity,
            transaction_signature: transactionSignature,
            status: 'pending',
            amount_paid: txDetails.amount,
            currency: txDetails.currency,
          })
          
          if (entry) {
            console.log(`Created entry ${entry.id} for transaction ${transactionSignature}`)
          }
        }
      } else {
        // No raffle slug provided - try to find matching entry across all raffles
        // BUT only match if transaction amount exactly matches a valid ticket purchase
        const { data: activeRaffles, error: rafflesErr } = await getRaffles(false)
        if (rafflesErr || !activeRaffles?.length) {
          return NextResponse.json(
            {
              error: 'Could not load raffles',
              message: rafflesErr?.message || 'No raffles available to match transaction.',
            },
            { status: 503 }
          )
        }
        const candidateMatches: Array<{ entry: Entry; raffle: Raffle; confidence: number }> = []

        for (const candidateRaffle of activeRaffles) {
          // Skip if currency doesn't match
          if (candidateRaffle.currency !== txDetails.currency) {
            continue
          }

          // Check if transaction amount is a valid multiple of ticket price
          const ticketQuantity = Math.floor(txDetails.amount / candidateRaffle.ticket_price)
          const expectedAmount = ticketQuantity * candidateRaffle.ticket_price
          const tolerance = 0.01
          
          if (ticketQuantity <= 0 || Math.abs(txDetails.amount - expectedAmount) > tolerance) {
            continue // Amount doesn't match this raffle's pricing
          }

          // Now check for matching entries
          const raffleEntries = await getEntriesByRaffleId(candidateRaffle.id)
          const matchingEntries = raffleEntries.filter(e => 
            e.wallet_address.toLowerCase() === txDetails.walletAddress.toLowerCase() &&
            (e.status === 'pending' || e.status === 'rejected') &&
            Math.abs(e.amount_paid - txDetails.amount) < tolerance &&
            e.currency === txDetails.currency
          )

          if (matchingEntries.length > 0) {
            // Found a match - calculate confidence (exact amount match = high confidence)
            const exactMatch = matchingEntries.find(e => Math.abs(e.amount_paid - txDetails.amount) < 0.001)
            candidateMatches.push({
              entry: exactMatch || matchingEntries[0],
              raffle: candidateRaffle,
              confidence: exactMatch ? 1.0 : 0.8
            })
          }
        }

        if (candidateMatches.length === 0) {
          return NextResponse.json(
            { 
              error: 'Entry not found and could not be restored',
              message: 'No matching entry found. Please provide raffleSlug in the request body to specify which raffle this transaction is for.',
              transactionDetails: {
                walletAddress: txDetails.walletAddress,
                amount: txDetails.amount,
                currency: txDetails.currency,
              },
              suggestion: 'Include raffleSlug in the request to restore the entry. This prevents matching the wrong raffle.'
            },
            { status: 404 }
          )
        } else if (candidateMatches.length === 1) {
          // Single match - use it
          entry = candidateMatches[0].entry!
          raffle = candidateMatches[0].raffle!
          const saved = await saveTransactionSignature(entry.id, transactionSignature)
          if (saved) {
            entry = saved
          }
          console.log(`Found single matching entry ${entry.id} for transaction ${transactionSignature} in raffle ${raffle.slug}`)
        } else {
          // Multiple matches - require raffle slug to disambiguate
          return NextResponse.json(
            { 
              error: 'Multiple possible raffles found',
              message: `Found ${candidateMatches.length} possible raffles that match this transaction. Please provide raffleSlug to specify which raffle this transaction is for.`,
              transactionDetails: {
                walletAddress: txDetails.walletAddress,
                amount: txDetails.amount,
                currency: txDetails.currency,
              },
              possibleRaffles: candidateMatches.map(m => ({
                slug: m.raffle!.slug,
                title: m.raffle!.title,
                ticket_price: m.raffle!.ticket_price,
                confidence: m.confidence,
              })),
              suggestion: 'Include raffleSlug in the request to specify the correct raffle.'
            },
            { status: 400 }
          )
        }
      }

      if (!entry) {
        return NextResponse.json(
          { 
            error: 'Entry not found and could not be restored',
            message: 'No matching entry found. Please provide raffleSlug in the request body to create a new entry.',
            transactionDetails: {
              walletAddress: txDetails.walletAddress,
              amount: txDetails.amount,
              currency: txDetails.currency,
            },
            suggestion: 'Include raffleSlug in the request to restore the entry.'
          },
          { status: 404 }
        )
      }
    }

    // Get the raffle if not already set
    if (!raffle) {
      raffle = await getRaffleById(entry.raffle_id)
      if (!raffle) {
        return NextResponse.json(
          { error: 'Raffle not found for this entry' },
          { status: 404 }
        )
      }
    }

    // CRITICAL: Verify that entry's raffle_id matches the raffle we're verifying against
    // This prevents users from claiming they participated in a different raffle
    if (entry.raffle_id !== raffle.id) {
      return NextResponse.json(
        { 
          error: 'Raffle mismatch',
          message: `Entry is associated with a different raffle. Entry raffle_id: ${entry.raffle_id}, Provided raffle_id: ${raffle.id}`,
          entry: {
            id: entry.id,
            raffle_id: entry.raffle_id,
            wallet_address: entry.wallet_address,
          },
          raffle: {
            id: raffle.id,
            slug: raffle.slug,
            title: raffle.title,
          }
        },
        { status: 400 }
      )
    }

    // Ensure transaction signature is saved
    if (!entry.transaction_signature) {
      const saved = await saveTransactionSignature(entry.id, transactionSignature)
      if (saved) {
        entry = saved
      }
    }

    // Check max_tickets limit if set
    if (raffle.max_tickets) {
      const allEntries = await getEntriesByRaffleId(raffle.id)
      const totalConfirmedTickets = allEntries
        .filter(e => e.status === 'confirmed' && e.id !== entry.id)
        .reduce((sum, e) => sum + e.ticket_quantity, 0)
      
      const wouldExceedLimit = totalConfirmedTickets + entry.ticket_quantity > raffle.max_tickets
      
      if (wouldExceedLimit) {
        await updateEntryStatus(entry.id, 'rejected', transactionSignature)
        return NextResponse.json(
          { 
            error: `Cannot confirm entry: would exceed maximum ticket limit of ${raffle.max_tickets}`,
            details: `Only ${raffle.max_tickets - totalConfirmedTickets} tickets remaining.`
          },
          { status: 400 }
        )
      }
    }

    // Verify the transaction
    const verificationResult = await verifyTransaction(
      transactionSignature,
      entry,
      raffle
    )

    if (!verificationResult.valid) {
      // Check if this is a temporary error
      const isTemporaryError = verificationResult.error?.includes('Transaction not found') ||
                                verificationResult.error?.includes('still be confirming') ||
                                verificationResult.error?.includes('temporary issue') ||
                                verificationResult.error?.includes('Verification error')
      
      if (isTemporaryError) {
        return NextResponse.json(
          { 
            error: 'Transaction verification failed temporarily',
            details: verificationResult.error,
            entry: {
              id: entry.id,
              status: entry.status,
              wallet_address: entry.wallet_address,
              transaction_signature: entry.transaction_signature || transactionSignature,
            },
            message: 'The transaction signature has been saved. Verification will be retried automatically.'
          },
          { status: 202 }
        )
      }
      
      // Permanent failure
      await updateEntryStatus(entry.id, 'rejected', transactionSignature)
      return NextResponse.json(
        { 
          error: 'Transaction verification failed',
          details: verificationResult.error,
          entry: {
            id: entry.id,
            status: 'rejected',
            wallet_address: entry.wallet_address,
          }
        },
        { status: 400 }
      )
    }

    // Verification successful - confirm the entry
    let confirmedEntry = await updateEntryStatus(entry.id, 'confirmed', transactionSignature)

    if (!confirmedEntry) {
      return NextResponse.json(
        { 
          error: 'Failed to update entry status',
          details: 'Database update failed. Check server logs for details.'
        },
        { status: 500 }
      )
    }

    // Mark entry as restored if it was restored via this endpoint
    // This includes:
    // 1. Entries not found by transaction signature (wasRestored = true)
    // 2. Entries found but didn't have transaction signature (hadNoTransactionSignature = true)
    if ((wasRestored || hadNoTransactionSignature) && !confirmedEntry.restored_at) {
      await markEntryAsRestored(confirmedEntry.id, adminWallet)
      // Refresh the entry to get updated restored_at
      const refreshedEntry = await getEntryById(confirmedEntry.id)
      if (refreshedEntry) {
        confirmedEntry = refreshedEntry
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Entry successfully verified and confirmed',
      entry: {
        id: confirmedEntry.id,
        status: confirmedEntry.status,
        wallet_address: confirmedEntry.wallet_address,
        ticket_quantity: confirmedEntry.ticket_quantity,
        transaction_signature: confirmedEntry.transaction_signature,
        verified_at: confirmedEntry.verified_at,
      },
      raffle: {
        id: raffle.id,
        slug: raffle.slug,
        title: raffle.title,
      },
      restored: wasRestored
    })
  } catch (error) {
    console.error('Error verifying entry by transaction signature:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    )
  }
}

type TxDetailsResult =
  | { ok: true; data: { walletAddress: string; amount: number; currency: 'SOL' | 'USDC' | 'OWL' } }
  | { ok: false; reason: 'NOT_FOUND' | 'PARSE_FAILED' | 'CONFIG'; detail?: string }

/**
 * Fetch transaction details from Solana blockchain
 * Returns wallet address, amount, and currency, or a reason for failure
 */
async function getTransactionDetails(transactionSignature: string): Promise<TxDetailsResult> {
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
    
    const connection = new Connection(rpcUrl, 'confirmed')
    
    // Get recipient wallet from environment
    const recipientWallet = process.env.RAFFLE_RECIPIENT_WALLET || 
                           process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET
    
    if (!recipientWallet) {
      console.error('Recipient wallet not configured')
      return { ok: false, reason: 'CONFIG', detail: 'Recipient wallet not configured' }
    }
    
    const recipientPubkey = new PublicKey(recipientWallet)
    
    // Get transaction - try multiple commitments and options (RPCs vary)
    const fetchOptions = [
      { commitment: 'confirmed' as const, maxSupportedTransactionVersion: 0 },
      { commitment: 'confirmed' as const },
      { commitment: 'finalized' as const, maxSupportedTransactionVersion: 0 },
      { commitment: 'finalized' as const },
    ]
    let transaction = null
    for (const opts of fetchOptions) {
      transaction = await connection.getTransaction(transactionSignature, opts)
      if (transaction) break
      await new Promise(r => setTimeout(r, 500))
    }
    
    if (!transaction) {
      return { ok: false, reason: 'NOT_FOUND' }
    }
    if (transaction.meta?.err || !transaction.meta) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'Transaction failed on chain or has no balance data' }
    }
    
    const message = transaction.transaction.message
    const accountKeys = 'staticAccountKeys' in message
      ? (message as any).staticAccountKeys
      : (message as any).accountKeys
    
    // Try SOL first
    const recipientIndex = accountKeys.findIndex(
      (key: PublicKey) => key.equals(recipientPubkey)
    )
    
    if (recipientIndex !== -1) {
      const preBalance = transaction.meta.preBalances[recipientIndex]
      const postBalance = transaction.meta.postBalances[recipientIndex]
      const balanceIncrease = (postBalance - preBalance) / LAMPORTS_PER_SOL
      
      if (balanceIncrease > 0) {
        // Find sender (first signer)
        const senderPubkey = accountKeys[0] // First account is usually the fee payer/sender
        return {
          ok: true,
          data: {
            walletAddress: senderPubkey.toString(),
            amount: balanceIncrease,
            currency: 'SOL'
          }
        }
      }
    }
    
    // Try USDC
    const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    const recipientTokenAddress = await getAssociatedTokenAddress(
      USDC_MINT,
      recipientPubkey
    )
    
    const preTokenBalances = transaction.meta.preTokenBalances || []
    const postTokenBalances = transaction.meta.postTokenBalances || []
    
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
        
        if (increase > 0) {
          // Find sender
          const senderPubkey = accountKeys[0]
          return {
            ok: true,
            data: {
              walletAddress: senderPubkey.toString(),
              amount: increase,
              currency: 'USDC'
            }
          }
        }
      }
    }
    
    // Try OWL
    const { getTokenInfo } = await import('@/lib/tokens')
    const owlTokenInfo = getTokenInfo('OWL')
    if (owlTokenInfo.mintAddress) {
      const OWL_MINT = new PublicKey(owlTokenInfo.mintAddress)
      const recipientOwlTokenAddress = await getAssociatedTokenAddress(
        OWL_MINT,
        recipientPubkey
      )
      
      const recipientOwlTokenIndex = accountKeys.findIndex(
        (key: PublicKey) => key.equals(recipientOwlTokenAddress)
      )
      
      if (recipientOwlTokenIndex !== -1) {
        const matchingPostBalance = postTokenBalances.find(b => b.accountIndex === recipientOwlTokenIndex)
        if (matchingPostBalance) {
          const amount = parseFloat(matchingPostBalance.uiTokenAmount?.uiAmountString || '0')
          const matchingPreBalance = preTokenBalances.find(b => b.accountIndex === recipientOwlTokenIndex)
          const preAmount = matchingPreBalance ? parseFloat(matchingPreBalance.uiTokenAmount?.uiAmountString || '0') : 0
          const increase = amount - preAmount
          
          if (increase > 0) {
            // Find sender
            const senderPubkey = accountKeys[0]
            return {
              ok: true,
              data: {
                walletAddress: senderPubkey.toString(),
                amount: increase,
                currency: 'OWL'
              }
            }
          }
        }
      }
    }
    
    return { ok: false, reason: 'PARSE_FAILED', detail: 'No SOL, USDC, or OWL payment to raffle wallet found in transaction' }
  } catch (error) {
    console.error('Error fetching transaction details:', error)
    return { ok: false, reason: 'NOT_FOUND', detail: error instanceof Error ? error.message : String(error) }
  }
}
