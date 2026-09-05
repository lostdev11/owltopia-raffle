/**
 * Pure affordability checks for the Gen Owl rev-share pool (no Solana RPC imports).
 */

/** Network fee headroom reserved on the pool wallet for each SOL payout tx. */
export const GEN_OWL_REV_SHARE_SOL_FEE_BUFFER_LAMPORTS = 15_000
const LAMPORTS_PER_SOL = 1_000_000_000

export type GenOwlRevSharePoolAffordability = {
  ok: boolean
  need_sol: number
  need_usdc: number
  hold_sol: number | null
  hold_usdc: number | null
  shortfall_sol: number
  shortfall_usdc: number
  error: string | null
}

/** Pure affordability check from known balances (unit-testable; used by live assess). */
export function evaluateGenOwlRevSharePoolAffordabilityFromBalances(params: {
  amount_sol: number
  amount_usdc: number
  hold_sol: number | null
  hold_usdc: number | null
  configured?: boolean
}): GenOwlRevSharePoolAffordability {
  const amountSol = Number(params.amount_sol) || 0
  const amountUsdc = Number(params.amount_usdc) || 0
  const needSol = amountSol > 0
  const needUsdc = amountUsdc > 0
  const configured = params.configured !== false

  if (!needSol && !needUsdc) {
    return {
      ok: false,
      need_sol: 0,
      need_usdc: 0,
      hold_sol: params.hold_sol,
      hold_usdc: params.hold_usdc,
      shortfall_sol: 0,
      shortfall_usdc: 0,
      error: 'Nothing to pay.',
    }
  }

  if (!configured) {
    return {
      ok: false,
      need_sol: amountSol,
      need_usdc: amountUsdc,
      hold_sol: params.hold_sol,
      hold_usdc: params.hold_usdc,
      shortfall_sol: amountSol,
      shortfall_usdc: amountUsdc,
      error:
        'Rev share pool is not configured. Set GEN_OWL_REV_SHARE_POOL_SECRET_KEY (and matching GEN_OWL_REV_SHARE_POOL_WALLET if used).',
    }
  }

  const feeBufferSol =
    (needSol && needUsdc
      ? GEN_OWL_REV_SHARE_SOL_FEE_BUFFER_LAMPORTS * 2
      : needSol
        ? GEN_OWL_REV_SHARE_SOL_FEE_BUFFER_LAMPORTS
        : 0) / LAMPORTS_PER_SOL
  const needSolWithFee = needSol ? amountSol + feeBufferSol : 0
  const holdSol = params.hold_sol
  const holdUsdc = params.hold_usdc

  let shortfallSol = 0
  let shortfallUsdc = 0
  const errors: string[] = []

  if (needSol) {
    if (holdSol == null) {
      errors.push('Could not read rev-share pool SOL balance. Try again in a moment.')
    } else if (holdSol < needSolWithFee) {
      shortfallSol = needSolWithFee - holdSol
      errors.push(
        `Rev share pool is short of SOL for this payout: it needs about ` +
          `${needSolWithFee.toFixed(5)} SOL (incl. network fee) but holds ` +
          `${holdSol.toFixed(5)}. Ask an admin to deposit into the rev-share pool.`
      )
    }
  }

  if (needUsdc) {
    if (holdUsdc == null) {
      errors.push('Could not read rev-share pool USDC balance. Try again in a moment.')
    } else if (holdUsdc < amountUsdc) {
      shortfallUsdc = amountUsdc - holdUsdc
      errors.push(
        `Rev share pool is short of USDC for this payout: it needs ` +
          `${amountUsdc} USDC but holds ${holdUsdc}. Ask an admin to deposit into the rev-share pool.`
      )
    }
  }

  return {
    ok: errors.length === 0,
    need_sol: needSolWithFee,
    need_usdc: needUsdc ? amountUsdc : 0,
    hold_sol: holdSol,
    hold_usdc: holdUsdc,
    shortfall_sol: shortfallSol,
    shortfall_usdc: shortfallUsdc,
    error: errors.length ? errors.join(' · ') : null,
  }
}
