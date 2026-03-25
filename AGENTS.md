# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Owl Raffle (Owltopia) is a **Solana-blockchain-based raffle platform** built as a single Next.js 16 application. All backend logic runs as Next.js API routes (no separate backend service).

### Tech stack

- **Next.js 16** (App Router) with **React 19**, **TypeScript**, **Tailwind CSS 3.4**, **shadcn/ui**
- **Supabase** (hosted PostgreSQL + RLS + Realtime + Storage) — no local Supabase instance
- **Solana** blockchain integration (wallet adapter, SPL tokens, Metaplex NFTs)
- **npm** package manager with `legacy-peer-deps=true` (`.npmrc`)

### Running the app

- `npm run dev` — starts the Next.js dev server (Turbopack by default) on port 3000
- `npm run dev:webpack` — alternative using webpack bundler
- `npm run build` — production build (uses `--webpack` flag; see `BUILD_NOTES.md` for context)

### Lint / Test / Build

- **Lint**: `next lint` is not available as a standalone CLI command in Next.js 16. ESLint 8 is installed but no `.eslintrc` config file exists in the repo, so `npx eslint .` will also fail without one.
- **Tests**: No test framework is configured (no jest/vitest/playwright in dependencies).
- **Build**: `npm run build` (uses webpack). A `postinstall` script patches Next.js for a global-error prerender issue — this runs automatically on `npm install`.

### Environment variables

The app requires a `.env.local` file. See `.env.example` for the full list. The critical ones:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase credentials (required for data features)
- `NEXT_PUBLIC_SOLANA_RPC_URL` / `SOLANA_RPC_URL` — Solana RPC endpoint
- `RAFFLE_RECIPIENT_WALLET` — treasury wallet address
- `SESSION_SECRET` — admin auth session signing (min 16 chars)

Without real Supabase credentials the app still starts and the UI renders, but data-fetching routes return errors (e.g., "Missing Supabase config" on `/raffles`).

### Gotchas

- The `postinstall` script (`scripts/postinstall-next-global-error.js`) patches `node_modules/next/dist/build/index.js` to skip `/_global-error` prerendering. This must run after every `npm install`.
- The build command uses `--webpack` because the production build fails under Turbopack for this project.
- Database migrations (43 SQL files in `supabase/migrations/`) must be applied via the Supabase Dashboard SQL Editor — there is no local Supabase CLI config.
