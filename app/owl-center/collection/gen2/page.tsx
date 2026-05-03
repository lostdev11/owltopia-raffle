import type { Metadata } from 'next'

import { Gen2MintPageClient } from '@/components/owl-center/Gen2MintPageClient'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `Owltopia Gen2 Mint | Owl Center | ${PLATFORM_NAME}`,
  description:
    'Official Owltopia Gen2 mint command center — phased mint, presale redemption, Solana-only (Phantom / Solflare). Powered by Owl Center.',
}

export default function OwlCenterGen2MintPage() {
  return <Gen2MintPageClient />
}
