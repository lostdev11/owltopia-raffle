import { NextRequest, NextResponse } from 'next/server'
import { updateEntryStatus, getEntryById, saveTransactionSignature, getEntryByTransactionSignature } from '@/lib/db/entries'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import { verifyTransaction } from '@/lib/verify-transaction'
import { entriesVerifyBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/safe-error'

// Force dynamic rendering since we use request body
export const dynamic = 'force-dynamic'

/**
 * Server-side payment verification endpoint.
 * Verifies transaction on Solana RPC, then confirms entry.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`entries-verify:${ip}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Try again later.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(entriesVerifyBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { entryId, transactionSignature } = parsed.data

    // Get the entry to check raffle and ticket quantity
    let entry = await getEntryById(entryId)
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

    // Replay protection: transaction signature must not already be used by another entry
    const existingWithSig = await getEntryByTransactionSignature(transactionSignature)
    if (existingWithSig && existingWithSig.id !== entryId) {
      return NextResponse.json(
        { error: 'Transaction signature already used for another entry' },
        { status: 400 }
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

    // CRITICAL: Save transaction signature FIRST, even before verification
    // This ensures automatic verification can retry later if verification fails temporarily
    if (!entry.transaction_signature) {
      const saved = await saveTransactionSignature(entryId, transactionSignature)
      if (!saved) {
        console.error('Failed to save transaction signature. Entry ID:', entryId)
        // Continue anyway - we'll try to save it again when updating status
      } else {
        // Update entry object to reflect saved signature
        entry = saved
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
      // Check if this is a temporary error that might resolve later
      const isTemporaryError = verificationResult.error?.includes('Transaction not found') ||
                                verificationResult.error?.includes('still be confirming') ||
                                verificationResult.error?.includes('temporary issue') ||
                                verificationResult.error?.includes('Verification error')
      
      if (isTemporaryError) {
        // Don't reject - leave as pending so automatic verification can retry
        // The transaction signature is already saved, so background verification will pick it up
        console.log(`Verification failed temporarily for entry ${entryId}. Will retry automatically. Error: ${verificationResult.error}`)
        return NextResponse.json(
          { 
            error: 'Transaction verification failed temporarily',
            details: verificationResult.error || 'Unknown verification error',
            retry: true,
            message: 'The transaction signature has been saved. Verification will be retried automatically. Please refresh the page in a few moments.'
          },
          { status: 202 } // 202 Accepted - request accepted but not yet processed
        )
      }
      
      // Permanent failure - reject the entry
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
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}

