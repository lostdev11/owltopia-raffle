import { CreateRaffleForm } from '@/components/CreateRaffleForm'
import { MyRafflesList } from '../MyRafflesList'

export const dynamic = 'force-dynamic'

export default function CreateSnsDomainRafflePage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-4xl font-bold">Create .sol domain raffle</h1>
        <p className="text-sm text-muted-foreground -mt-4">
          SNS hub only — same NFT escrow flow as other raffles, but listed under Raffles → .sol domains (not Main or
          Partner).
        </p>
        <CreateRaffleForm snsDomainHubFlow />
        <div className="pt-8 border-t border-border/60">
          <MyRafflesList />
        </div>
      </div>
    </div>
  )
}
