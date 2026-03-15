# Mobile-first focus

**~75% of our users are on mobile, using mobile crypto wallets.** All product and UX decisions should prioritize mobile.

## What we already do

- **Mobile detection**: Use `isMobileDevice()` from `@/lib/utils` for all mobile checks so behavior is consistent (wallet delay, 401 retry, touch fix, logging). Do not duplicate UA regexes.
- **Wallet stack**: Solana Mobile Wallet Adapter (MWA), Solflare mobile adapter with `redirect_link`, Phantom/Coinbase/Trust; Android blank-page and deep-link handling; iOS Solflare in-app browser.
- **Touch**: 44px+ tap targets, `touch-action: manipulation`, Solflare touch fix (uses `isMobileDevice()`), wallet modal tuned for mobile.
- **Layout**: Responsive breakpoints, mobile hamburger nav with **wallet as primary CTA** in the header (no crowding).
- **PWA**: `app/manifest.ts` for Add to Home Screen and standalone mode.
- **Safe area**: `env(safe-area-inset-*)` for notches and home indicator.
- **Dashboard (mobile-first)**: Delay before first API call so wallet can stabilize after nav/redirect; “Preparing your dashboard” when connected but `publicKey` not ready; one automatic retry on 401 so session race after connect is handled; error screen hints for mobile.
- **Raffle flows**: Timeouts and errors tuned for mobile (slower networks, RPC CORS); `lastValidBlockHeight` set for Android MWA.

## Guidelines for new work

1. **Use one mobile check** – For any “on mobile” behavior, use `isMobileDevice()` from `@/lib/utils`. Do not add new UA regexes so mobile is handled consistently everywhere.
2. **Design for small viewport first** – Layout and copy should work on ~360px width; then scale up.
3. **Wallet is the main CTA on mobile** – Keep “Connect wallet” / wallet button visible and tappable without scrolling.
4. **Touch targets** – Buttons and links ≥44px; use `touch-manipulation` and avoid hover-only interactions.
5. **Test on real devices** – Phantom/Solflare in-app browsers, iOS Safari, Android Chrome; test connect, sign, and return-from-wallet flows.
6. **Performance** – Prefer smaller bundles and lazy load below-the-fold content; mobile networks are slower.
7. **Errors** – Messages should mention mobile (e.g. “Try WiFi or mobile data”, “Use a private RPC for mobile”).

## Key files

- `lib/utils.ts` – `isMobileDevice()`, `isAndroidDevice()`; use these for all mobile detection.
- `components/WalletProvider.tsx` – Mobile wallet adapters and autoConnect.
- `components/WalletConnectButton.tsx` – Mobile redirect, deep-link cleanup, cancel timeout.
- `components/SolflareTouchFix.tsx` – Touch→click fallback for all mobile (uses `isMobileDevice()`).
- `components/Header.tsx` – Mobile hamburger; wallet always visible on small screens.
- `app/dashboard/page.tsx` – Mobile wallet stabilize delay, 401 retry, “Preparing…” state.
- `app/globals.css` – `mobile-wallet-context`, touch targets, safe area.
- `app/manifest.ts` – PWA manifest for install and standalone.
