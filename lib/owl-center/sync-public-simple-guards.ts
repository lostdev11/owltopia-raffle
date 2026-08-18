import 'server-only'

import bs58 from 'bs58'
import { isSome, publicKey, type Option } from '@metaplex-foundation/umi'
import {
  fetchCandyMachine as fetchTmCandyMachine,
  safeFetchCandyGuard as safeFetchTmCandyGuard,
  updateCandyGuard as updateTmCandyGuard,
} from '@metaplex-foundation/mpl-candy-machine'

import {
  buildPublicSimpleGuardPlan,
  type PublicSimpleGuardPlan,
} from '@/lib/owl-center/public-simple-guard-plan'
import {
  publicSimpleCandyGuardUmiGroupsFromPlan,
  publicSimpleCandyGuardUmiGuardsFromPlan,
} from '@/lib/owl-center/sugar-public-simple-guards'
import { createIrysDeployerCoreUmi } from '@/lib/owl-center/core-cm-deploy-onchain'
import { createIrysDeployerUmi } from '@/lib/owl-center/sugar-deploy-onchain'
import {
  fetchCandyMachine,
  safeFetchCandyGuard,
  updateCandyGuard,
} from '@/lib/solana/core-candy-machine'
import { getLaunchCandyMachineId, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export type PublicSimpleGuardSyncResult =
  | { ok: true; status: 'updated'; signature: string }
  | { ok: true; status: 'skipped'; reason: string }
  | { ok: true; status: 'noop'; reason: string }
  | { ok: false; error: string }

type DateOpt = Option<{ date: number | bigint | string }> | null | undefined
type PayOpt =
  | Option<{ lamports: { basisPoints: bigint | number | string }; destination: unknown }>
  | null
  | undefined

function optionUnixSeconds(opt: DateOpt): string {
  if (!opt || !isSome(opt)) return ''
  const n = BigInt(opt.value.date)
  const sec = n > 10_000_000_000n ? n / 1000n : n
  return String(sec)
}

function optionSolPayment(opt: PayOpt): string {
  if (!opt || !isSome(opt)) return 'none'
  return `${opt.value.lamports.basisPoints}:${String(opt.value.destination)}`
}

function isoUnixSeconds(iso: string | null | undefined): string {
  if (!iso?.trim()) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return String(Math.floor(ms / 1000))
}

function guardFingerprint(input: {
  mintLimit: Option<{ id: number; limit: number }> | null | undefined
  startDate: DateOpt
  endDate?: DateOpt
  solPayment: PayOpt
  groups: Array<{
    label: string
    guards: { startDate: DateOpt; endDate: DateOpt; solPayment: PayOpt }
  }>
}): string {
  const limit =
    input.mintLimit && isSome(input.mintLimit)
      ? `${input.mintLimit.value.id}:${input.mintLimit.value.limit}`
      : 'none'
  const groupBits = [...input.groups]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(
      (g) =>
        `${g.label}|${optionUnixSeconds(g.guards.startDate)}|${optionUnixSeconds(g.guards.endDate)}|${optionSolPayment(g.guards.solPayment)}`
    )
    .join(';')
  return [
    limit,
    optionUnixSeconds(input.startDate),
    optionUnixSeconds(input.endDate),
    optionSolPayment(input.solPayment),
    groupBits,
  ].join('#')
}

function planMatchesOnChain(current: string, plan: PublicSimpleGuardPlan): boolean {
  const bits = current.split('#')
  const wantStart = plan.groups.length > 0 ? '' : isoUnixSeconds(plan.defaultStartDateIso)
  const wantPay =
    plan.groups.length > 0 || plan.defaultSolLamports <= 0n || !plan.destination
      ? 'none'
      : `${plan.defaultSolLamports}:${plan.destination}`
  const wantGroups = [...plan.groups]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((g) => {
      const pay =
        g.solLamports > 0n && plan.destination ? `${g.solLamports}:${plan.destination}` : 'none'
      return `${g.label}|${isoUnixSeconds(g.startDateIso)}|${isoUnixSeconds(g.endDateIso)}|${pay}`
    })
    .join(';')

  return (
    bits[0] === `1:${plan.walletMintLimit}` &&
    bits[1] === wantStart &&
    bits[2] === '' &&
    bits[3] === wantPay &&
    bits[4] === wantGroups
  )
}

/**
 * Push wallet mintLimit, startDate, solPayment, and phase groups onto a public_simple Candy Guard.
 * Best-effort: mint-config saves still succeed if the deployer key is not the guard authority.
 */
export async function syncPublicSimpleCandyGuards(
  launch: OwlCenterLaunchPublic
): Promise<PublicSimpleGuardSyncResult> {
  if (launch.mint_mode !== 'public_simple') {
    return { ok: true, status: 'skipped', reason: 'not_public_simple' }
  }

  const network = resolveLaunchMintNetwork(launch)
  const cmId = getLaunchCandyMachineId(launch, network)?.trim()
  if (!cmId) {
    return { ok: true, status: 'skipped', reason: 'no_candy_machine' }
  }

  const planned = await buildPublicSimpleGuardPlan(launch)
  if (!planned.ok) return { ok: false, error: planned.error }

  const nextDefault = publicSimpleCandyGuardUmiGuardsFromPlan(planned.plan)
  const nextGroups = publicSimpleCandyGuardUmiGroupsFromPlan(planned.plan)

  try {
    if (launch.mint_standard === 'token_metadata') {
      const umi = createIrysDeployerUmi(network)
      const cm = await fetchTmCandyMachine(umi, publicKey(cmId))
      const guard = await safeFetchTmCandyGuard(umi, cm.mintAuthority)
      if (!guard) return { ok: false, error: 'Candy Guard not found for this Candy Machine' }
      if (String(guard.authority) !== String(umi.identity.publicKey)) {
        return {
          ok: false,
          error: 'Deployer wallet is not the Candy Guard authority — on-chain cap/date/price were not updated',
        }
      }
      const current = guardFingerprint({
        mintLimit: guard.guards.mintLimit,
        startDate: guard.guards.startDate,
        endDate: guard.guards.endDate,
        solPayment: guard.guards.solPayment,
        groups: guard.groups.map((g) => ({
          label: g.label,
          guards: {
            startDate: g.guards.startDate,
            endDate: g.guards.endDate,
            solPayment: g.guards.solPayment,
          },
        })),
      })
      if (planMatchesOnChain(current, planned.plan)) {
        return { ok: true, status: 'noop', reason: 'already_current' }
      }
      const builder = updateTmCandyGuard(umi, {
        candyGuard: guard.publicKey,
        guards: {
          ...guard.guards,
          botTax: isSome(guard.guards.botTax) ? guard.guards.botTax : nextDefault.botTax,
          mintLimit: nextDefault.mintLimit,
          startDate: nextDefault.startDate,
          endDate: nextDefault.endDate,
          solPayment: nextDefault.solPayment,
        },
        groups: nextGroups,
      })
      const result = await builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
      const signature = typeof result.signature === 'string' ? result.signature : bs58.encode(result.signature)
      return { ok: true, status: 'updated', signature }
    }

    const umi = createIrysDeployerCoreUmi(network)
    const cm = await fetchCandyMachine(umi, publicKey(cmId))
    const guard = await safeFetchCandyGuard(umi, cm.mintAuthority)
    if (!guard) return { ok: false, error: 'Candy Guard not found for this Candy Machine' }
    if (String(guard.authority) !== String(umi.identity.publicKey)) {
      return {
        ok: false,
        error: 'Deployer wallet is not the Candy Guard authority — on-chain cap/date/price were not updated',
      }
    }
    const current = guardFingerprint({
      mintLimit: guard.guards.mintLimit,
      startDate: guard.guards.startDate,
      endDate: guard.guards.endDate,
      solPayment: guard.guards.solPayment,
      groups: guard.groups.map((g) => ({
        label: g.label,
        guards: {
          startDate: g.guards.startDate,
          endDate: g.guards.endDate,
          solPayment: g.guards.solPayment,
        },
      })),
    })
    if (planMatchesOnChain(current, planned.plan)) {
      return { ok: true, status: 'noop', reason: 'already_current' }
    }
    const builder = updateCandyGuard(umi, {
      candyGuard: guard.publicKey,
      guards: {
        ...guard.guards,
        botTax: isSome(guard.guards.botTax) ? guard.guards.botTax : nextDefault.botTax,
        mintLimit: nextDefault.mintLimit,
        startDate: nextDefault.startDate,
        endDate: nextDefault.endDate,
        solPayment: nextDefault.solPayment,
      },
      groups: nextGroups,
    })
    const result = await builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
    const signature = typeof result.signature === 'string' ? result.signature : bs58.encode(result.signature)
    return { ok: true, status: 'updated', signature }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('irys_private_key') || msg.toLowerCase().includes('not configured')) {
      return { ok: true, status: 'skipped', reason: 'deployer_key_missing' }
    }
    return { ok: false, error: msg }
  }
}
