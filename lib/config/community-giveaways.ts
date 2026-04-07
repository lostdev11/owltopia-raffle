/** Base draw weight (one pool entry per wallet). */
export const COMMUNITY_GIVEAWAY_WEIGHT_DEFAULT = 1

/** SPL OWL sent to raffle treasury per +1 draw weight (before giveaway starts_at). */
export const COMMUNITY_GIVEAWAY_OWL_PER_EXTRA_ENTRY = 1

/** Max additional weight from OWL (3 extra → max total draw_weight 4). */
export const COMMUNITY_GIVEAWAY_MAX_EXTRA_WEIGHT = 3

export const COMMUNITY_GIVEAWAY_MAX_DRAW_WEIGHT =
  COMMUNITY_GIVEAWAY_WEIGHT_DEFAULT + COMMUNITY_GIVEAWAY_MAX_EXTRA_WEIGHT
