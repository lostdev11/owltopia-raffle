/**
 * Centralized pack cinematic media paths.
 * Assets live under /public/Animations/ (exact filenames preserved).
 *
 * Prefer H.264 mp4 for the opening clip. Hover uses VP9 WebM with alpha
 * and an H.264 mp4 fallback composited on the packs page color.
 */

export const PACK_ANIMATIONS = {
  /** Looping sealed pack — VP9 + alpha (Chromium / Firefox desktop). */
  hovering: '/Animations/Pack%20hover.webm',
  /** Smaller VP9 + alpha for phones (400px / 20fps). */
  hoveringMobile: '/Animations/Pack%20hover.mobile.webm',
  /**
   * Animated WebP + alpha. Used on iOS / WebKit where WebM alpha is ignored
   * and the MP4 fallback would show a solid rectangle.
   */
  hoveringAlpha: '/Animations/Pack%20hover.webp',
  /** H.264 last-resort fallback (opaque, page-colored). */
  hoveringFallback: '/Animations/Pack%20hover.mp4',
  /** Plays once after purchase + reward are confirmed. */
  opening: '/Animations/Pack%20opening.mp4',
} as const

/** Poster while videos buffer */
export const PACK_ANIMATION_POSTER =
  (typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_PACK_OPEN_VIDEO_POSTER?.trim()) ||
  '/logo.gif'

/**
 * Reveal timing (ms) after white overlay begins fading.
 * Kept in one place so UI stages stay in sync.
 */
export const PACK_REVEAL_TIMING = {
  whiteFadeMs: 700,
  rewardEnterDelayMs: 150,
  rewardSettleMs: 750,
  nameAppearMs: 800,
  metaAppearMs: 950,
  controlsAppearMs: 1100,
  videoCrossfadeMs: 120,
  /** Last-resort hung-video escape — not used as the primary end signal. */
  openFailsafeMs: 15000,
  hoverReadyFallbackMs: 1200,
  rewardImageGraceMs: 4000,
} as const

export type PackRevealCategory = 'owl' | 'sol' | 'nft' | string

/**
 * Subtle per-category reveal intensity (not a layout change).
 * Packs do not expose a separate rarity enum — category is the signal.
 */
export const PACK_CATEGORY_REVEAL = {
  owl: {
    glowOpacity: 0.22,
    ringOpacity: 0.45,
    entranceScale: 1.06,
    pulseStrength: 0.9,
  },
  sol: {
    glowOpacity: 0.28,
    ringOpacity: 0.55,
    entranceScale: 1.08,
    pulseStrength: 1,
  },
  nft: {
    glowOpacity: 0.34,
    ringOpacity: 0.7,
    entranceScale: 1.1,
    pulseStrength: 1.15,
  },
  jackpot: {
    glowOpacity: 0.42,
    ringOpacity: 0.85,
    entranceScale: 1.14,
    pulseStrength: 1.35,
  },
} as const

export function getPackCategoryReveal(category: PackRevealCategory) {
  if (
    category === 'owl' ||
    category === 'sol' ||
    category === 'nft' ||
    category === 'jackpot'
  ) {
    return PACK_CATEGORY_REVEAL[category === 'jackpot' ? 'jackpot' : category]
  }
  return PACK_CATEGORY_REVEAL.owl
}

const WARMUP_ATTR = 'data-pack-anim-warmup'

function ensureWarmupVideo(container: HTMLElement, src: string) {
  const videos = container.querySelectorAll('video')
  for (let i = 0; i < videos.length; i++) {
    if (videos[i].getAttribute(WARMUP_ATTR) === src) return
  }
  const v = document.createElement('video')
  v.setAttribute(WARMUP_ATTR, src)
  v.preload = 'auto'
  v.muted = true
  v.playsInline = true
  v.setAttribute('playsinline', '')
  v.src = src
  v.load()
  container.appendChild(v)
}

/**
 * Warm the opening clip only. Hover is already on-screen — preloading every
 * hover format (plus a 6MB opening mp4) made mobile decode stutter.
 */
export function preloadPackAnimationVideos(opts?: { opening?: boolean }): void {
  if (typeof document === 'undefined') return
  if (!opts?.opening) return

  const href = PACK_ANIMATIONS.opening
  if (!document.querySelector(`link[data-pack-anim="${href}"]`)) {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'video'
    link.href = href
    link.setAttribute('data-pack-anim', href)
    document.head.appendChild(link)
  }

  let container = document.getElementById('pack-animation-warmup')
  if (!container) {
    container = document.createElement('div')
    container.id = 'pack-animation-warmup'
    container.setAttribute('aria-hidden', 'true')
    container.style.cssText =
      'position:fixed;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);pointer-events:none;opacity:0'
    document.body.appendChild(container)
  }

  ensureWarmupVideo(container, href)
}
