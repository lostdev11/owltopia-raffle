/**
 * Shared CM deploy limits (safe to import from unit tests — no server-only).
 */

/** Hard cap for Token Metadata (legacy) one-shot server deploy. */
export const OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY = 250

/** Soft safety ceiling for Core in-app deploy (resumable across requests). */
export function owlCenterCoreServerCmDeployMaxSupply(): number {
  const raw = process.env.OWL_CENTER_CORE_SERVER_CM_DEPLOY_MAX_SUPPLY
  const n = raw ? Number.parseInt(raw, 10) : 10_000
  if (!Number.isFinite(n) || n < 1) return 10_000
  return Math.min(n, 50_000)
}

/** Wall-clock budget for one Core config-line loading invocation (under route maxDuration 300s). */
export function owlCenterCoreDeployLoadTimeBudgetMs(): number {
  const raw = process.env.OWL_CENTER_CORE_DEPLOY_LOAD_TIME_BUDGET_MS
  const n = raw ? Number.parseInt(raw, 10) : NaN
  if (Number.isFinite(n) && n >= 10_000) return Math.min(n, 280_000)
  return 250_000
}
