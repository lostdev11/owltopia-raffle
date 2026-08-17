/**
 * Simulates Next.js App Router's history.replaceState patch.
 * Passing null/{} triggers ACTION_RESTORE; passing history.state (__NA) does not.
 * Run: npx tsx scripts/test-replace-client-url-next-patch.ts
 */
import assert from 'node:assert/strict'
import { replaceClientUrl } from '../lib/client/replace-url'

type Restore = { url: string }
type Call = { kind: 'original'; data: unknown; url: string } | { kind: 'restore'; url: string }

function copyNextJsInternalHistoryState(data: unknown, currentState: Record<string, unknown>) {
  const next = (data == null ? {} : { ...(data as object) }) as Record<string, unknown>
  if (currentState.__NA) next.__NA = currentState.__NA
  if (currentState.__PRIVATE_NEXTJS_INTERNALS_TREE) {
    next.__PRIVATE_NEXTJS_INTERNALS_TREE = currentState.__PRIVATE_NEXTJS_INTERNALS_TREE
  }
  return next
}

function installPatchedHistory(currentState: Record<string, unknown>) {
  const calls: Call[] = []
  let state = { ...currentState }
  const originalReplaceState = (data: unknown, _u: string, url?: string | null) => {
    state = data == null ? {} : { ...(data as object) }
    calls.push({ kind: 'original', data, url: String(url ?? '') })
  }
  const patchedReplaceState = (data: unknown, _u: string, url?: string | null) => {
    const incoming = data as { __NA?: boolean; _N?: boolean } | null
    if (incoming?.__NA || incoming?._N) {
      return originalReplaceState(data, _u, url)
    }
    const merged = copyNextJsInternalHistoryState(data, state)
    if (url) calls.push({ kind: 'restore', url: String(url) })
    return originalReplaceState(merged, _u, url)
  }
  return {
    calls,
    get state() {
      return state
    },
    history: {
      get state() {
        return state
      },
      replaceState: patchedReplaceState,
    },
  }
}

{
  const mock = installPatchedHistory({
    __NA: true,
    __PRIVATE_NEXTJS_INTERNALS_TREE: ['page-a'],
  })
  // Bad caller pattern (pre-fix): triggers restore
  mock.history.replaceState({}, '', '#perches')
  assert.equal(mock.calls.filter((c) => c.kind === 'restore').length, 1)
}

{
  const g = globalThis as typeof globalThis & { window?: Window & typeof globalThis }
  const prev = g.window
  const mock = installPatchedHistory({
    __NA: true,
    __PRIVATE_NEXTJS_INTERNALS_TREE: ['page-a'],
  })
  g.window = { history: mock.history } as unknown as Window & typeof globalThis
  try {
    replaceClientUrl('#perches')
    const restores = mock.calls.filter((c) => c.kind === 'restore') as Restore[]
    assert.equal(restores.length, 0, 'replaceClientUrl must not dispatch ACTION_RESTORE')
    assert.equal(mock.calls.length, 1)
    assert.equal(mock.calls[0]!.kind, 'original')
    assert.equal((mock.calls[0] as { url: string }).url, '#perches')
    assert.equal(mock.state.__NA, true)
  } finally {
    if (prev === undefined) delete g.window
    else g.window = prev
  }
}

console.log('ok: Next patch simulation — replaceClientUrl skips ACTION_RESTORE')
