/**
 * Gen2 Candy Machine freezeSolPayment lifecycle (shared by CLI + admin/cron).
 *
 * All guard groups freeze to the same distribution wallet, so the freeze escrow PDA is shared —
 * init/unlock once; thaw each minted NFT at its current owner.
 */
import bs58 from 'bs58'
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
  type Umi,
} from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  fetchCandyMachine,
  mplCandyMachine,
  route,
  safeFetchCandyGuard,
  safeFetchFreezeEscrowFromSeeds,
  type CandyGuard,
  type CandyMachine,
  type FreezeEscrow,
} from '@metaplex-foundation/mpl-candy-machine'
import { TokenStandard } from '@metaplex-foundation/mpl-token-metadata'

import { getGen2MintProceedsWalletAddress } from '@/lib/owl-center/gen2-mint-proceeds'
import type { OwlCenterFreezeProgress } from '@/lib/owl-center/types'
import { getGen2CandyMachineId, getGen2CollectionMint } from '@/lib/solana/network'

export const GEN2_FREEZE_GROUP = 'pub'
export const GEN2_FREEZE_PERIOD_SECONDS = 30 * 24 * 60 * 60
/** Per cron/admin batch — keeps serverless invocations under typical time limits. */
export const GEN2_THAW_BATCH_SIZE = 30

export type Gen2DasAsset = { id: string; ownership?: { owner?: string } }

export type Gen2FreezeIds = {
  candyMachineId: string
  collectionMint: string
  rpcUrl: string
}

export function resolveGen2FreezeIds(overrides?: Partial<Gen2FreezeIds>): Gen2FreezeIds {
  const candyMachineId =
    overrides?.candyMachineId?.trim() ||
    getGen2CandyMachineId(null) ||
    process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID?.trim() ||
    'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
  const collectionMint =
    overrides?.collectionMint?.trim() ||
    getGen2CollectionMint(null) ||
    process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT?.trim() ||
    'GkLgT4KuwAPKeMSzfcPPmzuGimRNPvK1FWNPks4kzFVA'
  const rpcUrl =
    overrides?.rpcUrl?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    'https://api.mainnet-beta.solana.com'
  return { candyMachineId, collectionMint, rpcUrl }
}

export function resolveGen2FreezeDistributionWallet(): string {
  const dest = getGen2MintProceedsWalletAddress()
  if (!dest) {
    throw new Error(
      'GEN2_MINT_PROCEEDS_SECRET_KEY (or GEN2_MINT_PROCEEDS_WALLET) not set — must match the destination used in gen2-cm-setup guards.'
    )
  }
  return dest
}

export function loadGen2GuardAuthorityUmi(rpcUrl?: string): Umi {
  const raw = process.env.GEN2_GUARD_AUTHORITY_SECRET_KEY?.trim() || process.env.IRYS_PRIVATE_KEY?.trim()
  if (!raw) throw new Error('GEN2_GUARD_AUTHORITY_SECRET_KEY (or IRYS_PRIVATE_KEY) not set')
  let secret: Uint8Array
  try {
    secret = bs58.decode(raw)
  } catch {
    secret = Uint8Array.from(JSON.parse(raw) as number[])
  }
  const rpc = rpcUrl?.trim() || resolveGen2FreezeIds().rpcUrl
  const umi = createUmi(rpc, { commitment: 'confirmed' }).use(mplCandyMachine())
  const kp = umi.eddsa.createKeypairFromSecretKey(secret)
  umi.use(signerIdentity(createSignerFromKeypair(umi, kp)))
  return umi
}

export async function loadGen2CandyGuard(
  umi: Umi,
  candyMachineId: string
): Promise<{ cm: CandyMachine; guard: CandyGuard }> {
  const cm = await fetchCandyMachine(umi, publicKey(candyMachineId))
  const guard = await safeFetchCandyGuard(umi, cm.mintAuthority)
  if (!guard) throw new Error('No candy guard at CM mintAuthority.')
  if (String(guard.authority) !== String(umi.identity.publicKey)) {
    throw new Error(
      `Configured key ${umi.identity.publicKey} is not the guard authority ${guard.authority}.`
    )
  }
  return { cm, guard }
}

/** On-chain freeze escrow — `frozenCount` must be 0 before unlockFunds succeeds. */
export async function fetchGen2FreezeEscrow(ids?: Partial<Gen2FreezeIds>): Promise<FreezeEscrow | null> {
  const { candyMachineId, rpcUrl } = resolveGen2FreezeIds(ids)
  const umi = loadGen2GuardAuthorityUmi(rpcUrl)
  const DEST = resolveGen2FreezeDistributionWallet()
  const { guard } = await loadGen2CandyGuard(umi, candyMachineId)
  return safeFetchFreezeEscrowFromSeeds(umi, {
    destination: publicKey(DEST),
    candyGuard: guard.publicKey,
    candyMachine: publicKey(candyMachineId),
  })
}

