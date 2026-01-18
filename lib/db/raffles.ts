import { supabase } from '@/lib/supabase'
import type { Raffle, Entry } from '@/lib/types'

export async function getRaffles(activeOnly: boolean = false) {
  let query = supabase.from('raffles').select('*').order('created_at', { ascending: false })

  if (activeOnly) {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching raffles:', error)
    return []
  }

  return (data || []) as Raffle[]
}

export async function getRaffleBySlug(slug: string) {
  const { data, error } = await supabase
    .from('raffles')
    .select('*')
    .eq('slug', slug)
    .single()

  if (error) {
    console.error('Error fetching raffle:', error)
    return null
  }

  return data as Raffle
}

export async function getRaffleById(id: string) {
  const { data, error } = await supabase
    .from('raffles')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('Error fetching raffle:', error)
    return null
  }

  return data as Raffle
}

export async function getEntriesByRaffleId(raffleId: string) {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('raffle_id', raffleId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching entries:', error)
    return []
  }

  return (data || []) as Entry[]
}

/**
 * Generate a unique slug from a title by checking for duplicates
 * If the slug already exists, appends a number (e.g., "my-raffle-2")
 */
export async function generateUniqueSlug(baseSlug: string): Promise<string> {
  let slug = baseSlug
  let counter = 1
  
  // Check if slug exists, and if so, append a number
  while (true) {
    const existing = await getRaffleBySlug(slug)
    
    if (!existing) {
      // Slug is available
      return slug
    }
    
    // Slug exists, try with a number appended
    counter++
    slug = `${baseSlug}-${counter}`
    
    // Safety check to prevent infinite loops
    if (counter > 1000) {
      // Fallback to timestamp-based slug
      slug = `${baseSlug}-${Date.now()}`
      break
    }
  }
  
  return slug
}

export async function createRaffle(raffle: Omit<Raffle, 'id' | 'created_at' | 'updated_at'>) {
  // Build insert object conditionally to handle cases where NFT columns might not exist
  // Only include NFT fields if prize_type is 'nft' or if they have values
  const insertData: any = {
    slug: raffle.slug,
    title: raffle.title,
    description: raffle.description,
    image_url: raffle.image_url,
    prize_type: raffle.prize_type,
    prize_amount: raffle.prize_amount,
    prize_currency: raffle.prize_currency,
    ticket_price: raffle.ticket_price,
    currency: raffle.currency,
    max_tickets: raffle.max_tickets,
    min_tickets: raffle.min_tickets,
    start_time: raffle.start_time,
    end_time: raffle.end_time,
    theme_accent: raffle.theme_accent,
    edited_after_entries: raffle.edited_after_entries,
    created_by: raffle.created_by,
    is_active: raffle.is_active,
    winner_wallet: raffle.winner_wallet,
    winner_selected_at: raffle.winner_selected_at,
    status: raffle.status ?? null,
  }

  // Only include NFT fields if prize_type is 'nft' or if NFT fields are provided
  // This helps avoid errors if the migration hasn't been run yet
  if (raffle.prize_type === 'nft' || raffle.nft_mint_address || raffle.nft_token_id || 
      raffle.nft_collection_name || raffle.nft_metadata_uri) {
    insertData.nft_mint_address = raffle.nft_mint_address
    insertData.nft_token_id = raffle.nft_token_id
    insertData.nft_collection_name = raffle.nft_collection_name
    insertData.nft_metadata_uri = raffle.nft_metadata_uri
  }

  const { data, error } = await supabase
    .from('raffles')
    .insert(insertData)
    .select()
    .single()

  if (error) {
    console.error('Error creating raffle:', error)
    console.error('Raffle data attempted:', JSON.stringify(insertData, null, 2))
    
    // Handle duplicate slug error
    if (error.message?.includes('raffles_slug_key') || 
        error.message?.includes('duplicate key') ||
        error.message?.includes('unique constraint')) {
      throw new Error(
        `A raffle with the slug "${raffle.slug}" already exists. Please use a different title.`
      )
    }
    
    // Provide helpful error message if NFT columns are missing
    if (error.message?.includes('nft_collection_name') || 
        error.message?.includes('nft_mint_address') ||
        error.message?.includes('nft_token_id') ||
        error.message?.includes('nft_metadata_uri') ||
        error.message?.includes('schema cache')) {
      throw new Error(
        `Database migration missing: The NFT support migration (006_add_nft_support.sql) has not been applied to your database. ` +
        `Please run the migration to add NFT support columns to the raffles table.`
      )
    }
    
    // Return error details for debugging
    throw new Error(`Database error: ${error.message}`)
  }

  return data as Raffle
}

export async function updateRaffle(
  id: string,
  updates: Partial<Raffle> & { edited_after_entries?: boolean }
) {
  // Check if there are confirmed entries before updating
  const existingEntries = await getEntriesByRaffleId(id)
  const hasConfirmedEntries = existingEntries.some(e => e.status === 'confirmed')

  if (hasConfirmedEntries && !updates.edited_after_entries) {
    updates.edited_after_entries = true
  }

  const { data, error } = await supabase
    .from('raffles')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating raffle:', error)
    console.error('Update data:', JSON.stringify(updates, null, 2))
    console.error('Raffle ID:', id)
    throw new Error(`Database error updating raffle: ${error.message}`)
  }

  return data as Raffle
}

export async function deleteRaffle(id: string) {
  const { error, data } = await supabase
    .from('raffles')
    .delete()
    .eq('id', id)
    .select()

  if (error) {
    console.error('Error deleting raffle:', error)
    console.error('Error details:', JSON.stringify(error, null, 2))
    return false
  }

  // Check if any rows were actually deleted
  if (!data || data.length === 0) {
    console.warn('No raffle found with id:', id)
    return false
  }

  console.log('Successfully deleted raffle:', id)
  return true
}

