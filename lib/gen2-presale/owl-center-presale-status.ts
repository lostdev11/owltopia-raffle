import { buildGen2PresalePublicStats } from '@/lib/gen2-presale/public-stats'
import { isGen2PresaleSoldOut } from '@/lib/gen2-presale/purchase-availability'

/** Server-side sold-out flag for Owl Center CTAs (featured launch, collection cards). */
export async function getGen2PresaleSoldOutForDisplay(): Promise<boolean> {
  const stats = await buildGen2PresalePublicStats().catch(() => null)
  return isGen2PresaleSoldOut(stats)
}
