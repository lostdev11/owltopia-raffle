import type {
  OwlCenterPresalePreviewImage,
  OwlCenterPresaleTheme,
  OwlCenterPresaleTenantAdmin,
} from '@/lib/owl-center-presale/types'
import { OWL_CENTER_PRESALE_DEFAULT_THEME } from '@/lib/owl-center-presale/constants'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function parseTheme(row: Record<string, unknown>): OwlCenterPresaleTheme {
  return {
    primary: String(row.theme_primary ?? OWL_CENTER_PRESALE_DEFAULT_THEME.primary),
    accent: String(row.theme_accent ?? OWL_CENTER_PRESALE_DEFAULT_THEME.accent),
    background: String(row.theme_background ?? OWL_CENTER_PRESALE_DEFAULT_THEME.background),
    surface: String(row.theme_surface ?? OWL_CENTER_PRESALE_DEFAULT_THEME.surface),
    muted: String(row.theme_muted ?? OWL_CENTER_PRESALE_DEFAULT_THEME.muted),
  }
}

function parsePreviewImages(raw: unknown): OwlCenterPresalePreviewImage[] {
  if (!Array.isArray(raw)) return []
  const out: OwlCenterPresalePreviewImage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const url = typeof o.url === 'string' ? o.url.trim() : ''
    const alt = typeof o.alt === 'string' ? o.alt.trim() : ''
    if (!url) continue
    const fit = o.fit === 'cover' ? 'cover' : 'contain'
    out.push({ url, alt: alt || 'NFT preview', fit })
  }
  return out.slice(0, 12)
}

