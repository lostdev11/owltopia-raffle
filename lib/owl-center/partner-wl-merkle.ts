import { getMerkleRoot } from '@metaplex-foundation/mpl-core-candy-machine'
import { getMerkleRoot as getTmMerkleRoot } from '@metaplex-foundation/mpl-candy-machine'
import bs58 from 'bs58'

import { listLaunchWlWallets } from '@/lib/db/owl-center-launch-wl-wallets'
import { normalizePhaseKey } from '@/lib/owl-center/partner-allowlist-phases'

/**
 * Wallets eligible for a partner phase Candy Guard allowList (merkle root + proofs).
 * Sorted ascending so the root is deterministic (matches Gen2 WL convention).
 */
export async function listPartnerPhaseMerkleWallets(
  launchId: string,
  phaseKey: string
): Promise<string[]> {
  const pk = normalizePhaseKey(phaseKey) || 'wl'
  const rows = await listLaunchWlWallets(launchId, pk)
  const wallets = rows
    .filter((r) => r.allowed_mints > 0)
    .map((r) => r.wallet.trim())
    .filter(Boolean)
  return [...new Set(wallets)].sort((a, b) => a.localeCompare(b))
}

export function partnerPhaseMerkleRootBytes(
  wallets: string[],
  mintStandard: 'core' | 'token_metadata'
): Uint8Array {
  if (wallets.length < 1) {
    throw new Error('Allowlist merkle root requires at least one wallet')
  }
  return mintStandard === 'core' ? getMerkleRoot(wallets) : getTmMerkleRoot(wallets)
}

export function partnerPhaseMerkleRootBase58(
  wallets: string[],
  mintStandard: 'core' | 'token_metadata'
): string {
  return bs58.encode(partnerPhaseMerkleRootBytes(wallets, mintStandard))
}
