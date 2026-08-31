/**
 * Pack opening media. Prefer `@/lib/packs/animations` for the two-clip cinematic.
 * Kept for backwards compatibility with older PackOpenVideo usage / env overrides.
 */
import { PACK_ANIMATIONS, PACK_ANIMATION_POSTER } from '@/lib/packs/animations'

export const PACK_OPEN_VIDEO_SRC =
  (typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_PACK_OPEN_VIDEO_URL?.trim()) ||
  PACK_ANIMATIONS.opening

/** Poster / idle art while the video is not playing */
export const PACK_OPEN_VIDEO_POSTER = PACK_ANIMATION_POSTER

/** $OWL prize art shown on pack reveal (OWL category wins). */
export const PACK_OWL_PRIZE_IMAGE = '/images/packs-owl-prize.jpg'

export function getPackRewardPreloadUrl(reward: {
  category: string
  nftImageUrl?: string | null
}): string | null {
  if (reward.category === 'nft' && reward.nftImageUrl) return reward.nftImageUrl
  if (reward.category === 'owl') return PACK_OWL_PRIZE_IMAGE
  return null
}

export { PACK_ANIMATIONS, PACK_ANIMATION_POSTER }
