'use client'

/**
 * Error boundary for /dashboard. Catches errors so we show a friendly message
 * and retry instead of the global "Something went wrong" screen.
 */
import { useEffect } from 'react'
import Link from 'next/link'
import { LayoutDashboard, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[dashboard error boundary]', error?.message ?? error)
  }, [error])

  return (
    <main className="container mx-auto px-4 py-8 max-w-2xl min-h-[50vh] flex flex-col justify-center">
      <div className="flex flex-col items-center text-center gap-4">
        <LayoutDashboard className="h-12 w-12 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-bold">Couldn’t load dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Something went wrong loading your dashboard. This can happen on mobile when the wallet is still connecting. Try again or go home.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Button
            onClick={reset}
            className="min-h-[44px] min-w-[44px] touch-manipulation"
            type="button"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Try again
          </Button>
          <Button asChild variant="outline" className="min-h-[44px] touch-manipulation">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
