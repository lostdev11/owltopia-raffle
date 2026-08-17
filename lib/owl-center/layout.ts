/** Shared horizontal gutters for Owl Center nav + page shell (matches raffles mobile safe-area rhythm). */
export const OWL_CENTER_PAGE_GUTTER =
  'mx-auto box-border w-full min-w-0 max-w-6xl pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] sm:px-4' as const

/** Compact launch cards — fixed-ish tile width so square covers stay readable, not full-bleed. */
export const OWL_CENTER_COLLECTION_CARD_GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(240px,300px))] justify-start gap-4' as const
