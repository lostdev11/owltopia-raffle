import { getRaffles, getEntriesByRaffleId } from '@/lib/db/raffles'
import { getSupabaseConfigError } from '@/lib/supabase'
import { RafflesPageClient } from './RafflesPageClient'

// Force dynamic rendering to prevent caching stale data
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function RafflesPage() {
  // Check if Supabase is configured
  const configError = getSupabaseConfigError()
  if (configError) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6">
            <h1 className="text-2xl font-bold text-destructive mb-4">Configuration Error</h1>
            <p className="text-destructive mb-4">{configError}</p>
            <p className="text-sm text-muted-foreground mb-4">
              Please create a <code className="bg-muted px-1 py-0.5 rounded">.env.local</code> file in the root of your project with:
            </p>
            <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
{`NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key`}
            </pre>
            <p className="text-sm text-muted-foreground mt-4">
              See README.md for detailed setup instructions.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const allRaffles = await getRaffles(false) // get all raffles
  const now = new Date()
  const nowTime = now.getTime()
  
  // Categorize raffles
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
    
    // Active raffle: endTime > now AND is_active (matching RaffleCard logic exactly)
    // This includes raffles that haven't started yet (startTime > now) if they're active
    if (endTimeMs > nowTime && raffle.is_active) {
      activeRaffles.push(raffle)
      continue
    }
    
    // Future raffle: hasn't started yet (start time is strictly in the future)
    // This catches raffles that don't match Active criteria but haven't started
    if (startTimeMs > nowTime) {
      futureRaffles.push(raffle)
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
    <RafflesPageClient
      activeRafflesWithEntries={activeRafflesWithEntries}
      futureRafflesWithEntries={futureRafflesWithEntries}
      pastRafflesWithEntries={pastRafflesWithEntries}
    />
  )
}
