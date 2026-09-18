/**
 * Pure helpers for Phase B CM deploy panel messaging (unit-testable).
 */

export type DeployProgressSnapshot = {
  fully_deployed?: boolean
  candy_machine_id?: string | null
  collection_mint?: string | null
  in_progress_candy_machine_id?: string | null
  in_progress_collection_mint?: string | null
  config_line_count?: number | null
  deploy_state?: {
    status?: string | null
    error?: string | null
    candy_guard_id?: string | null
    config_lines_loaded?: number | null
    config_lines_total?: number | null
  } | null
}

export function isDeployWorkInProgress(status: DeployProgressSnapshot | null | undefined): boolean {
  if (!status || status.fully_deployed) return false
  const s = status.deploy_state?.status
  return s === 'running' || s === 'loading_items' || s === 'cm_ready' || s === 'ua_handed_off'
}

export function deployPhaseLabel(status: string | undefined | null): string | null {
  switch (status) {
    case 'running':
      return 'Creating Candy Machine on-chain…'
    case 'loading_items':
      return 'Loading config lines on-chain…'
    case 'cm_ready':
      return 'Candy Machine ready — handing off update authority…'
    case 'ua_handed_off':
      return 'Authority handed off — finalizing…'
    case 'completed':
      return 'Deploy complete'
    case 'failed':
      return 'Deploy failed'
    default:
      return null
  }
}

export function formatConfigLineProgress(status: DeployProgressSnapshot | null | undefined): string | null {
  const loaded = status?.deploy_state?.config_lines_loaded
  const total =
    status?.deploy_state?.config_lines_total ?? status?.config_line_count ?? null
  if (typeof loaded !== 'number' || typeof total !== 'number' || total <= 0) return null
  const pct = Math.min(100, Math.round((loaded / total) * 100))
  return `${loaded} / ${total} items (${pct}%)`
}

export function configLineProgressPercent(status: DeployProgressSnapshot | null | undefined): number | null {
  const loaded = status?.deploy_state?.config_lines_loaded
  const total =
    status?.deploy_state?.config_lines_total ?? status?.config_line_count ?? null
  if (typeof loaded !== 'number' || typeof total !== 'number' || total <= 0) return null
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)))
}

export function formatDeploySuccessMessage(input: {
  candyMachineId: string
  collectionMint: string
  alreadyDeployed?: boolean
  goLiveOk?: boolean
  alreadyLive?: boolean
  blockers?: string[]
}): string {
  const cmShort = `${input.candyMachineId.slice(0, 8)}…`
  const prefix = input.alreadyDeployed
    ? `Success — Candy Machine already on-chain (CM ${cmShort}). IDs synced.`
    : `Success — Candy Machine deployed (CM ${cmShort}).`

  if (input.goLiveOk && input.alreadyLive) {
    return `${prefix} Launch is already live on the public mint page.`
  }
  if (input.goLiveOk) {
    return `${prefix} Launch auto-approved — collection is live to mint.`
  }
  const blockers =
    input.blockers?.join(' ') ?? 'Complete metadata checklist, then Approve & go live above.'
  return `${prefix} IDs saved. Go-live pending: ${blockers}`
}

/** True when a fetch failure is likely a timeout/abort while the server may still be working. */
export function isLikelyDeployTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('the operation was aborted')
  )
}
