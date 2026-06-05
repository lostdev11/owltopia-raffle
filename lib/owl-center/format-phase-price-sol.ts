import { lamportsToSolDisplay } from '@/lib/gen2-presale/format-sol'

/** Human-readable mint price from on-chain lamports quote (e.g. "~0.1234 SOL"). */
export function formatPhasePriceSol(lamports: bigint | string | null | undefined): string | null {
  if (lamports == null || lamports === '') return null
  try {
    return `~${lamportsToSolDisplay(lamports)} SOL`
  } catch {
    return null
  }
}

export function formatPhasePriceSolOrFree(
  lamports: bigint | string | null | undefined,
  opts?: { paid?: boolean }
): string {
  const paid = opts?.paid !== false
  if (!paid) return 'Free'
  return formatPhasePriceSol(lamports) ?? 'Quote unavailable'
}
