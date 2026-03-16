# Troubleshooting

## 403 Forbidden on API routes (/api/raffles, /api/time, /api/proxy-image)

If the **browser** gets `403 (Forbidden)` when calling your own APIs (e.g. `GET https://www.owltopia.xyz/api/raffles`), the response is usually **not** coming from the Next.js route handlers (they don’t return 403 for those endpoints). It’s typically from the hosting layer in front of the app.

### Check on Vercel

1. **Deployment Protection**
   - Project → **Settings** → **Deployment Protection**
   - If **“Vercel Authentication”** or **“Password Protection”** is on, unauthenticated requests get 403. Turn it off for production or add your domain to the allowlist.
   - If **“Attack Challenge Mode”** is on, some requests (e.g. from certain clients or referrers) may get 403; try “Standard” or adjust rules.

2. **Firewall**
   - **Settings** → **Firewall**
   - Ensure there are no rules blocking your own domain or the `/api/*` paths.

3. **Preview vs Production**
   - Confirm the URL you’re opening is the **production** deployment, not a preview that might be protected.

After changing settings, redeploy or wait for cache to clear; then test again.

### Proxy-image and Arweave

If the request **does** reach the app and the proxy fetches from Arweave, the proxy will:
- Retry once with a `Referer` header if Arweave returns 403.
- Try an alternate Arweave gateway (`arweave.dev`) if the first fails.

That only helps when the 403 is from **Arweave** (upstream). If the client sees 403 on `GET …/api/proxy-image?url=...`, the block is still at the host (e.g. Vercel) before the request hits the app.
