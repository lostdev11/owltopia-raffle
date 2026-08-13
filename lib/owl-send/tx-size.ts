import { Transaction } from '@solana/web3.js'

/** Solana legacy / v0 packet limit (bytes). */
export const OWL_SEND_TX_PACKET_LIMIT = 1232

/**
 * Leave room for Jupiter / Phantom Lighthouse (Blowfish) guard ixs.
 * A 5-NFT Gen2 scatter (createATA + revoke leftover CM delegates + transfer + fee)
 * serializes to ~1121 bytes — wallets then inject asserts and the approve sheet never opens.
 */
export const OWL_SEND_TX_SAFE_BYTES = 900

export function measureOwlSendTxBytes(tx: Transaction): number {
  try {
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length
  } catch {
    return OWL_SEND_TX_PACKET_LIMIT + 1
  }
}

export function owlSendTxFitsSafePacket(tx: Transaction, limit = OWL_SEND_TX_SAFE_BYTES): boolean {
  return measureOwlSendTxBytes(tx) <= limit
}

export function isOwlSendPacketSizeError(message: string): boolean {
  const m = (message ?? '').toLowerCase()
  return (
    m.includes('transaction too large') ||
    m.includes('versionedtransaction too large') ||
    m.includes('does not fit in one solana transaction') ||
    m.includes('encoding overruns') ||
    m.includes('packet too large') ||
    m.includes('max length') ||
    m.includes('exceeded max account') ||
    m.includes('max accounts exceeded') ||
    m.includes('loads too many accounts') ||
    (m.includes('lighthouse') && (m.includes('size') || m.includes('large') || m.includes('limit')))
  )
}
