/**
 * Jackpot pool credit rounding (admin SOL top-up ledger).
 * Run: npx tsx scripts/test-pack-jackpot-credit-math.ts
 */

function creditPoolAfter(poolBefore: number, amountSol: number): number {
  return Math.round((poolBefore + amountSol) * 1_000_000_000) / 1_000_000_000
}

const a = creditPoolAfter(0.1, 0.02)
if (a !== 0.12) throw new Error(`expected 0.12 got ${a}`)

const b = creditPoolAfter(0.000000001, 0.000000001)
if (b !== 0.000000002) throw new Error(`expected 2e-9 got ${b}`)

console.log('test-pack-jackpot-credit-math: ok')
