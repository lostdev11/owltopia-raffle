import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'

const url = getSiteBaseUrl()

export const metadata: Metadata = {
  title: `.sol domains raffles | ${PLATFORM_NAME}`,
  description: `Browse .sol domain and SNS-style name prize raffles on ${PLATFORM_NAME}. Listed separately from the main raffle feed.`,
  alternates: { canonical: `${url}/sol-domains` },
  openGraph: { url: `${url}/raffles?tab=sol-domains` },
}

export default function SolDomainsRafflesRedirectPage() {
  redirect('/raffles?tab=sol-domains')
}
