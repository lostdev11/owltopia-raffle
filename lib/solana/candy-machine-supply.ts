import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchCandyMachine, mplCandyMachine } from '@metaplex-foundation/mpl-candy-machine'
import { publicKey } from '@metaplex-foundation/umi'

import { getLaunchSolanaRpcUrl } from '@/lib/solana/launch-cm'
import type { OwlMintNetwork } from '@/lib/solana/network'
import { MINT_SOLANA_RPC_RETRY, withSolanaRpcRetry } from '@/lib/solana/rpc-retry'

export type CandyMachineSupplySnapshot =
  | { ok: true; itemsLoaded: number; itemsRedeemed: number; remaining: number }
  | { ok: false }

/** Read Candy Machine supply from chain (server or browser RPC). */
export async function fetchCandyMachineOnChainSupply(
  candyMachineId: string,
  network: OwlMintNetwork
): Promise<CandyMachineSupplySnapshot> {
  const cmId = candyMachineId.trim()
  if (!cmId) return { ok: false }

  try {
    const umi = createUmi(getLaunchSolanaRpcUrl(network), { commitment: 'confirmed' }).use(mplCandyMachine())
    const cm = await withSolanaRpcRetry(
      () => fetchCandyMachine(umi, publicKey(cmId)),
      MINT_SOLANA_RPC_RETRY
    )
    const itemsLoaded = Number(cm.itemsLoaded)
    const itemsRedeemed = Number(cm.itemsRedeemed)
    return {
      ok: true,
      itemsLoaded,
      itemsRedeemed,
      remaining: Math.max(0, itemsLoaded - itemsRedeemed),
    }
  } catch {
    return { ok: false }
  }
}
