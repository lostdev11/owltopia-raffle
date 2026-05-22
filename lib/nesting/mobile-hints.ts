import { isAndroidDevice, isMobileDevice, isSolanaMobileEnvironment } from '@/lib/utils'

/** Shown on connect / wallet-preparing states (Seeker, Android, mobile). */
export function nestingMobileConnectHint(): string | null {
  if (typeof window === 'undefined') return null
  if (isSolanaMobileEnvironment()) {
    return 'On Seeker: tap Connect wallet, then choose Solana Mobile first. If the built-in wallet does not appear, use Phantom or Solflare and connect the same address.'
  }
  if (isAndroidDevice()) {
    return 'On Android: Phantom or Solflare work well. If your phone\'s built-in wallet does not connect, pick Solana Mobile in the list or open this page in Chrome.'
  }
  if (isMobileDevice()) {
    return 'On mobile, connect via Phantom or Solflare. If the page fails to load after returning from your wallet, refresh once.'
  }
  return null
}
