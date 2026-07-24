/**
 * Temporary Candy Guard `team` group for Gen2 leftover mint after the public pool is exhausted.
 * Enable adds the group (free + freeze); disable removes it and leaves gen1/pre/wl/pub intact.
 */
import bs58 from 'bs58'
import { publicKey, sol, some } from '@metaplex-foundation/umi'
import {
  getMerkleRoot,
  updateCandyGuard,
  type DefaultGuardSet,
} from '@metaplex-foundation/mpl-candy-machine'

import {
  loadGen2CandyGuard,
  loadGen2GuardAuthorityUmi,
  resolveGen2FreezeDistributionWallet,
  resolveGen2FreezeIds,
} from '@/lib/owl-center/gen2-freeze-thaw'
import { getGen2MintProceedsWalletAddress } from '@/lib/owl-center/gen2-mint-proceeds'
import { GEN2_TEAM_GUARD_LABEL } from '@/lib/solana/gen2-guards'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export { GEN2_TEAM_GUARD_LABEL } from '@/lib/solana/gen2-guards'

const FREEZE_DEPOSIT_SOL = 0
const BOT_TAX_SOL = 0.001

export function parseGen2TeamMintWallets(extra?: string | null): string[] {
  const fromEnv = (process.env.GEN2_TEAM_MINT_WALLETS ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const extras = extra?.trim() ? [extra.trim()] : []
  const set = new Set<string>()
  for (const w of [...fromEnv, ...extras]) {
    const n = normalizeSolanaWalletAddress(w)
    if (n) set.add(n)
  }
  return [...set]
}

function freezeGuard(dest: string) {
  return some({
    lamports: sol(FREEZE_DEPOSIT_SOL),
    destination: publicKey(dest),
  })
}

function buildTeamGuards(wallets: string[], totalSupply: number, dest: string): DefaultGuardSet {
  const shared = {
    redeemedAmount: some({ maximum: BigInt(totalSupply) }),
    freezeSolPayment: freezeGuard(dest),
  }

  if (wallets.length === 1) {
    return {
      addressGate: some({ address: publicKey(wallets[0]!) }),
      ...shared,
    } as unknown as DefaultGuardSet
  }

  return {
    allowList: some({ merkleRoot: getMerkleRoot(wallets) }),
    ...shared,
  } as unknown as DefaultGuardSet
}

export async function enableGen2TeamBackstopGuards(params: {
  teamWallets: string[]
  totalSupply: number
  candyMachineId?: string
}): Promise<{ signature: string; wallets: string[] }> {
  const wallets = params.teamWallets
  if (wallets.length === 0) {
    throw new Error('At least one team wallet is required')
  }
  const dest = resolveGen2FreezeDistributionWallet()
  const ids = resolveGen2FreezeIds({ candyMachineId: params.candyMachineId })
  const umi = loadGen2GuardAuthorityUmi(ids.rpcUrl)
  const { guard } = await loadGen2CandyGuard(umi, ids.candyMachineId)

  const otherGroups = guard.groups
    .filter((g) => g.label !== GEN2_TEAM_GUARD_LABEL)
    .map((g) => ({ label: g.label, guards: g.guards }))

  const teamGuards = buildTeamGuards(wallets, params.totalSupply, dest)
  const groups = [...otherGroups, { label: GEN2_TEAM_GUARD_LABEL, guards: teamGuards }]

  const res = await updateCandyGuard(umi, {
    candyGuard: guard.publicKey,
    guards: guard.guards,
    groups,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

  return { signature: bs58.encode(res.signature), wallets }
}

export async function disableGen2TeamBackstopGuards(params?: {
  candyMachineId?: string
}): Promise<{ signature: string; removed: boolean }> {
  const ids = resolveGen2FreezeIds({ candyMachineId: params?.candyMachineId })
  const umi = loadGen2GuardAuthorityUmi(ids.rpcUrl)
  const { guard } = await loadGen2CandyGuard(umi, ids.candyMachineId)

  const hadTeam = guard.groups.some((g) => g.label === GEN2_TEAM_GUARD_LABEL)
  if (!hadTeam) {
    return { signature: '', removed: false }
  }

  const groups = guard.groups
    .filter((g) => g.label !== GEN2_TEAM_GUARD_LABEL)
    .map((g) => ({ label: g.label, guards: g.guards }))

  // Keep default botTax if somehow empty.
  const defaults = guard.guards
  const hasBotTax = Boolean(
    defaults && 'botTax' in defaults && (defaults as { botTax?: { __option?: string } }).botTax
  )
  const guards = hasBotTax
    ? defaults
    : ({ botTax: some({ lamports: sol(BOT_TAX_SOL), lastInstruction: false }) } as typeof defaults)

  const res = await updateCandyGuard(umi, {
    candyGuard: guard.publicKey,
    guards,
    groups,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

  return { signature: bs58.encode(res.signature), removed: true }
}

export async function gen2TeamGuardPresent(candyMachineId?: string): Promise<boolean> {
  const ids = resolveGen2FreezeIds({ candyMachineId })
  const umi = loadGen2GuardAuthorityUmi(ids.rpcUrl)
  const { guard } = await loadGen2CandyGuard(umi, ids.candyMachineId)
  return guard.groups.some((g) => g.label === GEN2_TEAM_GUARD_LABEL)
}

export function getGen2TeamBackstopMerkleWallets(stored: string[] | undefined): string[] {
  if (stored && stored.length > 0) return stored
  return parseGen2TeamMintWallets()
}

/** Resolve proceeds wallet for freeze dest checks (exported for diagnostics). */
export function gen2BackstopDistributionConfigured(): boolean {
  return Boolean(getGen2MintProceedsWalletAddress())
}
