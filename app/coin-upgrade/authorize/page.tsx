import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { CoinArtUpgradeAuthorizeClient } from '@/components/coin-upgrade/CoinArtUpgradeAuthorizeClient'

export const dynamic = 'force-dynamic'

function Fallback() {
  return (
    <main className="container mx-auto px-4 py-10 max-w-lg flex justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </main>
  )
}

/**
 * Gembird-facing authorize page: connect collection update-authority wallet and
 * approve one UpdateDelegate tx. No admin session / CLI required.
 */
export default function CoinUpgradeAuthorizePage() {
  return (
    <Suspense fallback={<Fallback />}>
      <CoinArtUpgradeAuthorizeClient />
    </Suspense>
  )
}
