import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type PartnerProgramApplicationRow = {
  id: number
  project_name: string
  contact_name: string | null
  contact_handle: string
  wallet_address: string
  interested_tier: string
  details: string | null
  status: 'new' | 'contacted' | 'active' | 'closed' | string
  created_at: string
  updated_at: string
}

export async function insertPartnerProgramApplication(input: {
  project_name: string
  contact_name?: string | null
  contact_handle: string
  wallet_address: string
  interested_tier: string
  details?: string | null
}): Promise<PartnerProgramApplicationRow> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_program_applications')
    .insert({
      project_name: input.project_name.trim(),
      contact_name: input.contact_name?.trim() || null,
      contact_handle: input.contact_handle.trim(),
      wallet_address: input.wallet_address.trim(),
      interested_tier: input.interested_tier.trim(),
      details: input.details?.trim() || null,
      status: 'new',
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as PartnerProgramApplicationRow
}

export async function listPartnerProgramApplications(): Promise<PartnerProgramApplicationRow[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_program_applications')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as PartnerProgramApplicationRow[]
}

export async function updatePartnerProgramApplicationStatus(
  id: number,
  status: 'new' | 'contacted' | 'active' | 'closed'
): Promise<PartnerProgramApplicationRow> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_program_applications')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as PartnerProgramApplicationRow
}
