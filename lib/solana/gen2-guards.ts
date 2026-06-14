import bs58 from 'bs58'
import { isSome, some, type Option, type PublicKey, type Umi } from '@metaplex-foundation/umi'
import {
  fetchCandyMachine,
  safeFetchCandyGuard,
  safeFetchAllowListProofFromSeeds,
  route,
  type CandyGuard,
  type CandyMachine,
  type DefaultGuardSet,
  type DefaultGuardSetMintArgs,
} from '@metaplex-foundation/mpl-candy-machine'

import type { OwlCenterPhase } from '@/lib/owl-center/types'

/**
 * Candy Machine V3 guard-group wiring for the Gen2 mainnet mint.
 *
 * On-chain guard group convention (labels are limited to 6 chars by the candy guard program):
 * - `gen1` — GEN1 holder airdrop phase (free; allowList merkle of the admin-taken Gen1 holder
 *   snapshot — `gen2_gen1_airdrop_snapshot`, served by `/api/owl-center/gen2/wl-proof?phase=AIRDROP`).
 * - `pre`  — Presale + Presale+13 redemption (free, already paid in USDC; allowList merkle of
 *   paid presale wallets served by `/api/owl-center/gen2/wl-proof?phase=PRESALE`).
 * - `wl`   — Whitelist (solPayment at WL price + allowList merkle of `owl_center_wl_allocations`
 *   wallets served by `/api/owl-center/gen2/wl-proof?phase=WHITELIST`).
 * - `pub`  — Public (solPayment at public price + optional mintLimit / botTax).
 *
 * Override the phase → label mapping with the `NEXT_PUBLIC_GEN2_GUARD_GROUP_*` env vars
 * (value `none` mints against the default guard set with no group).
 */

export type Gen2MintablePhase = 'AIRDROP' | 'PRESALE' | 'PRESALE_OVERAGE' | 'WHITELIST' | 'PUBLIC'

const DEFAULT_GROUP_LABELS: Record<Gen2MintablePhase, string> = {
  AIRDROP: 'gen1',
  PRESALE: 'pre',
  PRESALE_OVERAGE: 'pre',
  WHITELIST: 'wl',
  PUBLIC: 'pub',
}

/** Static member access required so Next.js inlines NEXT_PUBLIC_* into the client bundle. */
function envGroupOverride(phase: Gen2MintablePhase): string | undefined {
  switch (phase) {
    case 'AIRDROP':
      return process.env.NEXT_PUBLIC_GEN2_GUARD_GROUP_AIRDROP
    case 'PRESALE':
      return process.env.NEXT_PUBLIC_GEN2_GUARD_GROUP_PRESALE
    case 'PRESALE_OVERAGE':
      return process.env.NEXT_PUBLIC_GEN2_GUARD_GROUP_PRESALE_OVERAGE
    case 'WHITELIST':
      return process.env.NEXT_PUBLIC_GEN2_GUARD_GROUP_WHITELIST
    case 'PUBLIC':
      return process.env.NEXT_PUBLIC_GEN2_GUARD_GROUP_PUBLIC
  }
}

export function isGen2MintablePhase(phase: OwlCenterPhase): phase is Gen2MintablePhase {
  return phase in DEFAULT_GROUP_LABELS
}

/** Guard group label for a phase; `null` means mint against default guards (no group). */
export function gen2GuardGroupLabel(phase: Gen2MintablePhase): string | null {
  const env = envGroupOverride(phase)?.trim()
  if (env) return env.toLowerCase() === 'none' ? null : env
  return DEFAULT_GROUP_LABELS[phase]
}

export type Gen2GuardMintPlan = {
  candyMachine: CandyMachine
  /** Null when the CM mint authority is not a candy guard (unguarded CM). */
  candyGuard: CandyGuard | null
  /** Group label to pass to `mintV2` / `route`; null = default guard set. */
  groupLabel: string | null
  mintArgs: Partial<DefaultGuardSetMintArgs>
  /** Set when the resolved guard set has an allowList — caller must ensure the proof PDA first. */
  allowListMerkleRoot: Uint8Array | null
}

export type Gen2GuardPlanResult = { ok: true; plan: Gen2GuardMintPlan } | { ok: false; error: string }

/** Guards the in-app minter cannot satisfy (need extra signers / token accounts we do not wire). */
const UNSUPPORTED_GUARDS: ReadonlyArray<keyof DefaultGuardSet> = [
  'thirdPartySigner',
  'tokenPayment',
  'token2022Payment',
  'tokenGate',
  'tokenBurn',
  'nftPayment',
  'nftGate',
  'nftBurn',
  'gatekeeper',
  'allocation',
  'freezeTokenPayment',
]

/** Group guards override default guards per-guard (candy guard program semantics). */
function mergeGuardSets(defaults: DefaultGuardSet, group: DefaultGuardSet | null): DefaultGuardSet {
  if (!group) return defaults
  const merged: Record<string, Option<unknown>> = { ...(defaults as unknown as Record<string, Option<unknown>>) }
  for (const [key, value] of Object.entries(group as unknown as Record<string, Option<unknown>>)) {
    if (isSome(value)) merged[key] = value
  }
  return merged as unknown as DefaultGuardSet
}

