# OKX Wallet “potential phishing site” warning

Guide for Owltopia (`www.owltopia.xyz`) when users see a full-page interstitial:

> “You’re visiting a potential phishing site”

with **Leave this page** / **Continue anyway** (wording may vary slightly by OKX build / locale).

This is **not** the same as Phantom’s “This dApp could be malicious” transaction-simulation banner. See [`PHANTOM_DOMAIN_REVIEW.md`](PHANTOM_DOMAIN_REVIEW.md) for that case.

---

## What causes it

**OKX Wallet’s browser extension / in-app browser** intercepts navigation when its proprietary malicious-domain database flags the host (or URL). Copy on the real OKX sheet mentions that OKX integrates multiple secure databases to block malicious sites, and offers a **Report that this site doesn’t contain threats** link.

It is **not** rendered by Owltopia:

- No matching overlay strings ship in our HTML/JS.
- Production HTML for raffle pages only loads our Next.js chunks (no OKX / GoPlus / ScamSniffer script injection).

So if Discord users ask “what wallet is showing that?”, the answer is almost always: **whoever has the OKX Wallet extension (or OKX in-app browser) installed** — Phantom / Solflare alone do not show this interstitial.

---

## What we checked (public reputation)

As of the investigation that produced this doc:

| Source | `owltopia.xyz` / `www.owltopia.xyz` |
| --- | --- |
| Phantom [`blocklist`](https://github.com/phantom/blocklist) | Not listed |
| MetaMask `eth-phishing-detect` | Not listed |
| ScamSniffer domain blacklist | Not listed |
| GoPlus `phishing_site` API | `0` (not flagged) |
| Site HTML phishing overlay | None |

Conclusion: this is an **OKX-proprietary** flag (false positive relative to the public feeds above), not a site compromise and not something a code deploy can clear by itself.

### Likely contributors to the false positive

1. **Young `.xyz` domain** — `owltopia.xyz` was registered **2026-01-05** (Hostinger → Vercel DNS). New / low-reputation domains are commonly over-flagged.
2. **URL shape overlap with known NFT phishing campaigns** — classic scam paths look like `…/raffles/legendary-…` (e.g. fake MetaMask “legendary dragon NFT” raffles). Our real raffle slugs can match that pattern (e.g. `/raffles/legendary-dumpster-14`) even though the host is legitimate.
3. **User / partner reports** into OKX’s database, or heuristics shared with OKX exchange security infra.

---

## How to clear it (owner actions)

Code changes cannot remove OKX’s client-side block. Do this:

1. On the OKX interstitial, use **Report that this site doesn’t contain threats** (false-positive report) for `https://www.owltopia.xyz`.
2. Contact OKX Web3 / safety support with the exact origin and a short legitimacy pack:
   - Production URL: `https://www.owltopia.xyz`
   - Example path that was flagged (if any)
   - Domain registration + Vercel hosting
   - Discord / X / docs proving the project
   - Note that major public blocklists are clean
   - Email historically used for security reports: `safety@okx.com` (confirm current channel via [OKX Support](https://www.okx.com/help) / Web3 FAQ)
3. Ask the reporting user to confirm **OKX Wallet** is the extension (chrome://extensions or the wallet’s own settings). If they only run Phantom, they are looking at a different warning — see [`PHANTOM_DOMAIN_REVIEW.md`](PHANTOM_DOMAIN_REVIEW.md).

Optional hygiene (may help heuristics over time; will not instantly unblock):

- Keep `NEXT_PUBLIC_SITE_URL` / wallet `appIdentity.uri` on `https://www.owltopia.xyz`
- Prefer clear branding on raffle pages (already Owltopia-branded)
- Avoid slug patterns that twin famous phishing campaigns when creating high-visibility raffles, when practical

---

## Quick Discord reply template

> That full-page “potential phishing site” sheet is from **OKX Wallet’s** built-in domain blocklist, not from Owltopia. Our site doesn’t show that UI. `owltopia.xyz` isn’t on Phantom / MetaMask / ScamSniffer / GoPlus public phishing lists we checked — so this looks like an OKX false positive. If you have OKX installed, use “Report that this site doesn’t contain threats,” or open the link in Phantom/Solflare / a browser without OKX while we appeal it.
