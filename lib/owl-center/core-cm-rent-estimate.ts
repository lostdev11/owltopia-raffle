import type { Umi } from '@metaplex-foundation/umi'
import { TokenStandard, isProgrammable } from '@metaplex-foundation/mpl-token-metadata'

/** Mirrors MPL Core Candy Machine `getCandyMachineSize` (config-line mode). */
const CANDY_MACHINE_HIDDEN_SECTION = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 1 + 1 + 4 + 32 + 4 + 4 + 200 + 4 + 1 + 1 + 4 + 32 + 4 + 200 + 32 + 1 + 1

/** Conservative Core collection account data length (plugins + metadata). */
export const CORE_COLLECTION_ACCOUNT_DATA_LEN = 2048

export function estimateCoreCandyMachineAccountDataLen(
  itemsAvailable: number,
  configLineSettings: { nameLength: number; uriLength: number } | null
): number {
  const base = isProgrammable(TokenStandard.NonFungible)
    ? CANDY_MACHINE_HIDDEN_SECTION + 33
    : CANDY_MACHINE_HIDDEN_SECTION

  if (!configLineSettings) return base

  const items = Math.max(0, Math.floor(Number(itemsAvailable)))
  const configLineSize = configLineSettings.nameLength + configLineSettings.uriLength
  return Math.ceil(
    base +
      4 +
      items * configLineSize +
      (4 + Math.floor(items / 8) + 1) +
      (4 + items * 4)
  )
}

export async function estimateCoreShellDeployRentLamports(
  umi: Umi,
  params: {
    itemsAvailable: number
    nameLength: number
    uriLength: number
    /** Extra headroom for tx fees + priority (lamports). */
    feeBufferLamports?: bigint
  }
): Promise<bigint> {
  const cmSpace = estimateCoreCandyMachineAccountDataLen(params.itemsAvailable, {
    nameLength: params.nameLength,
    uriLength: params.uriLength,
  })

  const [collectionRent, cmRent] = await Promise.all([
    umi.rpc.getRent(CORE_COLLECTION_ACCOUNT_DATA_LEN),
    umi.rpc.getRent(cmSpace),
  ])

  const feeBuffer = params.feeBufferLamports ?? 50_000_000n
  return collectionRent.basisPoints + cmRent.basisPoints + feeBuffer
}

export function formatSolFromLamports(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n
  const frac = lamports % 1_000_000_000n
  if (frac === 0n) return `${whole} SOL`
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '')
  return `${whole}.${fracStr} SOL`
}
