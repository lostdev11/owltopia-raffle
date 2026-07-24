import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { upsertPartnerCommunityCreatorFromApplication } from '@/lib/db/partner-community-creators-admin'
import { clearPartnerCommunityWalletCache } from '@/lib/raffles/partner-communities'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type PartnerProgramApplicationRow = {
  id: number
  project_name: string
  contact_name: string | null
  contact_handle: string
  wallet_address: string
  interested_tier: string
  details: string | null
  logo_url: string | null
  status: 'new' | 'contacted' | 'active' | 'closed' | string
  approved_at: string | null
  approved_creator_wallet: string | null
  created_at: string
  updated_at: string
}

const VALID_PARTNER_TIERS = new Set(['$0_partner', 'partner_pro', 'white_label'] as const)

export async function insertPartnerProgramApplication(input: {
  project_name: string
  contact_name?: string | null
  contact_handle: string
  wallet_address: string
  interested_tier: string
  details?: string | null
  logo_url?: string | null
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
      logo_url: input.logo_url?.trim() || null,
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

export async function getPartnerProgramApplicationById(
  id: number
): Promise<PartnerProgramApplicationRow | null> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_program_applications')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as PartnerProgramApplicationRow | null) ?? null
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

export type ApprovePartnerProgramApplicationResult = {
  application: PartnerProgramApplicationRow
  creator_wallet: string
}

/**
 * Approve an application: upsert partner_community_creators from answers + logo, mark active.
 * Idempotent — re-approve refreshes the creator row.
 */
export async function approvePartnerProgramApplication(
  id: number
): Promise<ApprovePartnerProgramApplicationResult> {
  const app = await getPartnerProgramApplicationById(id)
  if (!app) throw new Error('Application not found')

  const creator_wallet = normalizeSolanaWalletAddress(app.wallet_address)
  if (!creator_wallet) throw new Error('Application wallet is not a valid Solana address')

  const tierRaw = (app.interested_tier ?? '').trim()
  const partner_tier = (
    VALID_PARTNER_TIERS.has(tierRaw as '$0_partner' | 'partner_pro' | 'white_label')
      ? tierRaw
      : '$0_partner'
  ) as '$0_partner' | 'partner_pro' | 'white_label'

  await upsertPartnerCommunityCreatorFromApplication({
    creator_wallet,
    display_label: app.project_name.trim() || null,
    partner_tier,
    logo_url: app.logo_url,
  })
  clearPartnerCommunityWalletCache()

  const now = new Date().toISOString()
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_program_applications')
    .update({
      status: 'active',
      approved_at: now,
      approved_creator_wallet: creator_wallet,
      updated_at: now,
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  return {
    application: data as PartnerProgramApplicationRow,
    creator_wallet,
  }
}
