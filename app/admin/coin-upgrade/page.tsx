import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { AdminCoinArtUpgradeClient } from '@/components/coin-upgrade/AdminCoinArtUpgradeClient'

export const dynamic = 'force-dynamic'

function Fallback() {
  return (
    <main className="container mx-auto px-4 py-10 max-w-3xl flex justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </main>
  )
}

export default function AdminCoinUpgradePage() {
  return (
    <Suspense fallback={<Fallback />}>
      <AdminCoinArtUpgradeClient />
    </Suspense>
  )
}
