# Wallet support

Owltopia uses `@solana/wallet-adapter-react` plus Wallet Standard discovery. Do **not** replace this stack with Reown AppKit without a dedicated migration — mobile browse redirects, MWA, and SIWS all assume wallet-adapter hooks.

## Supported today

| Wallet | How it connects | Notes |
|--------|-----------------|-------|
| Phantom | Wallet Standard (auto) | Mobile: browse UL / in-app |
| Jupiter | Wallet Standard (auto) | Mobile: open site in Jupiter globe browser |
| Backpack | Wallet Standard (auto) | Mobile: browse UL |
| Solflare | Explicit adapter (+ mobile subclass) | Mobile: browse UL |
| Coinbase / Trust | Explicit adapters | |
| Solana Mobile (MWA) | Explicit on mobile | Prefer on Seeker |
| **MetaMask Solana** | `@metamask/connect-solana` → Wallet Standard | Best on **desktop extension** or **MetaMask in-app browser**. Mobile Chrome Android has a known Wallet Adapter bug. MetaMask mobile supports **mainnet only** (no Solana devnet/testnet). |

Init: [`lib/metamask-connect-solana.ts`](../lib/metamask-connect-solana.ts) runs `createSolanaClient` before [`WalletProvider`](../components/WalletProvider.tsx) mounts.

**Support one-liner:** MetaMask Solana is supported on the desktop extension; on mobile use Phantom/Solflare or MetaMask’s in-app browser.

## Follow-up: WalletConnect / Reown (not shipped)

ARC suggested Reown (WalletConnect). Packages exist transitively under `@solana/wallet-adapter-wallets` but are **not** registered.

To add later **without** AppKit UI rewrite:

1. Create a project at [dashboard.reown.com](https://dashboard.reown.com).
2. Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (see `.env.example`).
3. Instantiate `WalletConnectWalletAdapter` in `WalletProvider` with site metadata aligned to `NEXT_PUBLIC_SITE_URL` / www.
4. Expand CSP `frame-src` if WC verify/QR iframes are blocked (today only Solflare + Coinbase are listed).
5. QA SIWS, raffle buy, nesting, OwlSend with a WC-connected wallet.

Do **not** swap the app onto `@reown/appkit` hooks for Solana until MetaMask Solana support in AppKit is solid and mobile redirect UX is redesigned.
