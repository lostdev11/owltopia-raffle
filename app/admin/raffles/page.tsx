import { getRaffles, getEntriesByRaffleId } from '@/lib/db/raffles'
import { getSupabaseConfigError } from '@/lib/supabase'
import { AdminRafflesPageClient } from './AdminRafflesPageClient'

// Force dynamic rendering to prevent caching stale data
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AdminRafflesPage() {
  // Check if Supabase is configured
  const configError = getSupabaseConfigError()
  if (configError) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6">
            <h1 className="text-2xl font-bold text-destructive mb-4">Configuration Error</h1>
            <p className="text-destructive mb-4">{configError}</p>
          </div>
        </div>
      </div>
    )
  }

  const { data: allRaffles, error: rafflesError } = await getRaffles(false)
  if (rafflesError) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6">
            <h1 className="text-2xl font-bold text-destructive mb-4">Could not load raffles</h1>
            <p className="text-destructive">{rafflesError.message}</p>
          </div>
        </div>
      </div>
    )
  }
  const now = new Date()
  const nowTime = now.getTime()

  const pastRaffles: typeof allRaffles = []
  const activeRaffles: typeof allRaffles = []
  const futureRaffles: typeof allRaffles = []

  for (const raffle of allRaffles) {
    const startTime = new Date(raffle.start_time)
    const endTime = new Date(raffle.end_time)
    const startTimeMs = startTime.getTime()
    const endTimeMs = endTime.getTime()
    
    // Skip invalid dates
    if (isNaN(startTimeMs) || isNaN(endTimeMs)) {
      pastRaffles.push(raffle)
      continue
    }
    
    // Past raffle: has winner, end time has passed, or is_active is false
    if (raffle.winner_selected_at || endTimeMs <= nowTime || !raffle.is_active) {
      pastRaffles.push(raffle)
      continue
    }
    
    // Future raffle: hasn't started yet (start time is strictly in the future)
    if (startTimeMs > nowTime) {
      futureRaffles.push(raffle)
      continue
    }
    
    // Active raffle: has started (startTime <= now), hasn't ended (endTime > now), and is_active
    if (startTimeMs <= nowTime && endTimeMs > nowTime && raffle.is_active) {
      activeRaffles.push(raffle)
      continue
    }
    
    // Fallback: treat as past if it doesn't match any category
    pastRaffles.push(raffle)
  }
  
  // Get entries for all raffles
  const getRafflesWithEntries = async (raffles: typeof allRaffles) => {
    return Promise.all(
      raffles.map(async raffle => {
        const entries = await getEntriesByRaffleId(raffle.id)
        return { raffle, entries }
      })
    )
  }
  
  const [pastRafflesWithEntries, activeRafflesWithEntries, futureRafflesWithEntries] = await Promise.all([
    getRafflesWithEntries(pastRaffles),
    getRafflesWithEntries(activeRaffles),
    getRafflesWithEntries(futureRaffles)
  ])

  return (
    <AdminRafflesPageClient
      activeRafflesWithEntries={activeRafflesWithEntries}
      futureRafflesWithEntries={futureRafflesWithEntries}
      pastRafflesWithEntries={pastRafflesWithEntries}
    />
  )
}
