import { dateTime, lamports, none, publicKey, some, sol } from '@metaplex-foundation/umi'
import type { DefaultGuardSetArgs } from '@metaplex-foundation/mpl-core-candy-machine'

import type { PublicSimpleGuardPlan } from '@/lib/owl-center/public-simple-guard-plan'
import { PUBLIC_SIMPLE_PUBLIC_MINT_LIMIT_ID } from '@/lib/owl-center/public-simple-guard-plan'
import {
  resolvePublicSimpleGuardStartDateIso,
  type PublicSimpleMintWindowLaunch,
} from '@/lib/owl-center/phase-schedule'

/** @deprecated Prefer PUBLIC_SIMPLE_PUBLIC_MINT_LIMIT_ID — kept for existing imports. */
export const PUBLIC_SIMPLE_MINT_LIMIT_ID = PUBLIC_SIMPLE_PUBLIC_MINT_LIMIT_ID

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

function solPaymentGuard(
  lamportsAmt: bigint,
  destination: string | null
): DefaultGuardSetArgs['solPayment'] {
  if (lamportsAmt <= 0n || !destination) return none()
  return some({
    lamports: lamports(lamportsAmt),
    destination: publicKey(destination),
  })
}

function startDateGuard(iso: string | null | undefined): DefaultGuardSetArgs['startDate'] {
  const startDateIso = iso?.trim() || null
  return startDateIso ? some({ date: dateTime(startDateIso) }) : none()
}

function endDateGuard(iso: string | null | undefined): DefaultGuardSetArgs['endDate'] {
  const endDateIso = iso?.trim() || null
  return endDateIso ? some({ date: dateTime(endDateIso) }) : none()
}

function mintLimitGuard(id: number, limit: number): DefaultGuardSetArgs['mintLimit'] {
  return some({ id, limit })
}

function botTaxOnly() {
  return {
    botTax: some({ lamports: sol(0.001), lastInstruction: false }),
  }
}

function botTaxAndMintLimit(limit: number) {
  return {
    ...botTaxOnly(),
    mintLimit: mintLimitGuard(PUBLIC_SIMPLE_MINT_LIMIT_ID, limit),
  }
}

/**
 * Default Candy Guard set.
 * With phase groups: botTax only — each group carries its own mintLimit / price / window.
 * Without groups: botTax + shared mintLimit + startDate + solPayment on default.
 */
export function publicSimpleCandyGuardUmiGuardsFromPlan(
  plan: PublicSimpleGuardPlan
): Partial<DefaultGuardSetArgs> {
  if (plan.groups.length > 0) {
    return {
      ...botTaxOnly(),
      mintLimit: none(),
      startDate: none(),
      endDate: none(),
      solPayment: none(),
    }
  }
  return {
    ...botTaxAndMintLimit(plan.walletMintLimit),
    startDate: startDateGuard(plan.defaultStartDateIso),
    endDate: none(),
    solPayment: solPaymentGuard(plan.defaultSolLamports, plan.destination),
  }
}

export function publicSimpleCandyGuardUmiGroupsFromPlan(
  plan: PublicSimpleGuardPlan
): Array<{ label: string; guards: Partial<DefaultGuardSetArgs> }> {
  return plan.groups.map((group) => ({
    label: group.label,
    guards: {
      startDate: startDateGuard(group.startDateIso),
      endDate: endDateGuard(group.endDateIso),
      solPayment: solPaymentGuard(group.solLamports, plan.destination),
      mintLimit: mintLimitGuard(group.mintLimitId, group.walletMintLimit),
    },
  }))
}

/** @deprecated Prefer plan-based guards — kept for date/limit-only Sugar snapshots. */
export function publicSimpleCandyGuardUmiGuards(opts?: PublicSimpleGuardOpts): Partial<DefaultGuardSetArgs> {
  const limit = clampPublicSimpleWalletMintLimit(opts?.walletMintLimit)
  const startDateIso = opts?.startDateIso?.trim() || null
  const shared = botTaxAndMintLimit(limit)
  if (startDateIso) {
    return {
      ...shared,
      startDate: some({ date: dateTime(startDateIso) }),
    }
  }
  return {
    ...shared,
    startDate: none(),
  }
}

function sugarSolPayment(lamportsAmt: bigint, destination: string | null) {
  if (lamportsAmt <= 0n || !destination) return undefined
  return {
    value: Number(lamportsAmt) / 1_000_000_000,
    destination,
  }
}

function sugarDate(iso: string | null | undefined) {
  const v = iso?.trim()
  return v ? { date: v } : undefined
}

/** Sugar CLI config.json guards. */
export function publicSimpleSugarGuardsConfigFromPlan(plan: PublicSimpleGuardPlan) {
  if (plan.groups.length === 0) {
    const defaultGuards: Record<string, unknown> = {
      botTax: {
        value: 0.001,
        lastInstruction: false,
      },
      mintLimit: {
        id: PUBLIC_SIMPLE_MINT_LIMIT_ID,
        limit: plan.walletMintLimit,
      },
    }
    const start = sugarDate(plan.defaultStartDateIso)
    if (start) defaultGuards.startDate = start
    const pay = sugarSolPayment(plan.defaultSolLamports, plan.destination)
    if (pay) defaultGuards.solPayment = pay
    return { default: defaultGuards }
  }

  const defaultGuards: Record<string, unknown> = {
    botTax: {
      value: 0.001,
      lastInstruction: false,
    },
  }

  const groups: Record<string, { guards: Record<string, unknown> }> = {}
  for (const group of plan.groups) {
    const guards: Record<string, unknown> = {
      mintLimit: {
        id: group.mintLimitId,
        limit: group.walletMintLimit,
      },
    }
    const start = sugarDate(group.startDateIso)
    if (start) guards.startDate = start
    const end = sugarDate(group.endDateIso)
    if (end) guards.endDate = end
    const pay = sugarSolPayment(group.solLamports, plan.destination)
    if (pay) guards.solPayment = pay
    groups[group.label] = { guards }
  }
  return { default: defaultGuards, groups }
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
