# Security mindset

We approach everything with a **security-first mindset**—code, API design, and even how we commit—so attackers and exploiters have no reason and no help from us.

## Principles

1. **Never trust the client** for amounts, identity, or critical state. Validate and derive server-side.
2. **Minimize information leakage.** API responses use a single generic error for all failures; success responses return only what the frontend needs.
3. **Rate limit and lock.** Protect create/verify and other sensitive flows with per-IP and per-wallet limits; use DB-level constraints and atomic operations to prevent replay and race conditions.
4. **Auth properly.** Admin and sensitive actions require cryptographic session or signature; do not rely on headers/body alone.
5. **No secrets in repo.** No `.env`, keys, or `NEXT_PUBLIC_*` with secrets. No debug endpoints or credentials in code or history.

## Commit guidelines (security-safe history)

- **Do not describe exploits or attack steps** in commit messages. Public history must not serve as reconnaissance for attackers.
- **Use neutral, factual language.** Prefer:
  - “Harden entry verification”
  - “Restrict entry deletion to pending”
  - “Use generic API error body”
  over:
  - “Fix double-spend by invalidating previous entry IDs”
  - “Prevent attacker from reusing same tx for multiple entries”
- **Keep messages short and professional.** If a change is security-related, say “security” or “harden” without detailing the vulnerability.
- **Never commit** secrets, env files, temporary debug code, or commented-out credentials.

These guidelines keep the repository safe and professional and give attackers no extra reason or information.