export function mapOwlCenterPresaleTenantRow(row: Record<string, unknown>): OwlCenterPresaleTenantAdmin {
  return {
    id: String(row.id),
    slug: String(row.slug),
    display_name: String(row.display_name),
    headline: (row.headline as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    treasury_wallet: String(row.treasury_wallet),
    partner_wallet: (row.partner_wallet as string | null) ?? null,
    is_enabled: Boolean(row.is_enabled),
    is_live: Boolean(row.is_live),
    unit_price_usdc: Number(row.unit_price_usdc ?? 20),
    presale_supply: Number(row.presale_supply ?? 100),
    max_spots_per_purchase: Number(row.max_spots_per_purchase ?? 5),
    max_credits_per_wallet: Number(row.max_credits_per_wallet ?? 20),
    theme: parseTheme(row),
    preview_images: parsePreviewImages(row.preview_images),
    sort_order: Number(row.sort_order ?? 0),
    updated_by_wallet: (row.updated_by_wallet as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

const TENANT_SELECT =
  'id, slug, display_name, headline, description, treasury_wallet, partner_wallet, is_enabled, is_live, unit_price_usdc, presale_supply, max_spots_per_purchase, max_credits_per_wallet, theme_primary, theme_accent, theme_background, theme_surface, theme_muted, preview_images, sort_order, updated_by_wallet, created_at, updated_at'

export async function getOwlCenterPresaleTenantBySlug(slug: string): Promise<OwlCenterPresaleTenantAdmin | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_presale_tenants')
    .select(TENANT_SELECT)
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return mapOwlCenterPresaleTenantRow(data as Record<string, unknown>)
}

export async function getOwlCenterPresaleTenantById(id: string): Promise<OwlCenterPresaleTenantAdmin | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('owl_center_presale_tenants').select(TENANT_SELECT).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return mapOwlCenterPresaleTenantRow(data as Record<string, unknown>)
}

export async function listOwlCenterPresaleTenantsAdmin(): Promise<OwlCenterPresaleTenantAdmin[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_presale_tenants')
    .select(TENANT_SELECT)
    .order('sort_order', { ascending: true })
    .order('slug', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapOwlCenterPresaleTenantRow(r as Record<string, unknown>))
}

export async function listEnabledOwlCenterPresaleTenantsPublic(): Promise<OwlCenterPresaleTenantAdmin[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_presale_tenants')
    .select(TENANT_SELECT)
    .eq('is_enabled', true)
    .order('sort_order', { ascending: true })
    .order('slug', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapOwlCenterPresaleTenantRow(r as Record<string, unknown>))
}

export function sanitizePreviewImagesInput(raw: unknown): OwlCenterPresalePreviewImage[] {
  if (!Array.isArray(raw)) return []
  const out: OwlCenterPresalePreviewImage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const url = typeof o.url === 'string' ? o.url.trim() : ''
    if (!url) continue
    if (!url.startsWith('/') && !url.startsWith('https://')) continue
    const alt = typeof o.alt === 'string' && o.alt.trim() ? o.alt.trim() : 'NFT preview'
    const fit = o.fit === 'cover' ? 'cover' : 'contain'
    out.push({ url, alt, fit })
  }
  return out.slice(0, 12)
}

export async function insertOwlCenterPresaleTenant(input: {
  slug: string
  display_name: string
  headline?: string | null
  description?: string | null
  treasury_wallet: string
  partner_wallet?: string | null
  is_enabled?: boolean
  is_live?: boolean
  unit_price_usdc?: number
  presale_supply?: number
  max_spots_per_purchase?: number
  max_credits_per_wallet?: number
  theme?: Partial<OwlCenterPresaleTheme>
  preview_images?: OwlCenterPresalePreviewImage[]
  sort_order?: number
  updated_by_wallet?: string | null
}): Promise<OwlCenterPresaleTenantAdmin> {
  const db = getSupabaseAdmin()
  const theme = { ...OWL_CENTER_PRESALE_DEFAULT_THEME, ...input.theme }
  const row = {
    slug: input.slug,
    display_name: input.display_name.trim(),
    headline: input.headline?.trim() || null,
    description: input.description?.trim() || null,
    treasury_wallet: input.treasury_wallet,
    partner_wallet: input.partner_wallet?.trim() || null,
    is_enabled: input.is_enabled === true,
    is_live: input.is_live === true,
    unit_price_usdc: input.unit_price_usdc ?? 20,
    presale_supply: input.presale_supply ?? 100,
    max_spots_per_purchase: input.max_spots_per_purchase ?? 5,
    max_credits_per_wallet: input.max_credits_per_wallet ?? 20,
    theme_primary: theme.primary,
    theme_accent: theme.accent,
    theme_background: theme.background,
    theme_surface: theme.surface,
    theme_muted: theme.muted,
    preview_images: input.preview_images ?? [],
    sort_order: input.sort_order ?? 0,
    updated_by_wallet: input.updated_by_wallet ?? null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await db.from('owl_center_presale_tenants').insert(row).select(TENANT_SELECT).single()
  if (error) throw new Error(error.message)
  return mapOwlCenterPresaleTenantRow(data as Record<string, unknown>)
}

export async function updateOwlCenterPresaleTenant(
  id: string,
  patch: Partial<{
    slug: string
    display_name: string
    headline: string | null
    description: string | null
    treasury_wallet: string
    partner_wallet: string | null
    is_enabled: boolean
    is_live: boolean
    unit_price_usdc: number
    presale_supply: number
    max_spots_per_purchase: number
    max_credits_per_wallet: number
    theme: Partial<OwlCenterPresaleTheme>
    preview_images: OwlCenterPresalePreviewImage[]
    sort_order: number
    updated_by_wallet: string | null
  }>
): Promise<OwlCenterPresaleTenantAdmin | null> {
  const db = getSupabaseAdmin()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.slug !== undefined) updates.slug = patch.slug
  if (patch.display_name !== undefined) updates.display_name = patch.display_name.trim()
  if (patch.headline !== undefined) updates.headline = patch.headline?.trim() || null
  if (patch.description !== undefined) updates.description = patch.description?.trim() || null
  if (patch.treasury_wallet !== undefined) updates.treasury_wallet = patch.treasury_wallet
  if (patch.partner_wallet !== undefined) updates.partner_wallet = patch.partner_wallet?.trim() || null
  if (patch.is_enabled !== undefined) updates.is_enabled = patch.is_enabled
  if (patch.is_live !== undefined) updates.is_live = patch.is_live
  if (patch.unit_price_usdc !== undefined) updates.unit_price_usdc = patch.unit_price_usdc
  if (patch.presale_supply !== undefined) updates.presale_supply = patch.presale_supply
  if (patch.max_spots_per_purchase !== undefined) updates.max_spots_per_purchase = patch.max_spots_per_purchase
  if (patch.max_credits_per_wallet !== undefined) updates.max_credits_per_wallet = patch.max_credits_per_wallet
  if (patch.sort_order !== undefined) updates.sort_order = patch.sort_order
  if (patch.updated_by_wallet !== undefined) updates.updated_by_wallet = patch.updated_by_wallet
  if (patch.preview_images !== undefined) updates.preview_images = patch.preview_images
  if (patch.theme) {
    if (patch.theme.primary) updates.theme_primary = patch.theme.primary
    if (patch.theme.accent) updates.theme_accent = patch.theme.accent
    if (patch.theme.background) updates.theme_background = patch.theme.background
    if (patch.theme.surface) updates.theme_surface = patch.theme.surface
    if (patch.theme.muted) updates.theme_muted = patch.theme.muted
  }
  const { data, error } = await db
    .from('owl_center_presale_tenants')
    .update(updates)
    .eq('id', id)
    .select(TENANT_SELECT)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return mapOwlCenterPresaleTenantRow(data as Record<string, unknown>)
}
