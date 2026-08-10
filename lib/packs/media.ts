/**
 * Pack opening media. Drop the asset at this public path (or override via env).
 * Client-safe: only NEXT_PUBLIC_* is read in the browser.
 *
 * Default is the QuickTime clip from ops (`owl-pack-open.mov`). Prefer mp4 when
 * available (set NEXT_PUBLIC_PACK_OPEN_VIDEO_URL=/videos/owl-pack-open.mp4).
 */
export const PACK_OPEN_VIDEO_SRC =
  (typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_PACK_OPEN_VIDEO_URL?.trim()) ||
  '/videos/owl-pack-open.mov'

/** Poster / idle art while the video is not playing */
export const PACK_OPEN_VIDEO_POSTER =
  (typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_PACK_OPEN_VIDEO_POSTER?.trim()) ||
  '/logo.gif'
