/**
 * When pool SOL left on-chain but claim rows never recorded it, coverage must
 * still treat that outflow as paid so the shortfall gate does not strand everyone.
 */
export function orphanRevSharePoolPayouts(params: {
  ledger_sol: number
  ledger_usdc: number
  claims_committed_sol: number
  claims_committed_usdc: number
}): { orphan_sol: number; orphan_usdc: number } {
  const orphanSol = Math.max(
    0,
    (Number(params.ledger_sol) || 0) - (Number(params.claims_committed_sol) || 0)
  )
  const orphanUsdc = Math.max(
    0,
    (Number(params.ledger_usdc) || 0) - (Number(params.claims_committed_usdc) || 0)
  )
  return { orphan_sol: orphanSol, orphan_usdc: orphanUsdc }
}

export function applyOrphanRevSharePoolPayoutsToRequired(params: {
  required_sol: number
  required_usdc: number
  orphan_sol: number
  orphan_usdc: number
}): { required_sol: number; required_usdc: number } {
  return {
    required_sol: Math.max(0, (Number(params.required_sol) || 0) - (Number(params.orphan_sol) || 0)),
    required_usdc: Math.max(
      0,
      (Number(params.required_usdc) || 0) - (Number(params.orphan_usdc) || 0)
    ),
  }
}