export async function fetchGen2FrozenCount(ids?: Partial<Gen2FreezeIds>): Promise<number> {
  const escrow = await fetchGen2FreezeEscrow(ids)
  if (!escrow) return 0
  return Number(escrow.frozenCount)
}

function isBenignThawSkip(message: string): boolean {
  // Only treat true "already thawed / not frozen" as success-skips.
  // Owner mismatches must NOT be skipped — stale DAS ownership is a common cause of leftover frozenCount.
  return /already thawed|not frozen|AccountNotInitialized|0xbc4\b/i.test(message)
}

function isRetryableThawFailure(message: string): boolean {
  return /429|rate limit|blockhash|timed out|timeout|fetch failed|ECONNRESET|503|502|too many requests/i.test(
    message
  )
}

export async function fetchGen2CollectionAssets(
  collectionMint: string,
  rpcUrl: string
): Promise<Gen2DasAsset[]> {
  const out: Gen2DasAsset[] = []
  for (let page = 1; ; page++) {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'gen2-thaw',
        method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: collectionMint, page, limit: 1000 },
      }),
    })
    const json = (await res.json()) as {
      result?: { items?: Gen2DasAsset[] }
      error?: { message?: string }
    }
    if (json.error) throw new Error(`DAS getAssetsByGroup failed: ${json.error.message}`)
    const items = json.result?.items ?? []
    out.push(...items)
    if (items.length < 1000) break
  }
  return out
}