/**
 * Fetch CM + candy guard, select the guard group for the phase, and build `mintArgs`
 * for every active guard. Fails fast (before any wallet signature) on misconfiguration.
 */
export async function buildGen2GuardMintPlan(
  umi: Umi,
  candyMachinePk: PublicKey,
  phase: Gen2MintablePhase
): Promise<Gen2GuardPlanResult> {
  const candyMachine = await fetchCandyMachine(umi, candyMachinePk)
  const candyGuard = await safeFetchCandyGuard(umi, candyMachine.mintAuthority)

  if (!candyGuard) {
    return {
      ok: false,
      error:
        'Candy Guard not deployed for this Candy Machine. Owl Center mints require a guard — from your Sugar folder run `sugar guard add` (set `guards` in config.json first; `npm run prepare:sugar-deploy` includes defaults).',
    }
  }

  let groupLabel = gen2GuardGroupLabel(phase)
  let groupGuards: DefaultGuardSet | null = null

  if (candyGuard.groups.length > 0) {
    if (!groupLabel) {
      return {
        ok: false,
        error: `Candy guard uses groups (${candyGuard.groups.map((g) => g.label).join(', ')}) but no group is mapped for phase ${phase}.`,
      }
    }
    const group = candyGuard.groups.find((g) => g.label === groupLabel)
    if (!group) {
      return {
        ok: false,
        error: `Guard group "${groupLabel}" for phase ${phase} not found on-chain (available: ${candyGuard.groups.map((g) => g.label).join(', ')}).`,
      }
    }
    groupGuards = group.guards
  } else {
    // No groups configured on-chain — mint against the default guard set.
    groupLabel = null
  }

  const guards = mergeGuardSets(candyGuard.guards, groupGuards)

  for (const name of UNSUPPORTED_GUARDS) {
    if (isSome(guards[name] as Option<unknown>)) {
      return { ok: false, error: `Candy guard "${String(name)}" is enabled for phase ${phase} but not supported by the site minter.` }
    }
  }

  const mintArgs: Partial<DefaultGuardSetMintArgs> = {}
  let allowListMerkleRoot: Uint8Array | null = null

  if (isSome(guards.solPayment)) {
    mintArgs.solPayment = some({ destination: guards.solPayment.value.destination })
  }
  if (isSome(guards.freezeSolPayment)) {
    mintArgs.freezeSolPayment = some({ destination: guards.freezeSolPayment.value.destination })
  }
  if (isSome(guards.mintLimit)) {
    mintArgs.mintLimit = some({ id: guards.mintLimit.value.id })
  }
  if (isSome(guards.allowList)) {
    allowListMerkleRoot = new Uint8Array(guards.allowList.value.merkleRoot)
    mintArgs.allowList = some({ merkleRoot: allowListMerkleRoot })
  }
  // botTax / startDate / endDate / redeemedAmount / addressGate / programGate need no mintArgs.

  return { ok: true, plan: { candyMachine, candyGuard, groupLabel, mintArgs, allowListMerkleRoot } }
}

type WlProofResponse = {
  merkle_root?: string
  proof?: string[]
  error?: string
}

/**
 * Ensure the allowList proof PDA exists for the connected wallet (candy guard `route` instruction).
 * Fetches the merkle proof from the server (`/api/owl-center/gen2/wl-proof`), which derives it from
 * the same DB tables used for site eligibility. No-op when the PDA was already created.
 */
export async function ensureGen2AllowListProof(
  umi: Umi,
  args: {
    candyMachine: PublicKey
    candyGuard: PublicKey
    groupLabel: string | null
    merkleRoot: Uint8Array
    phase: Gen2MintablePhase
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { candyMachine, candyGuard, groupLabel, merkleRoot, phase } = args
  const user = umi.identity.publicKey

  const existing = await safeFetchAllowListProofFromSeeds(umi, { merkleRoot, user, candyGuard, candyMachine })
  if (existing) return { ok: true }

  let body: WlProofResponse
  try {
    const res = await fetch(
      `/api/owl-center/gen2/wl-proof?wallet=${encodeURIComponent(String(user))}&phase=${encodeURIComponent(phase)}`
    )
    body = (await res.json()) as WlProofResponse
    if (!res.ok) {
      return { ok: false, error: body.error || 'Allowlist proof lookup failed' }
    }
  } catch {
    return { ok: false, error: 'Allowlist proof lookup failed — check your connection and retry.' }
  }

  if (!body.merkle_root || !Array.isArray(body.proof)) {
    return { ok: false, error: 'Allowlist proof response malformed' }
  }
  if (body.merkle_root !== bs58.encode(merkleRoot)) {
    return {
      ok: false,
      error: 'Allowlist out of sync — on-chain merkle root does not match the server list. Contact the team.',
    }
  }

  const merkleProof = body.proof.map((p) => bs58.decode(p))
  await route(umi, {
    candyMachine,
    candyGuard,
    guard: 'allowList',
    group: groupLabel,
    routeArgs: { path: 'proof', merkleRoot, merkleProof },
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

  return { ok: true }
}
