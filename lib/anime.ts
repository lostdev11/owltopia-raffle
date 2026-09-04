type AnimeModule = typeof import('animejs')

let animePromise: Promise<AnimeModule | null> | null = null

/**
 * Client-only Anime.js loader. Safe to call during SSR: no-op until `window` exists.
 * Bundled from npm (CSP `'self'`); do not load Anime.js from a CDN.
 */
function getAnime() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (!animePromise) {
    animePromise = import('animejs')
  }
  return animePromise
}

/** Preload the module so the first animation starts without a network/parse hitch. */
export function preloadAnime(): void {
  getAnime().catch(() => {})
}

/**
 * Resolve Anime.js in the browser only. Pass element refs or fixed selectors — never
 * untrusted user strings as CSS selectors or animation config keys.
 */
export function loadAnime(): Promise<AnimeModule | null> {
  return getAnime().catch((err) => {
    if (process.env.NODE_ENV === 'development') {
      console.warn('Anime.js failed to load:', err)
    }
    return null
  })
}
