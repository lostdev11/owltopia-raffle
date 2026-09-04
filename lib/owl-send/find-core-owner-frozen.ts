'use client'

/**
 * Scan OwlSend lines for MPL Core Owner (or other) FreezeDelegate locks.
 * Used so "Skip frozen & retry" actually drops Core nest leftovers — SPL ATA
 * freeze scans miss these entirely.
 */

import type { Connection } from '@solana/web3.js'
import { isDasCompressedNft, isDasMplCoreInterface } from '@/lib/solana/prize-nft-standard'
import { isProgrammableNftInterface } from '@/lib/solana/nft-transfer-lock'
import { readOwlSendCoreOwnerFreeze } from '@/lib/owl-send/mpl-core-owner-freeze-read'

const DEFAULT_CONCURRENCY = 4

function shouldProbeCoreFreeze(line: {
  compressed?: boolean | null
  interface?: string | null
}): boolean {
  if (isDasCompressedNft({ compressed: line.compressed, interface: line.interface })) {
    return false
  }
  // Known classic / pNFT Token Metadata — not Core.
  if (isProgrammableNftInterface(line.interface)) return false
  const iface = (line.interface ?? '').trim()
  if (iface && !isDasMplCoreInterface(iface) && /v1_nft|v2_nft|legacy|custom/i.test(iface)) {
    return false
  }
  // Core DAS interface, or unknown — probe (matches send-special-nft).
  return true
}

/**
 * Returns mint ids that are still frozen under MPL Core FreezeDelegate
 * (Owner leftovers after force-leave, or other nest authorities).
 */
export async function findOwlSendCoreOwnerFrozenMints(params: {
  connection: Connection
  lines: Array<{ mint: string; compressed?: boolean | null; interface?: string | null }>
  concurrency?: number
}): Promise<string[]> {
  const seen = new Set<string>()
  const probes: Array<{ mint: string; interface?: string | null }> = []
  for (const line of params.lines) {
    const mint = line.mint.trim()
    if (!mint || seen.has(mint)) continue
    seen.add(mint)
    if (!shouldProbeCoreFreeze(line)) continue
    probes.push({ mint, interface: line.interface })
  }
  if (probes.length < 1) return []

  const concurrency = Math.max(1, Math.min(params.concurrency ?? DEFAULT_CONCURRENCY, 8))
  const frozen: string[] = []

  for (let i = 0; i < probes.length; i += concurrency) {
    const chunk = probes.slice(i, i + concurrency)
    const results = await Promise.all(
      chunk.map(async (row) => {
        try {
          const check = await readOwlSendCoreOwnerFreeze({
            connection: params.connection,
            assetId: row.mint,
            interfaceHint: row.interface,
          })
          if (check.kind === 'owner_frozen' || check.kind === 'other_frozen') {
            return row.mint
          }
        } catch {
          /* leave in plan — send path will surface the error */
        }
        return null
      })
    )
    for (const mint of results) {
      if (mint) frozen.push(mint)
    }
  }

  return frozen
}

/** Pure helper for unit tests — which lines get a Core freeze RPC probe. */
export function owlSendLineShouldProbeCoreFreeze(line: {
  compressed?: boolean | null
  interface?: string | null
}): boolean {
  return shouldProbeCoreFreeze(line)
}
