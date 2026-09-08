import { notFound } from 'next/navigation'
import { OwlSwapUiPreviewClient } from '@/components/owl-swap/trading-room/OwlSwapUiPreviewClient'

export const dynamic = 'force-dynamic'

/**
 * Visual QA only — not linked in nav. Enable with OWL_SWAP_UI_PREVIEW=true.
 * Does not flip OWL_SWAP_PUBLIC.
 */
export default function OwlSwapUiPreviewPage() {
  const enabled =
    process.env.OWL_SWAP_UI_PREVIEW === 'true' ||
    process.env.NEXT_PUBLIC_OWL_SWAP_UI_PREVIEW === 'true'
  if (!enabled) notFound()
  return <OwlSwapUiPreviewClient />
}
