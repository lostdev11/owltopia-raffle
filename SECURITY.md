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
- **Raffle POST** validates required fields, dates, duration (max 7 days), currency allowlist, and creation fee (with on-chain verification for non-admins).
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
- **Raffle/entry creation** uses server-side verification (creation fee tx, entry confirmation RPC).

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
