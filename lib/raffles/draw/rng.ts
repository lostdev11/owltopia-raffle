import { createHash, randomBytes } from 'node:crypto'
import { DRAW_ALGO_V1, DRAW_ALGO_V2_COMMIT_REVEAL } from '@/lib/raffles/draw/types'

/**
 * Generate a draw seed (64 hex chars / 32 bytes).
 * v1: published at draw time. v2: committed (hashed) at create, published at draw.
 */
export function generateDrawSeed(): string {
  return randomBytes(32).toString('hex')
}

/** Public commit: SHA-256 hex of the raw seed string (utf8). */
export function hashDrawCommit(drawSeed: string): string {
  const seed = drawSeed.trim()
  if (!seed) throw new Error('drawSeed is required for commit hash')
  return createHash('sha256').update(seed, 'utf8').digest('hex')
}

/**
 * Shared index derivation for v1 and v2:
 * winnerIndex = SHA256(seed || ":" || soldCount) as big-endian uint % soldCount
 *
 * v2 differs only by *when* the seed is chosen (create vs draw), not the math.
 */
export function pickWinnerIndexV1(drawSeed: string, soldCount: number): number {
  if (!Number.isInteger(soldCount) || soldCount <= 0) {
    throw new Error('soldCount must be a positive integer')
  }
  const seed = drawSeed.trim()
  if (!seed) throw new Error('drawSeed is required')

  const digest = createHash('sha256').update(`${seed}:${soldCount}`, 'utf8').digest()
  let n = 0n
  for (let i = 0; i < 8; i++) {
    n = (n << 8n) | BigInt(digest[i]!)
  }
  return Number(n % BigInt(soldCount))
}

export function pickWinnerIndex(algo: string, drawSeed: string, soldCount: number): number {
  if (algo === DRAW_ALGO_V1 || algo === DRAW_ALGO_V2_COMMIT_REVEAL) {
    return pickWinnerIndexV1(drawSeed, soldCount)
  }
  throw new Error(`Unsupported draw algo: ${algo}`)
}
