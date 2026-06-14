import 'server-only'

import { Connection, PublicKey } from '@solana/web3.js'

import { fetchParsedTransactionConfirmed } from '@/lib/gen2-presale/verify-payment'
import { resolveOwlCenterMintVerifyRpcUrl, type OwlMintNetwork } from '@/lib/solana/network'

const TOKEN_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

/** Best-effort: parse NFT mint address(es) from a Candy Machine mint transaction. */
export async function extractMintedNftMintsFromTx(
  txSignature: string,
  network: OwlMintNetwork = 'mainnet'
): Promise<string[]> {
  const connection = new Connection(resolveOwlCenterMintVerifyRpcUrl(network), 'confirmed')
  const parsed = await fetchParsedTransactionConfirmed(connection, txSignature)
  if (!parsed?.meta) return []

  const mints = new Set<string>()

  for (const bal of parsed.meta.postTokenBalances ?? []) {
    if (bal.uiTokenAmount?.decimals === 0 && bal.uiTokenAmount?.uiAmount === 1 && bal.mint) {
      mints.add(bal.mint)
    }
  }

  const visitIx = (ix: { programId?: PublicKey; parsed?: unknown }) => {
    if (!ix.parsed || typeof ix.parsed !== 'object') return
    const programId = ix.programId
    if (!programId?.equals(TOKEN_METADATA_PROGRAM)) return
    const p = ix.parsed as { type?: string; info?: Record<string, unknown> }
    const info = p.info ?? {}
    for (const key of ['mint', 'metadata', 'account']) {
      const v = info[key]
      if (typeof v === 'string' && v.length >= 32) {
        mints.add(v)
      }
    }
  }

  const msg = parsed.transaction.message
  for (const ix of msg.instructions as { programId?: PublicKey; parsed?: unknown }[]) {
    visitIx(ix)
  }
  for (const group of parsed.meta.innerInstructions ?? []) {
    for (const ix of group.instructions as { programId?: PublicKey; parsed?: unknown }[]) {
      visitIx(ix)
    }
  }

  return [...mints]
}
