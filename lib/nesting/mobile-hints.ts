import { isMobileDevice, isSolanaMobileEnvironment } from '@/lib/utils'

/** Shown on connect / wallet-preparing states (Seeker + mobile web). */
export function nestingMobileConnectHint(): string | null {
  if (typeof window === 'undefined') return null
  if (isSolanaMobileEnvironment()) {
    return 'On Seeker: tap Connect wallet, then choose Solana Mobile first. If the built-in wallet does not appear, use Phantom or Solflare and connect the same address.'
  }
  if (isMobileDevice()) {
    return 'Tap Connect wallet, then Open in Phantom or Open in Solflare for the smoothest experience. If the page looks stuck after returning from your wallet, refresh once.'
  }
  return null
}
