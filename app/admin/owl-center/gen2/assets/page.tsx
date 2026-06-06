import { redirect } from 'next/navigation'

import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'

export default async function AdminOwlCenterGen2AssetsRedirectPage() {
  const launch = await getOwlCenterLaunchBySlugAdmin('gen2')
  if (!launch) redirect('/admin/owl-center/gen2')
  redirect(`/admin/owl-center/collections/${launch.id}/assets`)
}
