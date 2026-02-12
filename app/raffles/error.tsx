'use client'

/**
 * Error boundary for /raffles. Catches server and client errors so we show a friendly
 * message and 200 response instead of a 500 page.
 */
import { useEffect } from 'react'
import { RafflesPageClient } from './RafflesPageClient'

export default function RafflesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[raffles error boundary]', error?.message ?? error)
  }, [error])

  return (
    <div className="container mx-auto py-8 px-4">
      <RafflesPageClient
        activeRafflesWithEntries={[]}
        futureRafflesWithEntries={[]}
        pastRafflesWithEntries={[]}
        fetchStatus="error"
        initialError={{
          message: error?.message || 'Something went wrong loading raffles.',
          code: 'PAGE_ERROR',
        }}
      />
    </div>
  )
}
