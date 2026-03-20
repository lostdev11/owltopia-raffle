import { MyRafflesList } from '../new/MyRafflesList'

export const dynamic = 'force-dynamic'

export default function DeletedRafflesPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <MyRafflesList deletedOnly />
      </div>
    </div>
  )
}
