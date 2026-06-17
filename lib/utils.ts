import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format } from 'date-fns'

/**
 * Converts a UTC ISO string (from database) to a local datetime-local input value
 * datetime-local inputs expect format: YYYY-MM-DDTHH:mm (in local timezone, no timezone info)
 */
export function utcToLocalDateTime(utcIsoString: string): string {
  const date = new Date(utcIsoString)
  // Get local time components
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

/**
 * Converts a datetime-local input value (in user's local timezone) to UTC ISO string
 * datetime-local inputs provide values in local timezone without timezone info
 * 
 * IMPORTANT: We explicitly parse the string to ensure it's interpreted as local time,
 * not UTC. Some browsers interpret "YYYY-MM-DDTHH:mm" as UTC when passed directly to Date().
 */
export function localDateTimeToUtc(localDateTimeString: string): string {
  if (!localDateTimeString) {
    throw new Error('localDateTimeString is required')
  }

  // Parse the datetime-local string (format: YYYY-MM-DDTHH:mm)
  const [datePart, timePart] = localDateTimeString.split('T')
  if (!datePart || !timePart) {
    throw new Error('Invalid datetime-local format. Expected: YYYY-MM-DDTHH:mm')
  }

  const [year, month, day] = datePart.split('-').map(Number)
  const [hours, minutes = 0] = timePart.split(':').map(Number)

  // Create a Date object explicitly in local timezone
  // Using the Date constructor with individual components interprets them as local time
  const localDate = new Date(year, month - 1, day, hours, minutes, 0, 0)
  
  // Verify the date is valid
  if (isNaN(localDate.getTime())) {
    throw new Error('Invalid date values')
  }

  // Convert to ISO string (which is in UTC)
  return localDate.toISOString()
}

/**
 * Formats a UTC ISO string to display in the user's local timezone
 * Returns a formatted string like "Jan 15, 2024 at 3:30 PM"
 */
export function formatDateTimeLocal(utcIsoString: string, includeTime: boolean = true): string {
  const date = new Date(utcIsoString)
  if (includeTime) {
    return format(date, 'PPp') // e.g., "Jan 15, 2024, 3:30 PM"
  }
  return format(date, 'PP') // e.g., "Jan 15, 2024"
}

/**
 * Formats a UTC ISO string to display with timezone info
 * Returns a formatted string like "Jan 15, 2024 at 3:30 PM PST"
 */
export function formatDateTimeWithTimezone(utcIsoString: string): string {
  const date = new Date(utcIsoString)
  const timezoneName = new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop() || ''
  
  return `${format(date, 'PPp')} ${timezoneName}`
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Detects if the user is on a mobile device
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  
  // Check user agent for mobile devices
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i
  return mobileRegex.test(userAgent)
}

/**
 * Detects if the user is on an Android device
 */
export function isAndroidDevice(): boolean {
  if (typeof window === 'undefined') return false
  
  // Check user agent for Android devices
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera
  return /android/i.test(userAgent)
}

function clientUserAgent(): string {
  if (typeof window === 'undefined') return ''
  return (
    navigator.userAgent ||
    navigator.vendor ||
    (window as { opera?: string }).opera ||
    ''
  )
}

/**
 * Solana Mobile Web Shell (Seeker and related devices).
 * @see https://docs.solanamobile.com/developers/mobile-wallet-adapter-web
 */
export function isSolanaMobileWebShell(): boolean {
  const ua = clientUserAgent().toLowerCase()
  return ua.includes('solana mobile web shell')
}

/**
 * Heuristic Seeker / Solana Mobile device in a normal Android browser.
 * Not cryptographically verified — use SGT + SIWS when gating rewards.
 */
export function isLikelySeekerDevice(): boolean {
  if (!isAndroidDevice()) return false
  const ua = clientUserAgent().toLowerCase()
  return (
    ua.includes('seeker') ||
    ua.includes('solanamobile') ||
    ua.includes('solana mobile')
  )
}

/** Built-in MWA wallet environment (Seeker Web Shell or likely Seeker hardware). */
export function isSolanaMobileEnvironment(): boolean {
  return isSolanaMobileWebShell() || isLikelySeekerDevice()
}

/** iPhone / iPad (not Seeker Android). */
export function isIosDevice(): boolean {
  if (typeof window === 'undefined') return false
  const ua = clientUserAgent()
  return /iphone|ipad|ipod/i.test(ua) && !isAndroidDevice()
}

/** User-facing mobile browser name for hints (Chrome, Safari, etc.). */
export function mobileWebBrowserLabel(): string {
  if (typeof window === 'undefined') return 'your browser'
  if (isAndroidDevice()) return 'Chrome'
  if (isIosDevice()) return 'Safari'
  return 'your browser'
}

/** Android phones + Seeker / Solana Mobile — prioritize refresh + OS/wallet update hints. */
export function isAndroidOrSolanaMobileClient(): boolean {
  return isAndroidDevice() || isSolanaMobileEnvironment()
}

/** Shown in connect UI — same guidance on iOS Safari and Android Chrome. */
export function mobileWalletInAppBrowserHint(): string {
  return 'For the smoothest experience, open this site in your wallet\'s browser. Everything stays in the app—no switching back and forth.'
}

/**
 * Detects if Phantom wallet extension is available (desktop)
 */
export function isPhantomExtensionAvailable(): boolean {
  if (typeof window === 'undefined') return false
  
  // Check for Phantom extension
  return !!(window as any).solana?.isPhantom || !!(window as any).phantom?.solana
}

/**
 * Detects if user is in Phantom browser (mobile)
 */
export function isPhantomBrowser(): boolean {
  if (typeof window === 'undefined') return false
  
  // Check user agent for Phantom browser
  const userAgent = navigator.userAgent || ''
  return userAgent.toLowerCase().includes('phantom')
}

/** Phantom, Solflare, or Solana Mobile in-app / Web Shell — wallet is injectable. */
export function isMobileWalletInjectedContext(): boolean {
  return isPhantomBrowser() || isSolflareBrowser() || isSolanaMobileEnvironment()
}

/** Returning from a mobile wallet deep-link callback (Solflare data/nonce, Phantom session keys). */
export function hasMobileWalletCallbackParams(): boolean {
  if (typeof window === 'undefined') return false
  const urlParams = new URLSearchParams(window.location.search)
  const hashParams = new URLSearchParams(window.location.hash.substring(1))
  return (
    urlParams.has('phantom_encryption_public_key') ||
    urlParams.has('dapp_encryption_public_key') ||
    urlParams.has('data') ||
    urlParams.has('nonce') ||
    hashParams.has('phantom_encryption_public_key') ||
    hashParams.has('dapp_encryption_public_key') ||
    hashParams.has('data') ||
    hashParams.has('nonce')
  )
}

/**
 * autoConnect on mobile only when a wallet can actually attach (in-app browser, Seeker, or deep-link return).
 * Avoids immediate connect failures on Android Chrome where Phantom/Solflare are not injected.
 */
export function shouldMobileAutoConnect(): boolean {
  if (!isMobileDevice()) return false
  if (isMobileWalletInjectedContext()) return true
  if (hasMobileWalletCallbackParams()) return true
  return false
}

/** Set before navigating to Phantom/Solflare in-app browser so connect-failure UI does not flash. */
export function markWalletBrowseRedirectPending(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem('wallet_browse_redirect_pending', '1')
  } catch {
    /* ignore */
  }
}

