import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'

const url = getSiteBaseUrl()

export const metadata: Metadata = {
  title: `Partner raffles | ${PLATFORM_NAME}`,
  description: `Browse raffles from verified partner communities on ${PLATFORM_NAME}. Main browse lists host raffles separately.`,
  alternates: { canonical: `${url}/partner-raffles` },
  openGraph: { url: `${url}/raffles?tab=partner-raffles` },
}

export default function PartnerRafflesRedirectPage() {
  redirect('/raffles?tab=partner-raffles')
}
