import { createHash, randomBytes } from 'node:crypto'
import { DRAW_ALGO_V1 } from '@/lib/raffles/draw/types'

/**
 * Generate a public draw seed (64 hex chars / 32 bytes).
 * Published at reveal time; entropy is one-time random (not derived from ticket list).
 */
export function generateDrawSeed(): string {
  return randomBytes(32).toString('hex')
}

/**
 * owltopia-draw-v1: winnerIndex = SHA256(seed || ":" || soldCount) as big-endian uint % soldCount
 *
 * Deliberately simple and dependency-free so anyone can recompute.
 * Memo includes algo id so verifiers use the right function; later algos can swap this.
 */
export function pickWinnerIndexV1(drawSeed: string, soldCount: number): number {
  if (!Number.isInteger(soldCount) || soldCount <= 0) {
    throw new Error('soldCount must be a positive integer')
  }
  const seed = drawSeed.trim()
  if (!seed) throw new Error('drawSeed is required')

  const digest = createHash('sha256').update(`${seed}:${soldCount}`, 'utf8').digest()
  // Use first 8 bytes as unsigned big-endian bigint for a wide modulus space.
  let n = 0n
  for (let i = 0; i < 8; i++) {
    n = (n << 8n) | BigInt(digest[i]!)
  }
  return Number(n % BigInt(soldCount))
}

export function pickWinnerIndex(algo: string, drawSeed: string, soldCount: number): number {
  if (algo === DRAW_ALGO_V1) {
    return pickWinnerIndexV1(drawSeed, soldCount)
  }
  throw new Error(`Unsupported draw algo: ${algo}`)
}
