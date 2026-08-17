/**
 * replaceClientUrl must preserve Next.js history.state (`__NA`) so App Router
 * does not dispatch ACTION_RESTORE and race client navigations.
 * Run: npx tsx scripts/test-replace-client-url.ts
 */
import assert from 'node:assert/strict'
import { replaceClientUrl } from '../lib/client/replace-url'

type HistoryCall = { data: unknown; url: string }

function withMockHistory(run: (calls: HistoryCall[]) => void) {
  const g = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis
  }
  const prevWindow = g.window
  const calls: HistoryCall[] = []
  const state = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['mock'] }

  g.window = {
    history: {
      state,
      replaceState(data: unknown, _unused: string, url?: string | null) {
        calls.push({ data, url: String(url ?? '') })
      },
    },
  } as unknown as Window & typeof globalThis

  try {
    run(calls)
  } finally {
    if (prevWindow === undefined) delete g.window
    else g.window = prevWindow
  }
}

withMockHistory((calls) => {
  replaceClientUrl('/raffles')
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url, '/raffles')
  assert.equal(calls[0]!.data, (globalThis as { window: Window }).window.history.state)
  assert.equal((calls[0]!.data as { __NA?: boolean }).__NA, true)
})

withMockHistory((calls) => {
  replaceClientUrl('#perches')
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url, '#perches')
  assert.notEqual(calls[0]!.data, null)
  assert.deepEqual(calls[0]!.data, { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['mock'] })
})

// No window → no throw
const g = globalThis as typeof globalThis & { window?: Window & typeof globalThis }
const prev = g.window
delete g.window
assert.doesNotThrow(() => replaceClientUrl('/dashboard'))
if (prev !== undefined) g.window = prev

console.log('ok: replaceClientUrl preserves Next history state')