export async function initGen2FreezeEscrow(ids?: Partial<Gen2FreezeIds>): Promise<{ signature: string | null; already: boolean }> {
  const { candyMachineId, rpcUrl } = resolveGen2FreezeIds(ids)
  const umi = loadGen2GuardAuthorityUmi(rpcUrl)
  const DEST = resolveGen2FreezeDistributionWallet()
  const { guard } = await loadGen2CandyGuard(umi, candyMachineId)
  try {
    const res = await route(umi, {
      candyMachine: publicKey(candyMachineId),
      candyGuard: guard.publicKey,
      guard: 'freezeSolPayment',
      group: GEN2_FREEZE_GROUP,
      routeArgs: {
        path: 'initialize',
        destination: publicKey(DEST),
        period: GEN2_FREEZE_PERIOD_SECONDS,
        candyGuardAuthority: umi.identity,
      },
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
    return { signature: bs58.encode(res.signature), already: false }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/already in use|already initialized|already exists|FreezeEscrowAlreadyExists|0x1796|0x0\b/i.test(msg)) {
      return { signature: null, already: true }
    }
    throw e
  }
}

export type Gen2ThawBatchResult = {
  attempted: number
  thawed: number
  skipped: number
  failed: number
  remaining_unprocessed: number
  last_signature: string | null
  /** First hard failure message (not a benign already-thawed skip). */
  last_error: string | null
}

async function resolveNftOwner(
  umi: Umi,
  mint: string,
  dasOwner: string | undefined
): Promise<string | null> {
  if (dasOwner) return dasOwner
  try {
    const res = await umi.rpc.call('getTokenLargestAccounts', [mint])
    const value = (res as { value?: Array<{ address?: string; uiAmount?: number | null }> })?.value
    const ata = value?.find((v) => (v.uiAmount ?? 0) > 0)?.address
    if (!ata) return null
    const acct = await umi.rpc.getAccount(publicKey(ata))
    if (!acct.exists || acct.data.length < 64) return null
    // SPL Token account: mint(32) + owner(32) at offset 32
    return bs58.encode(acct.data.slice(32, 64))
  } catch {
    return null
  }
}

/**
 * Thaw up to `limit` assets that still have an owner. Caller should pass the full DAS list and
 * track progress via `offset` (skip already-processed indices from prior batches).
 */
export async function thawGen2AssetBatch(params: {
  assets: Gen2DasAsset[]
  offset?: number
  limit?: number
  ids?: Partial<Gen2FreezeIds>
}): Promise<Gen2ThawBatchResult> {
  const { candyMachineId, rpcUrl } = resolveGen2FreezeIds(params.ids)
  const umi = loadGen2GuardAuthorityUmi(rpcUrl)
  const DEST = resolveGen2FreezeDistributionWallet()
  const { guard, cm } = await loadGen2CandyGuard(umi, candyMachineId)
  const offset = Math.max(0, params.offset ?? 0)
  const limit = Math.max(1, params.limit ?? GEN2_THAW_BATCH_SIZE)
  const slice = params.assets.slice(offset, offset + limit)
  const tokenStandard =
    Number(cm.tokenStandard) === TokenStandard.ProgrammableNonFungible
      ? TokenStandard.ProgrammableNonFungible
      : TokenStandard.NonFungible

  let thawed = 0
  let skipped = 0
  let failed = 0
  let last_signature: string | null = null
  let last_error: string | null = null

  for (const a of slice) {
    let owner = await resolveNftOwner(umi, a.id, a.ownership?.owner)
    if (!owner) {
      skipped++
      continue
    }

    const tryThaw = async (nftOwner: string) =>
      route(umi, {
        candyMachine: publicKey(candyMachineId),
        candyGuard: guard.publicKey,
        guard: 'freezeSolPayment',
        group: GEN2_FREEZE_GROUP,
        routeArgs: {
          path: 'thaw',
          destination: publicKey(DEST),
          nftMint: publicKey(a.id),
          nftOwner: publicKey(nftOwner),
          nftTokenStandard: tokenStandard,
        },
      }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

    try {
      const res = await tryThaw(owner)
      thawed++
      last_signature = bs58.encode(res.signature)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (isBenignThawSkip(msg)) {
        skipped++
        continue
      }

      // Stale DAS owner — refresh from token account and retry once.
      if (/IncorrectOwner|owner does not match|invalid owner|0xbc4/i.test(msg)) {
        const refreshed = await resolveNftOwner(umi, a.id, undefined)
        if (refreshed && refreshed !== owner) {
          try {
            const res = await tryThaw(refreshed)
            thawed++
            last_signature = bs58.encode(res.signature)
            continue
          } catch (e2) {
            const msg2 = e2 instanceof Error ? e2.message : String(e2)
            if (isBenignThawSkip(msg2)) {
              skipped++
              continue
            }
            failed++
            last_error = msg2
            if (isRetryableThawFailure(msg2)) break
            continue
          }
        }
      }

      failed++
      last_error = msg
      if (isRetryableThawFailure(msg)) break
    }
  }

  // If we broke early on rate limits, only advance past successful/skipped work in this slice.
  const advanced =
    failed > 0 && last_error && isRetryableThawFailure(last_error)
      ? offset + thawed + skipped
      : Math.min(params.assets.length, offset + slice.length)

  return {
    attempted: Math.max(0, advanced - offset),
    thawed,
    skipped,
    failed,
    remaining_unprocessed: Math.max(0, params.assets.length - advanced),
    last_signature,
    last_error,
  }
}

/** Thaw every asset (CLI / full run). Prefer `thawGen2AssetBatch` under serverless time limits. */
export async function thawGen2AllAssets(ids?: Partial<Gen2FreezeIds>): Promise<{
  total: number
  thawed: number
  skipped: number
  failed: number
}> {
  const resolved = resolveGen2FreezeIds(ids)
  const assets = await fetchGen2CollectionAssets(resolved.collectionMint, resolved.rpcUrl)
  let thawed = 0
  let skipped = 0
  let failed = 0
  let offset = 0
  while (offset < assets.length) {
    const batch = await thawGen2AssetBatch({ assets, offset, limit: GEN2_THAW_BATCH_SIZE, ids: resolved })
    thawed += batch.thawed
    skipped += batch.skipped
    failed += batch.failed
    if (batch.attempted === 0) break
    offset += batch.attempted
  }
  return { total: assets.length, thawed, skipped, failed }
}

export async function unlockGen2FreezeEscrow(ids?: Partial<Gen2FreezeIds>): Promise<{ signature: string }> {
  const frozen = await fetchGen2FrozenCount(ids)
  if (frozen > 0) {
    throw new Error(
      `UnlockNotEnabled: ${frozen} NFT(s) still frozen on-chain. Re-run thaw until frozenCount is 0, then unlock.`
    )
  }

  const { candyMachineId, rpcUrl } = resolveGen2FreezeIds(ids)
  const umi = loadGen2GuardAuthorityUmi(rpcUrl)
  const DEST = resolveGen2FreezeDistributionWallet()
  const { guard } = await loadGen2CandyGuard(umi, candyMachineId)
  const res = await route(umi, {
    candyMachine: publicKey(candyMachineId),
    candyGuard: guard.publicKey,
    guard: 'freezeSolPayment',
    group: GEN2_FREEZE_GROUP,
    routeArgs: {
      path: 'unlockFunds',
      destination: publicKey(DEST),
      candyGuardAuthority: umi.identity,
    },
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
  return { signature: bs58.encode(res.signature) }
}

export function mergeFreezeProgress(
  prev: OwlCenterFreezeProgress | null | undefined,
  patch: OwlCenterFreezeProgress
): OwlCenterFreezeProgress {
  return { ...(prev ?? {}), ...patch }
}
