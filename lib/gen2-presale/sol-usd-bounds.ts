import { LAMPORTS_PER_SOL } from '@solana/web3.js'

/**
 * Max accepted drift between create-time and confirm-time SOL/USD for chain-aligned verification.
 * Client-supplied rates are never used to compute expected payment amounts.
 */
export const SOL_USD_PRICE_TOLERANCE = 0.15

/** Hard ceiling on per-spot SOL (still rejects absurd overpayment units). */
export const CHAIN_INFERENCE_HARD_MAX_UNIT_SOL = 100

/**
 * Oracle-implied lamports per spot and tolerated min/max for chain-aligned confirmation.
 * Floor is derived from the live quote (±tolerance), not a fixed tiny SOL amount.
 */
export function unitLamportsBoundsFromOracle(
  priceUsdc: number,
  solUsdPrice: number,
  tolerance: number = SOL_USD_PRICE_TOLERANCE
): { unit: bigint; minUnit: bigint; maxUnit: bigint } {
  if (!(priceUsdc > 0) || !(solUsdPrice > 0) || !Number.isFinite(priceUsdc) || !Number.isFinite(solUsdPrice)) {
    throw new Error('Invalid priceUsdc or solUsdPrice for unit bounds')
  }
  const unitSol = priceUsdc / solUsdPrice
  const unit = BigInt(Math.round(unitSol * LAMPORTS_PER_SOL))
  if (unit <= 0n) {
    throw new Error('Oracle unit lamports must be positive')
  }

  const tol = Math.min(0.5, Math.max(0, tolerance))
  const minUnit = BigInt(Math.max(1, Math.ceil(Number(unit) * (1 - tol))))
  const softMax = BigInt(Math.max(Number(minUnit), Math.floor(Number(unit) * (1 + tol))))
  const hardMax = BigInt(Math.floor(CHAIN_INFERENCE_HARD_MAX_UNIT_SOL * LAMPORTS_PER_SOL))
  const maxUnit = softMax < hardMax ? softMax : hardMax

  return { unit, minUnit, maxUnit }
}

/**
 * If a client echoes a create-transaction SOL/USD rate, accept it only when it stays
 * within tolerance of the live oracle. Never accept a rate outside that band.
 * Prefer callers that ignore the client value entirely for amount checks.
 */
export function resolveSolUsdAgainstOracle(
  oracle: number,
  clientHint?: number | null
): number {
  if (!(oracle > 0) || !Number.isFinite(oracle)) {
    throw new Error('Invalid oracle SOL/USD')
  }
  if (clientHint == null || !Number.isFinite(clientHint) || clientHint <= 0) {
    return oracle
  }
  const lo = oracle * (1 - SOL_USD_PRICE_TOLERANCE)
  const hi = oracle * (1 + SOL_USD_PRICE_TOLERANCE)
  if (clientHint < lo || clientHint > hi) {
    return oracle
  }
  return clientHint
}
