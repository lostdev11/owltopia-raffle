# Build fix (Next.js 16 + webpack)

The production build was failing with:

- **`/admin`**: `TypeError: Cannot read properties of null (reading 'useMemo')`
- **`/_global-error`**: `TypeError: Cannot read properties of null (reading 'useContext')`

These happen when Next.js prerenders pages that use client components (wallet adapter, global error) and the client React context is not available during the build.

## What was changed

1. **`app/admin/layout.tsx`**  
   Added `export const dynamic = 'force-dynamic'` so `/admin` is not statically prerendered.

2. **`app/layout.tsx`**  
   Added `export const dynamic = 'force-dynamic'` so app routes are server-rendered on demand instead of at build time, avoiding the prerender React-null issue.

3. **Next.js global-error prerender skip**  
   The `/_global-error` route is still prerendered by Next even when the root is dynamic. To avoid the build error, a **postinstall script** (`scripts/postinstall-next-global-error.js`) applies the two one-line skips to `node_modules/next/dist/build/index.js` automatically after every `npm install` (including on Vercel). No manual patching needed.
