import { supabase } from '@/lib/supabase'
import { getSupabaseForServerRead } from '@/lib/supabase-admin'

export type OwlCenterLaunchFeature = {
  title: string
  body: string
}

export type OwlCenterCollectionLaunchRow = {
  slug: string
  title: string
  tagline: string | null
  description: string | null
  features: OwlCenterLaunchFeature[]
  hero_video_path: string | null
  hero_poster_path: string | null
  hero_image_path: string | null
  primary_cta_label: string
  primary_cta_href: string
  secondary_cta_label: string | null
  secondary_cta_href: string | null
  published: boolean
  updated_at: string
}

function parseFeatures(raw: unknown): OwlCenterLaunchFeature[] {
  if (!Array.isArray(raw)) return []
  const out: OwlCenterLaunchFeature[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title : ''
    const body = typeof o.body === 'string' ? o.body : ''
    if (!title && !body) continue
    out.push({ title, body })
  }
  return out
}

export async function getOwlCenterCollectionLaunchBySlug(
  slug: string
): Promise<OwlCenterCollectionLaunchRow | null> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db.from('owl_center_collection_launches').select('*')
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('owl_center_collection_launches read failed (migration 096?):', error.message)
    }
    return null
  }

  if (!data || !data.published) return null

  return {
    slug: String(data.slug),
    title: String(data.title),
    tagline: data.tagline != null ? String(data.tagline) : null,
    description: data.description != null ? String(data.description) : null,
    features: parseFeatures(data.features),
    hero_video_path: data.hero_video_path != null ? String(data.hero_video_path) : null,
    hero_poster_path: data.hero_poster_path != null ? String(data.hero_poster_path) : null,
    hero_image_path: data.hero_image_path != null ? String(data.hero_image_path) : null,
    primary_cta_label: String(data.primary_cta_label),
    primary_cta_href: String(data.primary_cta_href),
    secondary_cta_label: data.secondary_cta_label != null ? String(data.secondary_cta_label) : null,
    secondary_cta_href: data.secondary_cta_href != null ? String(data.secondary_cta_href) : null,
    published: Boolean(data.published),
    updated_at: (data.updated_at as string) ?? new Date().toISOString(),
  }
}