/**
 * Select a winner for a raffle based on weighted random selection.
 * Each wallet's chance is proportional to their total ticket quantity.
 * Only considers confirmed entries.
 * Checks if raffle meets minimum requirements before drawing.
 * 
 * @param raffleId - The ID of the raffle
 * @param forceOverride - If true, bypass minimum check (for admin override)
 * @returns The winner's wallet address, or null if no valid entries or minimum not met
 */
export async function selectWinner(raffleId: string, forceOverride: boolean = false): Promise<string | null> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) {
    console.warn(`Raffle not found: ${raffleId}`)
    return null
  }

  // Get all confirmed entries for this raffle
  const entries = await getEntriesByRaffleId(raffleId)
  const confirmedEntries = entries.filter(e => e.status === 'confirmed')

  if (confirmedEntries.length === 0) {
    console.warn(`No confirmed entries found for raffle ${raffleId}`)
    return null
  }

  // Check minimum requirements unless override is forced
  if (!forceOverride && !isRaffleEligibleToDraw(raffle, entries)) {
    console.warn(`Raffle ${raffleId} does not meet minimum requirements`)
    // Update status to pending_min_not_met if raffle has ended
    const now = new Date()
    const endTime = new Date(raffle.end_time)
    if (endTime <= now && raffle.status !== 'pending_min_not_met') {
      await supabase
        .from('raffles')
        .update({ status: 'pending_min_not_met' })
        .eq('id', raffleId)
    }
    return null
  }

  // Aggregate ticket quantities by wallet address
  const walletTickets = new Map<string, number>()
  for (const entry of confirmedEntries) {
    const current = walletTickets.get(entry.wallet_address) || 0
    walletTickets.set(entry.wallet_address, current + entry.ticket_quantity)
  }

  // Convert to arrays for weighted random selection
  const wallets = Array.from(walletTickets.keys())
  const weights = Array.from(walletTickets.values())

  // Calculate total tickets
  const totalTickets = weights.reduce((sum, weight) => sum + weight, 0)

  if (totalTickets === 0) {
    console.warn(`Total ticket count is 0 for raffle ${raffleId}`)
    return null
  }

  // Weighted random selection
  // Generate a random number between 0 and totalTickets
  let random = Math.random() * totalTickets

  // Find which wallet wins by iterating through weighted ranges
  for (let i = 0; i < wallets.length; i++) {
    random -= weights[i]
    if (random <= 0) {
      const winnerWallet = wallets[i]
      
      // Update the raffle with the winner
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('raffles')
        .update({
          winner_wallet: winnerWallet,
          winner_selected_at: now,
          status: 'completed',
        })
        .eq('id', raffleId)

      if (error) {
        console.error('Error updating raffle with winner:', error)
        throw new Error(`Failed to update raffle with winner: ${error.message}`)
      }

      console.log(`Winner selected for raffle ${raffleId}: ${winnerWallet} (${weights[i]} tickets)`)
      return winnerWallet
    }
  }

  // Fallback to last wallet (should not happen due to random <= 0 check)
  const winnerWallet = wallets[wallets.length - 1]
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('raffles')
    .update({
      winner_wallet: winnerWallet,
      winner_selected_at: now,
      status: 'completed',
    })
    .eq('id', raffleId)

  if (error) {
    console.error('Error updating raffle with winner:', error)
    throw new Error(`Failed to update raffle with winner: ${error.message}`)
  }

  return winnerWallet
}

/**
 * Get all raffles that have ended but don't have a winner selected yet
 */
export async function getEndedRafflesWithoutWinner(): Promise<Raffle[]> {
  const now = new Date().toISOString()
  
  const { data, error } = await supabase
    .from('raffles')
    .select('*')
    .is('winner_wallet', null)
    .is('winner_selected_at', null)
    .lte('end_time', now)
    .eq('is_active', true)

  if (error) {
    console.error('Error fetching ended raffles without winner:', error)
    return []
  }

  return (data || []) as Raffle[]
}

/**
 * Calculate total tickets sold for a raffle from confirmed entries
 */
export function calculateTicketsSold(entries: Entry[]): number {
  return entries
    .filter(e => e.status === 'confirmed')
    .reduce((sum, entry) => sum + entry.ticket_quantity, 0)
}

/**
 * Calculate unique participants (wallets) for a raffle from confirmed entries
 */
export function calculateUniqueParticipants(entries: Entry[]): number {
  const uniqueWallets = new Set(
    entries
      .filter(e => e.status === 'confirmed')
      .map(e => e.wallet_address)
  )
  return uniqueWallets.size
}

/**
 * Check if a raffle is eligible to be drawn (meets minimum requirements)
 * Returns true if no minimum is set OR if minimum is met
 */
export function isRaffleEligibleToDraw(raffle: Raffle, entries: Entry[]): boolean {
  // If no minimum is set, raffle is always eligible
  if (!raffle.min_tickets) {
    return true
  }

  // Check if minimum tickets requirement is met
  const ticketsSold = calculateTicketsSold(entries)
  return ticketsSold >= raffle.min_tickets
}

/**
 * Get the minimum threshold for a raffle (prefers min_tickets over min_participants if both exist)
 * This is for display purposes
 */
export function getRaffleMinimum(raffle: Raffle): number | null {
  // Default to min_tickets if both exist (as per requirements)
  return raffle.min_tickets ?? null
}