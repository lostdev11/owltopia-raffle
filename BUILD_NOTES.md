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

3. **Next.js patch** (in `node_modules/next/dist/build/index.js`)  
   The `/_global-error` route is still prerendered by Next even when the root is dynamic. To avoid the build error, that route is skipped in two places:

   - In the `sortedStaticPaths.forEach` that fills `defaultMap` (around line 1745): add  
     `if (originalAppPath === _entryconstants.UNDERSCORE_GLOBAL_ERROR_ROUTE_ENTRY) return;`  
     at the start of the callback.
   - In the `sortedStaticPaths.forEach` that runs prerender (around line 1873): add the same line at the start of the callback.

**After `npm install`**, if the build fails again on `/_global-error`, re-apply the two one-line changes above in `node_modules/next/dist/build/index.js`.
