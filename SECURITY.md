# Security

This document summarizes security practices and findings for Owl Raffle Site.

## Security measures in place

### Authentication & authorization

- **Sign-In with Solana (SIWS)**  
  Admin and session auth use wallet signature verification (tweetnacl). Nonces are single-use and time-limited (5 min). Session cookies are HMAC-SHA256 signed with `SESSION_SECRET` and verified with `timingSafeEqual`.

- **Session cookie**  
  `owl_session` is `httpOnly`, `secure` in production, `sameSite: 'lax'`, and has a 24h TTL.

- **Admin routes**  
  Privileged API routes use `requireAdminSession` or `requireFullAdminSession` from `lib/auth-server.ts`. Full admin is required for Owl Vision, winner selection, NFT transfer, announcements, and config. Raffle creation and image upload require at least `requireAdminSession` or `requireSession` where appropriate.

### Input validation

- **Zod schemas** in `lib/validations.ts` for:
  - Entry create: `raffleId` (UUID), `walletAddress` (Solana base58), `ticketQuantity` (1–1000).
  - Auth verify: wallet, message, signature.
  - Profile: `displayName` (1–32 chars, trimmed).
- **Raffle POST** validates required fields, dates, duration (max 7 days), and currency allowlist.
- **Entries GET** now validates `raffleId` as UUID before querying the DB.

### Rate limiting

- In-memory rate limiting (`lib/rate-limit.ts`) on:
  - Raffle creation: 20 req/min per IP.
  - Entry creation: 30 req/min per IP, 10 req/min per wallet.
  - Admin check: 60 req/min per IP (added in security pass).
- For multi-instance production, consider a shared store (e.g. Redis/Upstash).

### Error handling

- **`lib/safe-error.ts`** redacts env-like strings (e.g. `SESSION_SECRET`, `SUPABASE_*`) from client-facing messages. Production API responses use a generic “Internal server error” for 5xx.
- **Upload route** no longer returns Supabase `uploadError.message` or `details` in production; only a generic failure message.

### Data layer

- **Supabase**: Parameterized queries via client (`.eq()`, `.insert()`, etc.); no raw SQL with user input. Service role key is server-only (`lib/supabase-admin.ts`); client uses anon key only.
- **Raffle/entry creation** uses server-side verification (entry confirmation RPC).

### XSS mitigation

- **Markdown**: `MarkdownContent` uses `react-markdown` (no raw HTML). Links use `target="_blank"` and `rel="noopener noreferrer"`.
- **LinkifiedText**: `lib/linkify.ts` only matches `https?://` URLs (no `javascript:` or `data:`).
- **Layout** uses `dangerouslySetInnerHTML` only for a static, hardcoded script (console error filter); no user input.

### Headers (next.config.js)

- **HSTS** (max-age=1 year, includeSubDomains, preload)
- **X-Frame-Options**: SAMEORIGIN
- **X-Content-Type-Options**: nosniff
- **Referrer-Policy**: strict-origin-when-cross-origin
- **Permissions-Policy**: geolocation/microphone/camera disabled; fullscreen=self
- **Content-Security-Policy**: default-src 'self'; script/style/connect/img/font directives tuned for Next, wallet adapters, and RPC; object-src 'none'; base-uri/form-action 'self'; upgrade-insecure-requests

### Secrets

- `.env.example` documents required vars. Sensitive keys (`SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RAFFLE_RECIPIENT_WALLET`) are server-only and not prefixed with `NEXT_PUBLIC_`.

---

## Information disclosure (accepted / mitigated)

- **GET /api/admin/check?wallet=...**  
  Intentionally unauthenticated so the UI can show “Sign in as admin” for any wallet. It reveals whether a given wallet is an admin. Mitigations: rate limit (60/min per IP) and wallet format validation (Solana base58). If you prefer to hide admin status entirely, change this to require a session and return only the current user’s admin status.

---

## Dependency vulnerabilities (npm audit)

- **High**: `bigint-buffer` (via `@solana/spl-token`), `elliptic` (via wallet adapters / WalletConnect / Trezor), `flatted`, `minimatch` (ReDoS).  
  Some require `npm audit fix --force` (breaking changes). Review and upgrade when possible; many live in wallet/blockchain stacks where upgrades are slower.
- **Recommendation**: Run `npm audit` regularly; apply non-breaking fixes; track and plan upgrades for transitive dependencies (e.g. Solana/WalletConnect ecosystem).

---

## Recommendations

1. **Production rate limiting**  
   Use a shared store (e.g. Upstash Redis) for rate limits so limits apply across all instances.

2. **Admin check**  
   If you want to hide “who is admin” from the world, make `/api/admin/check` session-only and return admin status only for the authenticated wallet.

3. **Dependencies**  
   Periodically run `npm audit` and `npm update`; follow Solana/wallet-adapter release notes for security-related updates.

4. **CSP**  
   Current CSP allows `'unsafe-inline'` and `'unsafe-eval'` for Next and wallet adapters. If you introduce stricter nonces or hashes for scripts, you can tighten CSP further.

5. **Middleware**  
   There is no root `middleware.ts`. If you add one (e.g. for geo or auth redirects), keep security headers in `next.config.js` as they are applied there.

---

*Last security review: March 2025. Hardening applied: admin/check rate limit and wallet validation; upload error response; entries GET raffleId UUID validation.*

---

## Security & domain notes: July 2026

### Wallet "this dApp could be malicious" warning

`owltopia.xyz` is **not** on any wallet/anti-phishing blocklist we checked (Phantom, Blowfish/ChainPatrol, ScamSniffer, Sinking Yachts, Google Safe Browsing — all clean or "unknown"). The warning users see is produced by Phantom's transaction scanner (**Blowfish**) treating an **unverified domain's outgoing transfer** cautiously — it shows up first when buying tickets because that is the first place the site asks the wallet to send funds. It is a domain-reputation/verification gap, not a code defect.

Clearing it is an owner action; code alone cannot lift a third-party wallet reputation flag:

1. **Verify the exact production origin, `www.owltopia.xyz`, with Phantom.** The apex `owltopia.xyz` redirects to `www`, so `www` is the host wallets actually see and the one that must be verified (DNS TXT in the Phantom Developer Portal). Registering only the apex will not clear it.
2. **Request a dApp review / allowlist** from Phantom (`review@phantom.com`) and Blowfish, referencing the verified domain. Steps in [`PHANTOM_DOMAIN_REVIEW.md`](PHANTOM_DOMAIN_REVIEW.md).
3. Keep `NEXT_PUBLIC_SITE_URL` and the wallet app identity pointed at that same host so the origin the wallet sees always equals the verified domain.

### Key-material hygiene

- `.gitignore` now ignores key material broadly (`*-keypair.json`, `*keypair*.json`, `governance-anchor/keys/*.json`, `*.key`, `id_rsa`) so keypairs cannot be committed by accident.
- Anchor / Solana program keypairs must be generated fresh at deploy time and kept out of the repo. Never deploy a program ID whose keypair has ever been committed; generate a new keypair and update the program ID before first deploy.

### Review scope

Authentication, payment verification, cron authorization, and admin access were reviewed. Detailed findings were shared privately with the maintainers rather than published here. Verified OK: cron routes require the shared secret; admin routes require an authenticated admin session; Discord interactions verify Ed25519; session cookies are HMAC-signed and constant-time compared; no live third-party secrets are present in the working tree (`.env.example` files hold placeholders and public on-chain addresses only).
