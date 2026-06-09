'use client'

import type { Connection } from '@solana/web3.js'

/**
 * Wait until the RPC reports the transaction landed without error.
 * Wallets sometimes return a signature before getTransaction indexes it; mobile RPC can lag.
 */
const TIMEOUT_HINT =
  'Check your wallet activity. If the transaction appears successful, tap Verify deposit — the transfer may already be on-chain (common on mobile or busy RPCs).'

/** One status check. Returns true when confirmed; throws on definitive on-chain failure. */
async function pollSignatureOnce(connection: Connection, signature: string): Promise<boolean> {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    if (tx?.meta) {
      if (tx.meta.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(tx.meta.err)}`)
      }
      return true
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('transaction failed')) throw e
  }

  try {
    const st = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    })
    const s = st?.value?.[0]
    if (s?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(s.err)}`)
    }
    // Include processed: public RPCs often lag before status shows confirmed/finalized (mobile).
    if (
      s?.confirmationStatus === 'processed' ||
      s?.confirmationStatus === 'confirmed' ||
      s?.confirmationStatus === 'finalized'
    ) {
      return true
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('transaction failed')) throw e
  }

  return false
}

export async function confirmSignatureSuccessOnChain(
  connection: Connection,
  signature: string,
  /** Mobile / congested RPC: allow extra time before we ask the user to verify manually. */
  timeoutMs = 120_000
): Promise<void> {
  const started = Date.now()
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  while (Date.now() - started < timeoutMs) {
    if (await pollSignatureOnce(connection, signature)) return
    await sleep(500)
  }

  // Mobile: timers freeze while the tab is backgrounded (user inside the wallet app),
  // so the wall clock can expire without a single poll after return. Always do one
  // final check before reporting a timeout — the tx usually confirmed long ago.
  if (await pollSignatureOnce(connection, signature)) return

  throw new Error(
    `Transaction signature was returned, but it was not confirmed on-chain in time. ${TIMEOUT_HINT}`
  )
}
