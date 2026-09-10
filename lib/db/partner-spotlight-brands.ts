import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { PartnerLogo } from '@/lib/partner-logos'
import { clearPartnerCommunityWalletCache } from '@/lib/raffles/partner-communities'

export type PartnerSpotlightBrandRow = {
  slug: string
  display_name: string
  logo_src: string
  logo_alt: string
  sort_order: number
  is_active: boolean
  discord_partner_tenant_id: string | null
  match_aliases: string[]
  created_at: string
  updated_at: string
}

let brandCache: { logos: PartnerLogo[]; fetchedAt: number } | null = null
const BRAND_CACHE_TTL_MS = 45_000

/** Normalize for fuzzy partner-name matching (slug / label / Discord tenant name). */
export function normalizePartnerMatchKey(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

export function partnerNameMatchesQuery(
  query: string,
  candidates: Array<string | null | undefined>
): boolean {
  const q = normalizePartnerMatchKey(query)
  if (!q || q.length < 2) return false
  for (const c of candidates) {
    const n = normalizePartnerMatchKey(c)
    if (!n) continue
    if (n === q || n.includes(q) || q.includes(n)) return true
  }
  return false
}

function mapBrandRow(row: Record<string, unknown>): PartnerSpotlightBrandRow {
  const aliasesRaw = row.match_aliases
  return {
    slug: String(row.slug ?? ''),
    display_name: String(row.display_name ?? ''),
    logo_src: String(row.logo_src ?? ''),
    logo_alt: String(row.logo_alt ?? ''),
    sort_order: Number.isFinite(Number(row.sort_order)) ? Math.floor(Number(row.sort_order)) : 0,
    is_active: row.is_active !== false,
    discord_partner_tenant_id:
      row.discord_partner_tenant_id != null && String(row.discord_partner_tenant_id).trim()
        ? String(row.discord_partner_tenant_id).trim()
        : null,
    match_aliases: Array.isArray(aliasesRaw)
      ? aliasesRaw.filter((a): a is string => typeof a === 'string' && a.trim().length > 0).map((a) => a.trim())
      : [],
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

export function partnerSpotlightBrandToLogo(row: PartnerSpotlightBrandRow): PartnerLogo {
  return { src: row.logo_src, alt: row.logo_alt || `${row.display_name} partner logo` }
}

export function clearPartnerSpotlightBrandCache(): void {
  brandCache = null
}

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('partner_spotlight_brands') &&
    (m.includes('does not exist') || m.includes('42p01') || m.includes('relation'))
  ) || m.includes('42p01')
}

/**
 * Active spotlight brands for the public marquee.
 * Returns `null` when the table is missing so callers can fall back to hardcoded logos.
 */
export async function getActivePartnerSpotlightBrandLogos(): Promise<PartnerLogo[] | null> {
  if (brandCache && Date.now() - brandCache.fetchedAt < BRAND_CACHE_TTL_MS) {
    return brandCache.logos
  }

  try {
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('partner_spotlight_brands')
      .select(
        'slug, display_name, logo_src, logo_alt, sort_order, is_active, discord_partner_tenant_id, match_aliases, created_at, updated_at'
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error) {
      if (isMissingTableError(error.message ?? '')) return null
      console.warn('[partner-spotlight-brands] read failed:', error.message)
      return null
    }

    const logos = (data ?? [])
      .map((r) => mapBrandRow(r as Record<string, unknown>))
      .filter((r) => r.logo_src.trim())
      .map(partnerSpotlightBrandToLogo)

    brandCache = { logos, fetchedAt: Date.now() }
    return logos
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isMissingTableError(msg)) return null
    console.warn('[partner-spotlight-brands] read threw:', msg)
    return null
  }
}

export async function listPartnerSpotlightBrandsAdmin(): Promise<PartnerSpotlightBrandRow[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_spotlight_brands')
    .select(
      'slug, display_name, logo_src, logo_alt, sort_order, is_active, discord_partner_tenant_id, match_aliases, created_at, updated_at'
    )
    .order('sort_order', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapBrandRow(r as Record<string, unknown>))
}

export async function deactivatePartnerSpotlightBrandsBySlugs(slugs: string[]): Promise<string[]> {
  const unique = [...new Set(slugs.map((s) => s.trim()).filter(Boolean))]
  if (unique.length === 0) return []

  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_spotlight_brands')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .in('slug', unique)
    .eq('is_active', true)
    .select('slug')

  if (error) {
    if (isMissingTableError(error.message ?? '')) return []
    throw new Error(error.message)
  }

  clearPartnerSpotlightBrandCache()
  return (data ?? []).map((r) => String((r as { slug?: string }).slug ?? '')).filter(Boolean)
}

export async function deactivatePartnerSpotlightBrandsMatchingName(
  name: string
): Promise<string[]> {
  const q = name.trim()
  if (!q) return []

  let rows: PartnerSpotlightBrandRow[]
  try {
    rows = await listPartnerSpotlightBrandsAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isMissingTableError(msg)) return []
    throw e
  }

  const hits = rows
    .filter((r) => r.is_active)
    .filter((r) =>
      partnerNameMatchesQuery(q, [r.slug, r.display_name, r.logo_alt, ...r.match_aliases])
    )
    .map((r) => r.slug)

  return deactivatePartnerSpotlightBrandsBySlugs(hits)
}

export async function deactivatePartnerSpotlightBrandsForTenant(
  tenantId: string
): Promise<string[]> {
  const id = tenantId.trim()
  if (!id) return []

  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_spotlight_brands')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('discord_partner_tenant_id', id)
    .eq('is_active', true)
    .select('slug')

  if (error) {
    if (isMissingTableError(error.message ?? '')) return []
    throw new Error(error.message)
  }

  clearPartnerSpotlightBrandCache()
  clearPartnerCommunityWalletCache()
  return (data ?? []).map((r) => String((r as { slug?: string }).slug ?? '')).filter(Boolean)
}
