import type { Metadata } from 'next'

import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `Gen2 Presale | ${PLATFORM_NAME}`,
  description:
    'Owltopia Gen2 presale — secure mint credits in SOL. One presale spot equals one Gen2 mint at redemption.',
}

export default function Gen2PresaleLayout({ children }: { children: React.ReactNode }) {
  return children
}
