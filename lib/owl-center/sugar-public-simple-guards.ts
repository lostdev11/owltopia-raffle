import { dateTime, none, some, sol } from '@metaplex-foundation/umi'
import type { DefaultGuardSetArgs } from '@metaplex-foundation/mpl-core-candy-machine'

import {
  resolvePublicSimpleGuardStartDateIso,
  type PublicSimpleMintWindowLaunch,
} from '@/lib/owl-center/phase-schedule'

/** Candy Guard mintLimit id for public_simple (must match mintArgs on mint). */
export const PUBLIC_SIMPLE_MINT_LIMIT_ID = 1

export type PublicSimpleGuardOpts = {
  walletMintLimit?: number
  startDateIso?: string | null
}

export function clampPublicSimpleWalletMintLimit(raw: number | null | undefined): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return 5
  return Math.min(50, Math.max(1, n))
}

export function publicSimpleGuardOptsFromLaunch(
  launch: PublicSimpleMintWindowLaunch & { wallet_mint_limit?: number }
): PublicSimpleGuardOpts {
  return {
    walletMintLimit: clampPublicSimpleWalletMintLimit(launch.wallet_mint_limit),
    startDateIso: resolvePublicSimpleGuardStartDateIso(launch),
  }
}

/** Sugar CLI config.json guards (free mint + per-wallet cap + optional startDate). */
export function publicSimpleSugarGuardsConfig(opts?: PublicSimpleGuardOpts) {
  const limit = clampPublicSimpleWalletMintLimit(opts?.walletMintLimit)
  const startDateIso = opts?.startDateIso?.trim() || null
  return {
    default: {
      botTax: {
        value: 0.001,
        lastInstruction: false,
      },
      mintLimit: {
        id: PUBLIC_SIMPLE_MINT_LIMIT_ID,
        limit,
      },
      ...(startDateIso ? { startDate: { date: startDateIso } } : {}),
    },
  }
}

/** Metaplex UMI default guard set for create/updateCandyGuard. */
export function publicSimpleCandyGuardUmiGuards(opts?: PublicSimpleGuardOpts): Partial<DefaultGuardSetArgs> {
  const limit = clampPublicSimpleWalletMintLimit(opts?.walletMintLimit)
  const startDateIso = opts?.startDateIso?.trim() || null
  const botTax = some({ lamports: sol(0.001), lastInstruction: false })
  const mintLimit = some({ id: PUBLIC_SIMPLE_MINT_LIMIT_ID, limit })
  if (startDateIso) {
    return {
      botTax,
      mintLimit,
      startDate: some({ date: dateTime(startDateIso) }),
    }
  }
  return {
    botTax,
    mintLimit,
    startDate: none(),
  }
}

/** @deprecated Use publicSimpleCandyGuardUmiGuards — kept for botTax field reads. */
export function publicSimpleCandyGuardGuards(opts?: PublicSimpleGuardOpts) {
  const limit = clampPublicSimpleWalletMintLimit(opts?.walletMintLimit)
  return {
    botTax: {
      lamports: 1_000_000n,
      lastInstruction: false,
    },
    mintLimit: {
      id: PUBLIC_SIMPLE_MINT_LIMIT_ID,
      limit,
    },
    startDateIso: opts?.startDateIso?.trim() || null,
  }
}
