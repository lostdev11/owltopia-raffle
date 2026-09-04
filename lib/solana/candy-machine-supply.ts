import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplCore } from '@metaplex-foundation/mpl-core'
import { fetchCandyMachine as fetchTmCandyMachine, mplCandyMachine } from '@metaplex-foundation/mpl-candy-machine'
import { publicKey } from '@metaplex-foundation/umi'

import { fetchCandyMachine as fetchCoreCandyMachine, mplCoreCandyMachine } from '@/lib/solana/core-candy-machine'
import { getLaunchSolanaRpcUrl } from '@/lib/solana/launch-cm'
import type { OwlMintNetwork } from '@/lib/solana/network'
import { MINT_SOLANA_RPC_RETRY, withSolanaRpcRetry } from '@/lib/solana/rpc-retry'

export type CandyMachineSupplySnapshot =
  | { ok: true; itemsLoaded: number; itemsRedeemed: number; remaining: number }
  | { ok: false }

function snapshotFromCm(cm: { itemsLoaded: number | bigint; itemsRedeemed: number | bigint }): CandyMachineSupplySnapshot {
  const itemsLoaded = Number(cm.itemsLoaded)
  const itemsRedeemed = Number(cm.itemsRedeemed)
  return {
    ok: true,
    itemsLoaded,
    itemsRedeemed,
    remaining: Math.max(0, itemsLoaded - itemsRedeemed),
  }
}

/** Read Candy Machine supply from chain (Token Metadata CM, then Core CM). */
export async function fetchCandyMachineOnChainSupply(
  candyMachineId: string,
  network: OwlMintNetwork
): Promise<CandyMachineSupplySnapshot> {
  const cmId = candyMachineId.trim()
  if (!cmId) return { ok: false }

  const rpc = getLaunchSolanaRpcUrl(network)
  const pk = publicKey(cmId)

  try {
    const umi = createUmi(rpc, { commitment: 'confirmed' }).use(mplCandyMachine())
    const cm = await withSolanaRpcRetry(() => fetchTmCandyMachine(umi, pk), MINT_SOLANA_RPC_RETRY)
    return snapshotFromCm(cm)
  } catch {
    /* Core partner CMs are not Token Metadata accounts — try Core next. */
  }

  try {
    const umi = createUmi(rpc, { commitment: 'confirmed' }).use(mplCore()).use(mplCoreCandyMachine())
    const cm = await withSolanaRpcRetry(() => fetchCoreCandyMachine(umi, pk), MINT_SOLANA_RPC_RETRY)
    return snapshotFromCm(cm)
  } catch {
    return { ok: false }
  }
}
