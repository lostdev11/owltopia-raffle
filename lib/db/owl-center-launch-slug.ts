import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { OWL_CENTER_RESERVED_LAUNCH_SLUGS, allocateUniqueLaunchSlug } from '@/lib/owl-center/launch-slug'

async function loadTakenLaunchSlugs(excludeLaunchId?: string): Promise<Set<string>> {
  const db = getSupabaseAdmin()
  const taken = new Set<string>(OWL_CENTER_RESERVED_LAUNCH_SLUGS)

  const [launches, aliases] = await Promise.all([
    db.from('owl_center_launches').select('id, slug'),
    db.from('owl_center_launch_slug_aliases').select('slug, launch_id'),
  ])

  if (launches.error) {
    console.warn('owl_center_launches slug list', launches.error.message)
  }
  if (aliases.error) {
    console.warn('owl_center_launch_slug_aliases slug list', aliases.error.message)
  }

  for (const row of (launches.data ?? []) as { id: string; slug: string }[]) {
    if (excludeLaunchId && row.id === excludeLaunchId) continue
    if (row.slug) taken.add(String(row.slug))
  }
  for (const row of (aliases.data ?? []) as { slug: string; launch_id: string }[]) {
    if (excludeLaunchId && row.launch_id === excludeLaunchId) continue
    if (row.slug) taken.add(String(row.slug))
  }

  return taken
}

/** Unique kebab slug from collection name (checks launches + aliases). */
export async function generateUniqueOwlCenterLaunchSlug(
  name: string,
  opts?: { excludeLaunchId?: string }
): Promise<string> {
  const taken = await loadTakenLaunchSlugs(opts?.excludeLaunchId)
  return allocateUniqueLaunchSlug(name, taken)
}

/** Former slug → launch id. Service role so old /m/sub-… links still resolve after promotion. */
export async function resolveOwlCenterLaunchIdBySlug(slug: string): Promise<string | null> {
  const clean = slug.trim().toLowerCase()
  if (!clean) return null

  const admin = getSupabaseAdmin()
  const { data: alias, error: aliasErr } = await admin
    .from('owl_center_launch_slug_aliases')
    .select('launch_id')
    .eq('slug', clean)
    .maybeSingle()
  if (aliasErr || !alias) return null
  const launchId = (alias as { launch_id?: unknown }).launch_id
  return typeof launchId === 'string' ? launchId : null
}

export async function recordOwlCenterLaunchSlugAlias(launchId: string, slug: string): Promise<boolean> {
  const clean = slug.trim().toLowerCase()
  if (!clean) return false
  const db = getSupabaseAdmin()
  const { error } = await db.from('owl_center_launch_slug_aliases').upsert(
    { slug: clean, launch_id: launchId },
    { onConflict: 'slug' }
  )
  if (error) {
    console.warn('owl_center_launch_slug_aliases upsert', error.message)
    return false
  }
  return true
}
