import { DRAW_ALGO_V1, type DrawRevealMemoParts } from '@/lib/raffles/draw/types'

/**
 * On-chain memo format (colon-separated):
 *   owltopia-draw-v1:<raffleId>:<drawSeed>:<soldCount>:<winnerIndex>:<ledgerHash>
 *   (same shape for v2; algo id distinguishes commit–reveal)
 *
 * FFF uses seed:soldCount:winnerIndex; we prefix algo + raffleId + ledgerHash for upgradeability.
 * drawSeed is hex (no colons).
 */
export function encodeDrawRevealMemo(parts: DrawRevealMemoParts): string {
  const algo = parts.algo.trim() || DRAW_ALGO_V1
  const raffleId = parts.raffleId.trim()
  const drawSeed = parts.drawSeed.trim()
  const soldCount = Math.floor(Number(parts.soldCount))
  const winnerIndex = Math.floor(Number(parts.winnerIndex))
  const ledgerHash = parts.ledgerHash.trim().toLowerCase()

  if (!raffleId || !drawSeed || !ledgerHash) {
    throw new Error('encodeDrawRevealMemo: missing raffleId, drawSeed, or ledgerHash')
  }
  if (!Number.isFinite(soldCount) || soldCount <= 0) {
    throw new Error('encodeDrawRevealMemo: invalid soldCount')
  }
  if (!Number.isFinite(winnerIndex) || winnerIndex < 0 || winnerIndex >= soldCount) {
    throw new Error('encodeDrawRevealMemo: winnerIndex out of range')
  }

  return `${algo}:${raffleId}:${drawSeed}:${soldCount}:${winnerIndex}:${ledgerHash}`
}

export function parseDrawRevealMemo(memo: string): DrawRevealMemoParts | null {
  const raw = memo.trim()
  if (!raw) return null
  const parts = raw.split(':')
  // algo : raffleId : drawSeed : soldCount : winnerIndex : ledgerHash
  // raffleId is UUID (no colons); drawSeed is hex (no colons); ledgerHash is hex.
  if (parts.length < 6) return null

  const algo = parts[0]!
  const raffleId = parts[1]!
  const drawSeed = parts[2]!
  const soldCount = Number(parts[3])
  const winnerIndex = Number(parts[4])
  // ledgerHash may theoretically be joined if we ever add more fields — take the rest joined
  const ledgerHash = parts.slice(5).join(':').toLowerCase()

  if (!algo || !raffleId || !drawSeed || !ledgerHash) return null
  if (!Number.isInteger(soldCount) || soldCount <= 0) return null
  if (!Number.isInteger(winnerIndex) || winnerIndex < 0 || winnerIndex >= soldCount) return null

  return { algo, raffleId, drawSeed, soldCount, winnerIndex, ledgerHash }
}
