import { CreateRaffleForm } from '@/components/CreateRaffleForm'
import { MyRafflesList } from './MyRafflesList'

// Avoid static prerender: this page uses wallet adapter code that fails during prerender (useMemo on null).
export const dynamic = 'force-dynamic'

export default function CreateRafflePage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-4xl font-bold">Create New Raffle</h1>
        <CreateRaffleForm />
        <div className="pt-8 border-t border-border/60">
          <MyRafflesList />
        </div>
      </div>
    </div>
  )
}
