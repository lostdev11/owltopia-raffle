# Game plan: Raffles online + Enter Owl Topia

## Phase 1: Raffles working (Supabase team advice)

**Already done:**
- Single path: server uses only `getRafflesViaRest()` (no second Supabase client call).
- Shorter timeouts: 8–10s total, 1 retry, 4s per attempt (fail fast; client fallback takes over).
- `Connection: keep-alive` on REST fetch; tighter defaults in `getRafflesViaRest`.

**Validation checklist:**
1. **Single-request test (Supabase suggestion):** After 30+ seconds of no traffic, open `/raffles` (or call GET `/api/raffles` once). Note: success/fail and latency. If it succeeds quickly, cold start is the main issue.
2. **Deploy and test:** Hit `/` (entry page) first, then click Enter → `/raffles`. Entry page warms the runtime; raffles should load more reliably.
3. **If timeouts persist:** Check whether they happen on the *first* request after idle (cold start). Client fallback (API + direct Supabase from browser) should still load raffles when server times out.

---

## Phase 2: Enter Owl Topia (page before raffles)

**Goal:** A page before raffles that (1) warms the server, (2) improves perceived performance, (3) gives a clear “Enter” moment with animation.

**Flow:**
- **`/`** (home): Renders “Enter Owl Topia” with logo + entrance animation. Optional: warm-up fetch to `/api/raffles` on mount so backend is warm when user clicks Enter.
- User clicks **Enter** → navigates to **`/raffles`**.
- Raffles load (server or client fallback).

**Implementation:**
- Entry page at `app/page.tsx` (no redirect; render entry UI).
- Client component: Logo, “Enter Owl Topia” copy, animated Enter button, optional warm-up fetch.
- Tailwind keyframes: subtle fade-in + scale (and optional glow) for entrance.

---

## Summary

| Step | Action |
|------|--------|
| 1 | Raffles: single path, short timeouts ✅ (done) |
| 2 | Validate with single-request test + deploy |
| 3 | Entry page “Enter Owl Topia” with animation |
| 4 | Home = entry page; Enter → /raffles |
