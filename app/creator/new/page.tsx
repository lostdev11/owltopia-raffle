import { CreateCreatorRaffleForm } from './CreateCreatorRaffleForm'

export const dynamic = 'force-dynamic'

export default function CreateCreatorRafflePage() {
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

  return <CreateCreatorRaffleForm />
}
