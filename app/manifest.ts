import type { MetadataRoute } from 'next'
import { PLATFORM_NAME } from '@/lib/site-config'

/**
 * PWA manifest for mobile "Add to Home Screen" and standalone mode.
 * Prioritized for the ~75% of users on mobile crypto wallets.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PLATFORM_NAME,
    short_name: PLATFORM_NAME,
    description: 'Trusted raffles with full transparency. Every entry verified on-chain. Connect your wallet to enter.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    orientation: 'portrait-primary',
    scope: '/',
    icons: [
      { src: '/icon.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
