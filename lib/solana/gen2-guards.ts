import bs58 from 'bs58'
import { isSome, some, type Option, type PublicKey, type TransactionBuilder, type Umi } from '@metaplex-foundation/umi'
import { createGen2CosignerNoopSigner } from '@/lib/solana/gen2-cosigner'
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
import { MINT_SOLANA_RPC_RETRY, withSolanaRpcRetry } from '@/lib/solana/rpc-retry'

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
 * - `team` — Temporary admin leftover mint after public pool exhausts (free + freeze).
 *
 * Override the phase → label mapping with the `NEXT_PUBLIC_GEN2_GUARD_GROUP_*` env vars
 * (value `none` mints against the default guard set with no group).
 */

/** Temporary Candy Guard group for Gen2 team backstop mint (max 6 chars). */
export const GEN2_TEAM_GUARD_LABEL = 'team'

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
  /**
   * Total enforced SOL the wallet pays the candy guard per NFT (lamports): `solPayment` price plus
   * any `freezeSolPayment` deposit. Free phases are 0. Used to size the pre-sign balance check so an
   * under-funded WL/public mint is blocked BEFORE signing instead of bot-taxing (fees charged, no
   * NFT, mint price never taken).
   */
  mintPriceLamports: bigint
  /** Set when the resolved guard set has an allowList — caller must ensure the proof PDA first. */
  allowListMerkleRoot: Uint8Array | null
  /**
   * Set (base58) when the group has a `thirdPartySigner` guard. The mint must be co-signed by this
   * server-held key, so the client signs with a placeholder slot and rounds the txs through
   * `/api/owl-center/gen2/cosign-mint` to have the server fill it (see `lib/solana/gen2-cosigner.ts`).
   */
  thirdPartySignerKey: string | null
}

export type Gen2GuardPlanResult = { ok: true; plan: Gen2GuardMintPlan } | { ok: false; error: string }

/**
 * Guards the in-app minter cannot satisfy (need extra signers / token accounts we do not wire).
 * `thirdPartySigner` is intentionally NOT here: it IS supported, via the server co-sign round-trip
 * (the free gen1/presale phases use it to enforce per-wallet limits the chain can't express).
 */
const UNSUPPORTED_GUARDS: ReadonlyArray<keyof DefaultGuardSet> = [
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
  phase: Gen2MintablePhase,
  opts?: { groupLabelOverride?: string | null }
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

  let groupLabel =
    opts?.groupLabelOverride !== undefined ? opts.groupLabelOverride : gen2GuardGroupLabel(phase)
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
  let thirdPartySignerKey: string | null = null
  let mintPriceLamports = 0n

  if (isSome(guards.endDate)) {
    const endMs = Number(guards.endDate.value.date)
    if (Number.isFinite(endMs) && Date.now() > endMs) {
      return {
        ok: false,
        error:
          phase === 'AIRDROP' || phase === 'PRESALE' || phase === 'PRESALE_OVERAGE'
            ? 'This free redemption phase closed on-chain — the team is extending the window; refresh in a minute or contact support.'
            : 'This mint phase closed on-chain — refresh the page or contact support.',
      }
    }
  }

  if (isSome(guards.thirdPartySigner)) {
    // Placeholder signer reserves the co-signer's signature slot; the server fills it in the
    // cosign-mint round-trip after verifying the wallet's remaining credits.
    const signerKey = guards.thirdPartySigner.value.signerKey
    thirdPartySignerKey = String(signerKey)
    mintArgs.thirdPartySigner = some({ signer: createGen2CosignerNoopSigner(signerKey) })
  }
  if (isSome(guards.solPayment)) {
    mintArgs.solPayment = some({ destination: guards.solPayment.value.destination })
    mintPriceLamports += guards.solPayment.value.lamports.basisPoints
  }
  if (isSome(guards.freezeSolPayment)) {
    mintArgs.freezeSolPayment = some({ destination: guards.freezeSolPayment.value.destination })
    mintPriceLamports += guards.freezeSolPayment.value.lamports.basisPoints
  }
  if (isSome(guards.mintLimit)) {
    mintArgs.mintLimit = some({ id: guards.mintLimit.value.id })
  }
  if (isSome(guards.allowList)) {
    allowListMerkleRoot = new Uint8Array(guards.allowList.value.merkleRoot)
    mintArgs.allowList = some({ merkleRoot: allowListMerkleRoot })
  }
  // botTax / startDate / endDate / redeemedAmount / addressGate / programGate need no mintArgs.

  return {
    ok: true,
    plan: { candyMachine, candyGuard, groupLabel, mintArgs, mintPriceLamports, allowListMerkleRoot, thirdPartySignerKey },
  }
}

