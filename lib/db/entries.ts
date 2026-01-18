import { supabase } from '@/lib/supabase'
import type { Entry } from '@/lib/types'

export async function getEntryById(id: string) {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('Error fetching entry:', error)
    return null
  }

  return data as Entry
}

export async function createEntry(entry: Omit<Entry, 'id' | 'created_at' | 'verified_at'>) {
  // Validate currency is USDC or SOL only
  const validCurrencies = ['USDC', 'SOL']
  if (!validCurrencies.includes(entry.currency)) {
    console.error('Invalid currency for entry. Must be USDC or SOL.')
    return null
  }

  const { data, error } = await supabase
    .from('entries')
    .insert(entry)
    .select()
    .single()

  if (error) {
    console.error('Error creating entry:', error)
    return null
  }

  return data as Entry
}

export async function updateEntryStatus(
  id: string,
  status: Entry['status'],
  transactionSignature?: string
) {
  const updateData: Partial<Entry> = {
    status,
    verified_at: status === 'confirmed' ? new Date().toISOString() : null,
  }

  if (transactionSignature) {
    updateData.transaction_signature = transactionSignature
  }

  const { data, error } = await supabase
    .from('entries')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating entry:', error)
    console.error('Entry ID:', id)
    console.error('Update data:', updateData)
    console.error('Supabase error details:', JSON.stringify(error, null, 2))
    return null
  }

  return data as Entry
}

export async function deleteEntry(id: string) {
  const { error, data } = await supabase
    .from('entries')
    .delete()
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error deleting entry:', error)
    console.error('Entry ID:', id)
    console.error('Supabase error details:', JSON.stringify(error, null, 2))
    return false
  }

  // Check if any rows were actually deleted
  if (!data) {
    console.warn('No entry found with id:', id)
    return false
  }

  console.log('Successfully deleted entry:', id)
  return true
}
