/**
 * On-chain CM deploy checkpoint parsing (safe for unit tests — no server-only).
 */

export type OnchainDeployStatus =
  | 'running'
  | 'loading_items'
  | 'cm_ready'
  | 'ua_handed_off'
  | 'completed'
  | 'failed'

export type OnchainDeployState = {
  status: OnchainDeployStatus
  candy_machine_id: string | null
  collection_mint: string | null
  candy_guard_id: string | null
  onchain_update_authority: string | null
  platform_update_delegate: string | null
  /** Config lines written on-chain so far (Core large deploys). */
  config_lines_loaded: number | null
  config_lines_total: number | null
  error: string | null
  completed_at: string | null
}

export function parseOnchainDeployState(
  progress: { onchain_deploy?: unknown } | Record<string, unknown> | null | undefined
): OnchainDeployState | null {
  const raw =
    progress && typeof progress === 'object' && 'onchain_deploy' in progress
      ? (progress as { onchain_deploy?: unknown }).onchain_deploy
      : undefined
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const status = o.status
  if (
    status !== 'running' &&
    status !== 'loading_items' &&
    status !== 'cm_ready' &&
    status !== 'ua_handed_off' &&
    status !== 'completed' &&
    status !== 'failed'
  ) {
    return null
  }
  const loadedRaw = o.config_lines_loaded
  const totalRaw = o.config_lines_total
  const loaded =
    typeof loadedRaw === 'number' && Number.isFinite(loadedRaw)
      ? Math.max(0, Math.floor(loadedRaw))
      : typeof loadedRaw === 'string' && Number.isFinite(Number(loadedRaw))
        ? Math.max(0, Math.floor(Number(loadedRaw)))
        : null
  const total =
    typeof totalRaw === 'number' && Number.isFinite(totalRaw)
      ? Math.max(0, Math.floor(totalRaw))
      : typeof totalRaw === 'string' && Number.isFinite(Number(totalRaw))
        ? Math.max(0, Math.floor(Number(totalRaw)))
        : null
  return {
    status: status as OnchainDeployStatus,
    candy_machine_id: typeof o.candy_machine_id === 'string' ? o.candy_machine_id : null,
    collection_mint: typeof o.collection_mint === 'string' ? o.collection_mint : null,
    candy_guard_id: typeof o.candy_guard_id === 'string' ? o.candy_guard_id : null,
    onchain_update_authority: typeof o.onchain_update_authority === 'string' ? o.onchain_update_authority : null,
    platform_update_delegate: typeof o.platform_update_delegate === 'string' ? o.platform_update_delegate : null,
    config_lines_loaded: loaded,
    config_lines_total: total,
    error: typeof o.error === 'string' ? o.error : null,
    completed_at: typeof o.completed_at === 'string' ? o.completed_at : null,
  }
}

/** True when all config lines are on-chain (or legacy checkpoint without line counts). */
export function configLinesFullyLoaded(state: OnchainDeployState | null | undefined): boolean {
  if (!state) return false
  if (state.config_lines_loaded == null || state.config_lines_total == null) {
    return Boolean(state.candy_machine_id && state.collection_mint)
  }
  return state.config_lines_loaded >= state.config_lines_total && state.config_lines_total > 0
}
