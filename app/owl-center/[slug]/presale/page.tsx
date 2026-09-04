import type { Metadata } from 'next'

import { OwlCenterPresalePageClient } from '@/components/owl-center-presale/OwlCenterPresalePageClient'
import { getOwlCenterPresaleTenantBySlug } from '@/lib/db/owl-center-presale-tenants'
import { normalizeOwlCenterPresaleSlug } from '@/lib/owl-center-presale/slug'

type PageProps = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug: raw } = await params
  const slug = normalizeOwlCenterPresaleSlug(raw)
  if (!slug) return { title: 'Presale' }
  try {
    const tenant = await getOwlCenterPresaleTenantBySlug(slug)
    if (!tenant || !tenant.is_enabled || tenant.approval_status !== 'approved') {
      return { title: 'Presale' }
    }
    return {
      title: `${tenant.display_name} Presale`,
      description: tenant.headline ?? `${tenant.display_name} partner presale on Owltopia.`,
    }
  } catch {
    return { title: 'Presale' }
  }
}

export default async function OwlCenterPartnerPresalePage({ params }: PageProps) {
  const { slug: raw } = await params
  const slug = normalizeOwlCenterPresaleSlug(raw) ?? raw.trim().toLowerCase()
  return <OwlCenterPresalePageClient slug={slug} />
}
