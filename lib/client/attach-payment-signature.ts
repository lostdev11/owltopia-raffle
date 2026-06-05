/**
 * Persist payment TX on pending/rejected entries immediately after wallet send,
 * so a second checkout cannot orphan an in-flight payment.
 */
export async function attachPaymentSignature(input: {
  entryId: string
  transactionSignature: string
  walletAddress: string
}): Promise<boolean> {
  try {
    const res = await fetch('/api/entries/attach-tx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function attachPaymentSignaturesBatch(input: {
  entryIds: string[]
  transactionSignature: string
  walletAddress: string
}): Promise<boolean> {
  try {
    const res = await fetch('/api/entries/attach-tx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    })
    return res.ok
  } catch {
    return false
  }
}