type WlProofResponse = {
  merkle_root?: string
  proof?: string[]
  error?: string
}

export type Gen2AllowListRoutePlan =
  | { includeRoute: false }
  | { includeRoute: true; merkleRoot: Uint8Array; merkleProof: Uint8Array[] }

async function fetchGen2WlProofResponse(
  wallet: PublicKey,
  phase: string
): Promise<{ ok: true; body: WlProofResponse } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `/api/owl-center/gen2/wl-proof?wallet=${encodeURIComponent(String(wallet))}&phase=${encodeURIComponent(phase)}`
    )
    const body = (await res.json()) as WlProofResponse
    if (!res.ok) {
      return { ok: false, error: body.error || 'Allowlist proof lookup failed' }
    }
    return { ok: true, body }
  } catch {
    return { ok: false, error: 'Allowlist proof lookup failed — check your connection and retry.' }
  }
}

function validateGen2WlProofBody(
  body: WlProofResponse,
  merkleRoot: Uint8Array
): { ok: true; merkleProof: Uint8Array[] } | { ok: false; error: string } {
  if (!body.merkle_root || !Array.isArray(body.proof)) {
    return { ok: false, error: 'Allowlist proof response malformed' }
  }
  if (body.merkle_root !== bs58.encode(merkleRoot)) {
    return {
      ok: false,
      error: 'Allowlist out of sync — on-chain merkle root does not match the server list. Contact the team.',
    }
  }
  return { ok: true, merkleProof: body.proof.map((p) => bs58.decode(p)) }
}

/**
 * Resolve whether the mint transaction must include the candy guard allowList `route` (proof) ix.
 * When the proof PDA already exists, returns `includeRoute: false`. Otherwise fetches merkle proof
 * from `/api/owl-center/gen2/wl-proof` so the route ix can be batched into the same tx as `mintV2`.
 */
export async function resolveGen2AllowListRoutePlan(
  umi: Umi,
  args: {
    candyMachine: PublicKey
    candyGuard: PublicKey
    groupLabel: string | null
    merkleRoot: Uint8Array
    /** Mint phase or TEAM_BACKSTOP for the temporary team guard allowList. */
    phase: Gen2MintablePhase | 'TEAM_BACKSTOP'
  }
): Promise<{ ok: true; plan: Gen2AllowListRoutePlan } | { ok: false; error: string }> {
  const { candyMachine, candyGuard, merkleRoot, phase } = args
  const user = umi.identity.publicKey

  const [existing, proofRes] = await Promise.all([
    withSolanaRpcRetry(
      () => safeFetchAllowListProofFromSeeds(umi, { merkleRoot, user, candyGuard, candyMachine }),
      MINT_SOLANA_RPC_RETRY
    ),
    fetchGen2WlProofResponse(user, phase),
  ])

  if (existing) return { ok: true, plan: { includeRoute: false } }
  if (!proofRes.ok) return proofRes

  const validated = validateGen2WlProofBody(proofRes.body, merkleRoot)
  if (!validated.ok) return validated

  return {
    ok: true,
    plan: {
      includeRoute: true,
      merkleRoot,
      merkleProof: validated.merkleProof,
    },
  }
}

/** Append allowList proof route ix to a mint transaction builder (runs before `mintV2` in the same tx). */
export function appendGen2AllowListRouteInstruction(
  umi: Umi,
  builder: TransactionBuilder,
  args: {
    candyMachine: PublicKey
    candyGuard: PublicKey
    groupLabel: string | null
    merkleRoot: Uint8Array
    merkleProof: Uint8Array[]
  }
): TransactionBuilder {
  return builder.add(
    route(umi, {
      candyMachine: args.candyMachine,
      candyGuard: args.candyGuard,
      guard: 'allowList',
      group: args.groupLabel,
      routeArgs: { path: 'proof', merkleRoot: args.merkleRoot, merkleProof: args.merkleProof },
    })
  )
}
