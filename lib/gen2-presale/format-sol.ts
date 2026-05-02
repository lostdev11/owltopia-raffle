import { LAMPORTS_PER_SOL } from '@solana/web3.js'

export function lamportsToSolDisplay(lamports: bigint | string, decimals = 4): string {
  const n = typeof lamports === 'string' ? BigInt(lamports || '0') : lamports
  const sol = Number(n) / LAMPORTS_PER_SOL
  if (!Number.isFinite(sol)) return '—'
  return sol.toFixed(decimals)
}
