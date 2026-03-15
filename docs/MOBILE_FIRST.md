# Mobile-first focus

**~75% of our users are on mobile, using mobile crypto wallets.** All product and UX decisions should prioritize mobile.

## What we already do

- **Wallet stack**: Solana Mobile Wallet Adapter (MWA), Solflare mobile adapter with `redirect_link`, Phantom/Coinbase/Trust; Android blank-page and deep-link handling; iOS Solflare in-app browser.
- **Touch**: 44px+ tap targets, `touch-action: manipulation`, Solflare touch fix, wallet modal tuned for mobile.
- **Layout**: Responsive breakpoints, mobile hamburger nav with **wallet as primary CTA** in the header (no crowding).
- **PWA**: `app/manifest.ts` for Add to Home Screen and standalone mode.
- **Safe area**: `env(safe-area-inset-*)` for notches and home indicator.
- **Raffle flows**: Timeouts and errors tuned for mobile (slower networks, RPC CORS); `lastValidBlockHeight` set for Android MWA.

## Guidelines for new work

1. **Design for small viewport first** – Layout and copy should work on ~360px width; then scale up.
2. **Wallet is the main CTA on mobile** – Keep “Connect wallet” / wallet button visible and tappable without scrolling.
3. **Touch targets** – Buttons and links ≥44px; use `touch-manipulation` and avoid hover-only interactions.
4. **Test on real devices** – Phantom/Solflare in-app browsers, iOS Safari, Android Chrome; test connect, sign, and return-from-wallet flows.
5. **Performance** – Prefer smaller bundles and lazy load below-the-fold content; mobile networks are slower.
6. **Errors** – Messages should mention mobile (e.g. “Try WiFi or mobile data”, “Use a private RPC for mobile”).

## Key files

- `components/WalletProvider.tsx` – Mobile wallet adapters and autoConnect.
- `components/WalletConnectButton.tsx` – Mobile redirect, deep-link cleanup, cancel timeout.
- `components/Header.tsx` – Mobile hamburger; wallet always visible on small screens.
- `app/globals.css` – `mobile-wallet-context`, touch targets, safe area.
- `app/manifest.ts` – PWA manifest for install and standalone.
