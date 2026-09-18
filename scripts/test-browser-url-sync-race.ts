/**
 * End-to-end simulation: address bar stuck on previous path after soft nav,
 * then BrowserUrlSync corrects it so copy-link gets the current URL.
 *
 * Run: npx tsx scripts/test-browser-url-sync-race.ts
 */
import assert from 'node:assert/strict'
import { buildPathHashUrl, buildSyncedBrowserUrl } from '../lib/client/browser-url-sync'
import { replaceClientUrl } from '../lib/client/replace-url'

type GlobalWithOptionalWindow = Omit<typeof globalThis, 'window'> & {
  window?: Window & typeof globalThis
}

function installHistory(initialPath: string) {
  let path = initialPath
  let state: Record<string, unknown> = {
    __NA: true,
    __PRIVATE_NEXTJS_INTERNALS_TREE: ['page'],
  }
  const history = {
    get state() {
      return state
    },
    replaceState(data: unknown, _u: string, url?: string | null) {
      state = data == null ? {} : { ...(data as object) }
      if (url != null && url !== '') {
        if (url.startsWith('#')) {
          path = path.split('#')[0]! + url
        } else {
          path = String(url)
        }
      }
    },
  }
  return {
    history,
    get pathname() {
      return path.split('?')[0]!.split('#')[0]!
    },
    get href() {
      return `https://www.owltopia.xyz${path}`
    },
    get locationPath() {
      return path
    },
  }
}

{
  // 1) Soft-nav race: bar still on /nesting while router is on /raffles/owl-drop
  const mock = installHistory('/nesting')
  const g = globalThis as GlobalWithOptionalWindow
  const prev = g.window
  g.window = {
    history: mock.history,
    location: {
      get pathname() {
        return mock.pathname
      },
      get href() {
        return mock.href
      },
    },
  } as unknown as Window & typeof globalThis

  try {
    const routerPath = '/raffles/owl-drop'
    const routerSearch = 'ref=abc'
    assert.notEqual(mock.pathname, routerPath, 'precondition: bar is stale')

    const next = buildSyncedBrowserUrl({
      routerPathname: routerPath,
      routerSearch,
      browserPathname: mock.pathname,
    })
    assert.equal(next, '/raffles/owl-drop?ref=abc')
    replaceClientUrl(next!)

    assert.equal(mock.locationPath, '/raffles/owl-drop?ref=abc')
    assert.equal(mock.href, 'https://www.owltopia.xyz/raffles/owl-drop?ref=abc')
    assert.equal(mock.history.state.__NA, true, 'must preserve Next __NA state')
  } finally {
    if (prev === undefined) delete g.window
    else g.window = prev
  }
}

{
  // 2) Hash-only update on a drifted bar would keep the wrong path — absolute path fixes it
  const mock = installHistory('/dashboard') // drifted
  const g = globalThis as GlobalWithOptionalWindow
  const prev = g.window
  g.window = { history: mock.history } as unknown as Window & typeof globalThis
  try {
    // Bad pattern (pre-fix): attach hash to drifted path
    replaceClientUrl('#perches')
    assert.equal(mock.locationPath, '/dashboard#perches')

    // Good pattern: App Router pathname + hash
    replaceClientUrl(buildPathHashUrl('/nesting', 'perches'))
    assert.equal(mock.locationPath, '/nesting#perches')
    assert.equal(mock.href, 'https://www.owltopia.xyz/nesting#perches')
  } finally {
    if (prev === undefined) delete g.window
    else g.window = prev
  }
}

console.log('ok: browser URL sync race — copy-link gets current page URL')
