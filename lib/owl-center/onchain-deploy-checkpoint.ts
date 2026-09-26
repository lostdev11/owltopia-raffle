import type { OnchainDeployHistoryEntry, OnchainDeployState } from '@/lib/owl-center/onchain-deploy-state'

const ID_KEYS = ['candy_machine_id', 'collection_mint', 'candy_guard_id'] as const

export function onchainDeployHasSavedIds(state: OnchainDeployState | null | undefined): boolean {
  if (!state) return false
  return Boolean(
    (state.candy_machine_id && state.candy_machine_id.trim()) ||
      (state.collection_mint && state.collection_mint.trim()) ||
      (state.candy_guard_id && state.candy_guard_id.trim())
  )
}

/**
 * Merge a deploy checkpoint patch without clobbering saved pubkeys with null/empty.
 */
export function mergeOnchainDeployPatch(
  existing: OnchainDeployState | null | undefined,
  patch: Partial<OnchainDeployState> & Pick<OnchainDeployState, 'status'>
): OnchainDeployState {
  const base: OnchainDeployState = {
    status: patch.status,
    candy_machine_id: patch.candy_machine_id ?? existing?.candy_machine_id ?? null,
    collection_mint: patch.collection_mint ?? existing?.collection_mint ?? null,
    candy_guard_id: patch.candy_guard_id ?? existing?.candy_guard_id ?? null,
    onchain_update_authority:
      patch.onchain_update_authority ?? existing?.onchain_update_authority ?? null,
    platform_update_delegate:
      patch.platform_update_delegate ?? existing?.platform_update_delegate ?? null,
    config_lines_loaded: patch.config_lines_loaded ?? existing?.config_lines_loaded ?? null,
    config_lines_total: patch.config_lines_total ?? existing?.config_lines_total ?? null,
    error: patch.error !== undefined ? patch.error : (existing?.error ?? null),
    completed_at: patch.completed_at !== undefined ? patch.completed_at : (existing?.completed_at ?? null),
    history: existing?.history,
  }

  for (const key of ID_KEYS) {
    const next = patch[key]
    const prev = existing?.[key]
    if ((next === null || next === undefined || next === '') && prev) {
      base[key] = prev
    } else if (typeof next === 'string' && next.trim()) {
      base[key] = next.trim()
    }
  }

  if (patch.history?.length) {
    base.history = appendDeployHistory(base.history, patch.history)
  }

  return base
}

export function appendDeployHistory(
  existing: OnchainDeployHistoryEntry[] | undefined,
  entries: OnchainDeployHistoryEntry[]
): OnchainDeployHistoryEntry[] {
  return [...(existing ?? []), ...entries]
}

export function deployHistoryEntry(input: {
  label: string
  address?: string | null
  signature?: string | null
}): OnchainDeployHistoryEntry {
  return {
    at: new Date().toISOString(),
    label: input.label,
    address: input.address ?? null,
    signature: input.signature ?? null,
  }
}
