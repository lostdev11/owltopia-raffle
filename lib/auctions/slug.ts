import { getSupabaseAdmin } from '@/lib/supabase-admin'

export function slugifyAuctionTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || `auction-${Date.now()}`
}

export async function generateUniqueAuctionSlug(baseSlug: string): Promise<string> {
  const admin = getSupabaseAdmin()
  let slug = baseSlug
  let counter = 1
  while (counter <= 1000) {
    const { data } = await admin.from('nft_auctions').select('id').eq('slug', slug).maybeSingle()
    if (!data) return slug
    counter++
    slug = `${baseSlug}-${counter}`
  }
  return `${baseSlug}-${Date.now()}`
}
