# OKX Wallet “potential phishing site” warning

Guide for Owltopia (`www.owltopia.xyz`) when users see a full-page interstitial from the **OKX Wallet browser extension** (or OKX in-app browser):

> “You’re visiting a potential phishing site”

Buttons are typically **Back to safety** / **Continue anyway**, with a note like **Detected by browser extension.** Wording may vary slightly by OKX build / locale.

This is **not** the same as Phantom’s “This dApp could be malicious” transaction-simulation banner. See [`PHANTOM_DOMAIN_REVIEW.md`](PHANTOM_DOMAIN_REVIEW.md) for that case.

---

## What causes it

**OKX Wallet’s browser extension / in-app browser** intercepts navigation when its proprietary malicious-domain database flags the host (or URL). Copy on the real OKX sheet mentions that OKX’s model frequently updates to catch malware/malicious sites, and that users can visit OKX support / provide feedback if they believe the site is incorrectly blacklisted.

It is **not** rendered by Owltopia:

- No matching overlay strings ship in our HTML/JS.
- Production HTML for raffle pages only loads our Next.js chunks (no OKX / GoPlus / ScamSniffer script injection).

So if Discord users ask “what wallet is showing that?”, the answer is almost always: **whoever has the OKX Wallet extension (or OKX in-app browser) installed** — Phantom / Solflare alone do not show this interstitial.

---

## What we checked (public reputation)

Re-checked **2026-08-17**:

| Source | `owltopia.xyz` / `www.owltopia.xyz` |
| --- | --- |
| Phantom [`blocklist`](https://github.com/phantom/blocklist) | Not listed |
| MetaMask `eth-phishing-detect` | Not listed |
| ScamSniffer domain blacklist | Not listed |
| GoPlus `phishing_site` API | `0` (not flagged) for apex and `www` |
| Site HTML phishing overlay | None |
| Production site | `https://www.owltopia.xyz` returns HTTP 200 |

Conclusion: this is an **OKX-proprietary** flag (false positive relative to the public feeds above), not a site compromise and not something a code deploy can clear by itself.

### Likely contributors to the false positive

1. **Young `.xyz` domain** — `owltopia.xyz` was registered **2026-01-05** (Hostinger → Vercel DNS). New / low-reputation domains are commonly over-flagged.
2. **URL shape overlap with known NFT phishing campaigns** — classic scam paths look like `…/raffles/legendary-…` (e.g. fake MetaMask “legendary dragon NFT” raffles). Our real raffle slugs can match that pattern (e.g. `/raffles/legendary-dumpster-14`) even though the host is legitimate.
3. **User / partner reports** into OKX’s database, or heuristics shared with OKX exchange security infra.

---

## How to clear it (owner actions)

Code changes cannot remove OKX’s client-side block. Do this:

### 1. In-extension false-positive report

On the OKX interstitial, use any **report / feedback that this site doesn’t contain threats** (or “incorrectly blacklisted”) control for `https://www.owltopia.xyz`. Ask a few trusted community members with OKX installed to do the same.

### 2. Contact OKX Web3 / safety support

Open a ticket via [OKX Support](https://www.okx.com/help) / Web3 FAQ, or email historically used for security reports: `safety@okx.com` (confirm the current channel on the OKX help site before sending).

**Copy-paste appeal (edit as needed):**

```text
Subject: False positive phishing block — www.owltopia.xyz (OKX Wallet extension)

Hello OKX Web3 / Safety team,

Our production dApp https://www.owltopia.xyz is being blocked by the OKX Wallet
browser extension with the interstitial:

  “You’re visiting a potential phishing site”
  (Detected by browser extension — Back to safety / Continue anyway)

This appears to be a false positive. Please review and whitelist / remove the flag.

Legitimacy pack:
- Official site: https://www.owltopia.xyz
- Product: Owltopia / Owl Raffle — Solana NFT raffles, nesting, Owl Send, Owl Center
- Hosting: Vercel; DNS for owltopia.xyz
- Domain registered: 2026-01-05
- Public reputation (checked 2026-08-17):
  - GoPlus phishing_site = 0 (apex + www)
  - Not listed on Phantom blocklist, MetaMask eth-phishing-detect, or ScamSniffer
- Community: Discord / X linked from the site footer and docs

We do not ask for seed phrases or private keys. Wallet connection uses standard
Wallet Standard / Solana wallet adapters.

Thank you for reviewing.
```

### 3. Confirm which wallet is warning

Ask the reporting user to confirm **OKX Wallet** is the extension (chrome://extensions or the wallet’s own settings). If they only run Phantom, they are looking at a different warning — see [`PHANTOM_DOMAIN_REVIEW.md`](PHANTOM_DOMAIN_REVIEW.md).

### Optional hygiene (may help heuristics over time; will not instantly unblock)

- Keep `NEXT_PUBLIC_SITE_URL` / wallet `appIdentity.uri` on `https://www.owltopia.xyz`
- Prefer clear branding on raffle pages (already Owltopia-branded)
- Raffle URLs are sanitized so phishing-shaped segments (`legendary`, `dragon`, `metamask`, …) are stripped from new slugs; existing bad slugs are redirected (see `lib/raffles/slugify.ts` + `lib/raffles/slug-aliases.ts`)
- After deploy, full admins can rename a live row: `POST /api/admin/raffles/:id/rename-slug` with `{ "useCanonicalAlias": true }` (e.g. `legendary-dumpster-14` → `dumpster-14`)

---

## Quick Discord reply template

> GM — thanks for the heads up. That full-page “potential phishing site” sheet (**Back to safety** / **Continue anyway**, “Detected by browser extension”) is from **OKX Wallet’s** built-in domain blocklist, not from Owltopia. Our site doesn’t show that UI. `owltopia.xyz` isn’t on Phantom / MetaMask / ScamSniffer / GoPlus public phishing lists we checked — so this looks like an OKX false positive. If you have OKX installed, use their report/feedback that the site is incorrectly flagged (or “Continue anyway” only if you already trust us), or open the link in Phantom/Solflare / a browser without OKX while we appeal it with OKX support.
