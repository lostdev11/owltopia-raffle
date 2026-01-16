import { CreateRaffleForm } from '@/components/CreateRaffleForm'

export default function CreateRafflePage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Create New Raffle</h1>
        <CreateRaffleForm />
      </div>
    </div>
  )
}
