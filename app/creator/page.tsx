import { getRaffles } from '@/lib/db/raffles'
import { CreatorRafflesClient } from './CreatorRafflesClient'

export const dynamic = 'force-dynamic'

export default async function CreatorPage() {
  // Check feature flag
  if (process.env.NEXT_PUBLIC_MARKETPLACE_ENABLED !== 'true') {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold">Marketplace not enabled</h1>
        <p className="text-muted-foreground mt-2">
          The creator marketplace feature is not currently enabled.
        </p>
      </div>
    )
  }

  // Fetch all raffles (client will filter by wallet)
  const raffles = await getRaffles(false)

  return <CreatorRafflesClient initialRaffles={raffles} />
}
