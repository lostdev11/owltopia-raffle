# Phantom Domain & Transaction Warnings

Guide for Owltopia (`owltopia.xyz`) based on Phantom’s official docs:

https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings

Phantom shows **different** warnings for domain reputation vs transaction simulation. Do not treat them as the same issue.

---

## 1. New domain warning

**User sees:**

> “This domain is new or has not been reviewed yet. Proceed with caution.”

**Cause:** Newly detected domain; automatic review usually clears it in a few days.

**What we do:**

1. Register the app in the [Phantom Developer Portal](https://docs.phantom.com/phantom-portal/edit-app-info) and complete DNS TXT verification for `owltopia.xyz`.
2. Fill branding: name Owl Raffle / Owltopia, icon `https://owltopia.xyz/icon.png`, socials, description.
3. If the warning remains **more than a week**, contact Phantom’s domain review team (form linked from the docs page above; historically `review@phantom.com`).

**Usually no code change** clears this warning.

---

## 2. Transaction simulation warning (most common “malicious” prompt)

**User sees:**

> “This dApp could be malicious. Do not proceed unless you are certain it is safe.”

**Cause:** Phantom/Blowfish could not safely simulate the transaction before signing — **not** the same as the new-domain message.

Phantom’s remediation checklist:

| Recommendation | Owltopia status |
| --- | --- |
| Limit the transaction to **one signer** (fee payer) | Most raffle / payment / escrow deposit txs are single-signer. Gen2 candy-machine mints still need mint keypair (+ optional server cosigner on free phases). |
| Multi-signer: Phantom **`signTransaction` first**, then other signers (not `signAndSendTransaction`) | Free / gated mint: wallet signs first, then `/api/owl-center/gen2/cosign-mint`, then send — matches docs. **Paid public mint (Phantom):** wallet `signAllTransactions` (fee payer) first, then mint keypair(s), then broadcast — matches docs. Allowlist route (single signer) still uses `signAndSend`. |
| Near size limit: **split** txs or use **Address Lookup Tables** | Gen2 mints one NFT per tx; allowlist route is a separate tx. |
| Pre-simulate with **`sigVerify: false`** on your RPC before prompting the wallet | Shared helper on Phantom `signAndSend` / UMI escrow deposit paths (`lib/solana/phantom-presimulate.ts`). Failed sims surface before the wallet sheet. |
| Prefer **`signAndSendTransaction`** so Blowfish can inject [Lighthouse](https://docs.phantom.com/developer-powertools/lighthouse) guards | `useSendTransactionForWallet` + `sendTransactionPreferPhantomSignAndSend`. Do **not** use UMI `walletAdapterIdentity` + `sendAndConfirm` for Phantom user flows. |

### Code map

- `lib/hooks/useSendTransactionForWallet.ts` — default client send path for Phantom
- `lib/solana/phantom-sign-and-send-transaction.ts` — injected `signAndSendTransaction` / `signAndSendAllTransactions`
- `lib/solana/phantom-presimulate.ts` — `sigVerify: false` preflight
- `lib/solana/phantom-safe-umi-send.ts` — noop UMI identity + guards for NFT escrow / Core / cNFT
- `lib/solana/send-umi-builder-via-wallet.ts` — unsigned UMI build → wallet send
- `lib/solana/gen2-mint.ts` — Phantom batch mint vs cosign multi-signer path

If simulation warnings persist after the checklist, use the domain review form linked in Phantom’s docs.

---

## 3. Prediction market token burn warning

**User sees:**

> “This transaction will burn a valuable prediction market token…”

**Not applicable** to Owltopia raffle / mint / nesting flows. If it ever appears, contact Phantom Trust & Safety via the form on the docs page — do not try to work around burns in-app.

---

## Portal & blocklist checklist

1. [Phantom Portal — Edit App Info](https://docs.phantom.com/phantom-portal/edit-app-info) + [Verify Domain](https://docs.phantom.com/phantom-portal/verify-domain)
2. [Go-Live Checklist](https://docs.phantom.com/best-practices/go-live-checklist)
3. Confirm `owltopia.xyz` is not on [phantom/blocklist](https://github.com/phantom/blocklist) (false positive → PR to remove / whitelist)
4. App identity / MWA / OG tags already use `owltopia.xyz` and `/icon.png`

---

## User workarounds (temporary)

While a review is pending:

- Proceed only if they trust Owltopia (not ideal to recommend broadly)
- Solflare / other Wallet Standard wallets remain available in the app

---

## Engineering follow-ups

1. Keep every new user-facing send on `useSendTransactionForWallet` (no raw `useWallet().sendTransaction` for Phantom).
2. Keep user txs **unsigned** until the wallet prompt; never attach site partial signers on the same Phantom prompt when avoidable.
3. When adding multi-signer flows, follow Phantom’s order: **wallet `signTransaction` → other signers → broadcast**, not `signAndSend` with foreign signatures missing. Gen2 paid public mint already does this for Phantom.
4. Pre-sim failures should be user-readable (insufficient SOL, missing ATA, wrong accounts) so users never hit the “malicious” sheet for a doomed tx.