export function clearWalletBrowseRedirectPending(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem('wallet_browse_redirect_pending')
  } catch {
    /* ignore */
  }
}

export function isWalletBrowseRedirectPending(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem('wallet_browse_redirect_pending') === '1'
  } catch {
    return false
  }
}

/** Android/iOS mobile browser (Chrome, Safari) — not inside a wallet in-app browser. */
export function isMobileWebBrowser(): boolean {
  return isMobileDevice() && !isMobileWalletInjectedContext()
}

/**
 * Gets the Phantom deep link URL for the current page
 * @see https://docs.phantom.com/phantom-deeplinks/other-methods/browse
 */
export function getPhantomDeepLink(): string {
  if (typeof window === 'undefined') return ''

  const currentUrl = encodeURIComponent(window.location.href)
  const ref = encodeURIComponent(window.location.origin)
  return `https://phantom.app/ul/browse/${currentUrl}?ref=${ref}`
}

/**
 * Redirects user to open the current page in Phantom browser (mobile)
 */
export function redirectToPhantomBrowser(): void {
  if (typeof window === 'undefined') return

  markWalletBrowseRedirectPending()
  const deepLink = getPhantomDeepLink()
  
  // Try to open in Phantom browser
  window.location.href = deepLink
  
  // Fallback: If Phantom is not installed, this will open the App Store/Play Store
  // After a short delay, show a message if still on the page
  setTimeout(() => {
    // If we're still here after 2 seconds, Phantom might not be installed
    // The user will see Phantom's page which handles this case
  }, 2000)
}

/**
 * Gets the Solflare deep link URL for connecting
 * Note: This is used by the SolflareWalletAdapter internally
 * We ensure the current page URL is properly formatted for callbacks
 */
export function getSolflareDeepLinkUrl(): string {
  if (typeof window === 'undefined') return ''
  
  // Get the current page URL without query params or hash (clean base URL)
  // This will be used as redirect_link by the Solflare adapter
  const currentUrl = window.location.origin + window.location.pathname
  return currentUrl
}

/**
 * Detects if user is in Solflare browser (mobile)
 */
export function isSolflareBrowser(): boolean {
  if (typeof window === 'undefined') return false
  
  // Check user agent for Solflare browser
  const userAgent = navigator.userAgent || ''
  return userAgent.toLowerCase().includes('solflare')
}

/**
 * Opens the current page in Solflare's in-app browser so connection stays in-app (no redirect out and back).
 */
export function redirectToSolflareBrowser(): void {
  if (typeof window === 'undefined') return
  markWalletBrowseRedirectPending()
  const url = encodeURIComponent(window.location.href)
  const ref = encodeURIComponent(window.location.origin)
  window.location.href = `https://solflare.com/ul/v1/browse/${url}?ref=${ref}`
}
