import type { Metadata } from 'next'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'

const site = getSiteBaseUrl()

export const metadata: Metadata = {
  title: `Partner hub | ${PLATFORM_NAME}`,
  description: `Host tools for allowlisted partner communities; site admins may preview the hub with their wallet. Public partner listings, main dashboard, Discord.`,
  alternates: { canonical: `${site}/partners/dashboard` },
}

export default function PartnersLayout({ children }: { children: React.ReactNode }) {
  return children
}
