import { Connection, type ConfirmedSignatureInfo, PublicKey } from '@solana/web3.js'

/**
 * Walk signature history newest-first using `before` cursors (multiple RPC calls).
 * Stops when a page returns fewer than `pageSize` results or `maxPages` is reached.
 */
export async function fetchSignaturesForAddressPaginated(
  connection: Connection,
  address: PublicKey,
  pageSize: number,
  maxPages: number
): Promise<{ signatures: ConfirmedSignatureInfo[]; pagesFetched: number }> {
  const signatures: ConfirmedSignatureInfo[] = []
  let before: string | undefined
  let pagesFetched = 0

  for (let page = 0; page < maxPages; page++) {
    const batch = await connection.getSignaturesForAddress(address, {
      limit: pageSize,
      before,
    })
    pagesFetched++
    if (batch.length === 0) break
    signatures.push(...batch)
    before = batch[batch.length - 1].signature
    if (batch.length < pageSize) break
  }

  return { signatures, pagesFetched }
}
