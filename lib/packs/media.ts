/**
 * Pack opening media. Drop the asset at this public path (or override via env).
 * Client-safe: only NEXT_PUBLIC_* is read in the browser.
 */
export const PACK_OPEN_VIDEO_SRC =
  (typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_PACK_OPEN_VIDEO_URL?.trim()) ||
  '/videos/owl-pack-open.mp4'

/** Poster / idle art while the video is not playing */
export const PACK_OPEN_VIDEO_POSTER =
  (typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_PACK_OPEN_VIDEO_POSTER?.trim()) ||
  '/logo.gif'
