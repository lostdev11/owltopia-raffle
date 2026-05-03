import { Connection, PublicKey } from '@solana/web3.js'

import { fetchParsedTransactionConfirmed, feePayerMatchesBuyer } from '@/lib/gen2-presale/verify-payment'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { resolveOwlCenterMintVerifyRpcUrl, type OwlMintNetwork } from '@/lib/solana/network'

export type VerifyGen2MintTxResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'failed' | 'fee_payer_mismatch' | 'candy_machine_missing' }

/**
 * Confirms the signature exists, succeeded, and fee payer matches minter.
 * Optionally ensures the configured Candy Machine pubkey appears in loaded account keys.
 *
 * TODO: Devnet CM smoke tests; strict ix decode (mintV2) + guard group; Helius enhanced txs.
 * TODO: Parse minted NFT mint addresses from inner instructions for reconciliation.
 */
export async function verifyGen2MintTransaction(params: {
  txSignature: string
  wallet: string
  candyMachineId?: string | null
  /** When set, selects RPC (devnet vs mainnet verification). */
  network?: OwlMintNetwork
}): Promise<VerifyGen2MintTxResult> {
  const net = params.network ?? 'mainnet'
  const connection = new Connection(resolveOwlCenterMintVerifyRpcUrl(net), 'confirmed')
  const parsed = await fetchParsedTransactionConfirmed(connection, params.txSignature)
  if (!parsed) return { ok: false, reason: 'not_found' }
  if (parsed.meta?.err) return { ok: false, reason: 'failed' }

  const buyer = new PublicKey(normalizeSolanaWalletAddress(params.wallet) ?? params.wallet)
  if (!feePayerMatchesBuyer(parsed, buyer)) {
    return { ok: false, reason: 'fee_payer_mismatch' }
  }

  const cm = params.candyMachineId?.trim()
  if (cm) {
    try {
      const cmPk = new PublicKey(cm)
      const msg = parsed.transaction.message as unknown as {
        getAccountKeys?: (o: { accountKeysFromLookups?: unknown }) => {
          staticAccountKeys: PublicKey[]
          keySegments?: () => Iterable<{ readonly: PublicKey[]; writable: PublicKey[] }>
        }
      }
      const keys = msg.getAccountKeys?.({
        accountKeysFromLookups: parsed.meta?.loadedAddresses,
      })
      const flat: PublicKey[] = []
      if (keys?.staticAccountKeys?.length) flat.push(...keys.staticAccountKeys)
      const seg = keys?.keySegments?.()
      if (seg) {
        for (const s of seg) {
          flat.push(...s.readonly, ...s.writable)
        }
      }
      const loaded = parsed.meta?.loadedAddresses as { writable?: string[]; readonly?: string[] } | undefined
      if (loaded?.writable?.length) {
        for (const s of loaded.writable) flat.push(new PublicKey(s))
      }
      if (loaded?.readonly?.length) {
        for (const s of loaded.readonly) flat.push(new PublicKey(s))
      }
      const hit = flat.some((k) => k.equals(cmPk))
      if (!hit) {
        return { ok: false, reason: 'candy_machine_missing' }
      }
    } catch {
      return { ok: false, reason: 'candy_machine_missing' }
    }
  }

  return { ok: true }
}
