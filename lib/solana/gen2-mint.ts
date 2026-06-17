import type { WalletAdapter } from '@solana/wallet-adapter-base'
import bs58 from 'bs58'
import { publicKey, generateSigner, transactionBuilder } from '@metaplex-foundation/umi'
import { fetchMetadata, findMetadataPda, findMasterEditionPda } from '@metaplex-foundation/mpl-token-metadata'
import { mintV2 } from '@metaplex-foundation/mpl-candy-machine'
import { setComputeUnitLimit, setComputeUnitPrice } from '@metaplex-foundation/mpl-toolbox'

import type { OwlCenterPhase } from '@/lib/owl-center/types'
import {
  appendGen2AllowListRouteInstruction,
  buildGen2GuardMintPlan,
  isGen2MintablePhase,
  resolveGen2AllowListRoutePlan,
  type Gen2AllowListRoutePlan,
  type Gen2GuardMintPlan,
  type Gen2MintablePhase,
} from '@/lib/solana/gen2-guards'
import { getLaunchCandyMachineId, getLaunchCollectionMint, getLaunchSolanaRpcUrl, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { getGen2CandyMachineId, getGen2CollectionMint, getSolanaCluster, isDevnetMintEnabled, type OwlMintNetwork } from '@/lib/solana/network'
import { appendOwlCenterPlatformMintFeeSol, assertOwlCenterPlatformMintFeeSolBalance, resolveOwlCenterPlatformMintFeeLamports } from '@/lib/solana/owl-center-platform-mint-fee'
import { OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS } from '@/lib/owl-center/platform-mint-fee'
import { friendlySolanaRpcErrorMessage, MINT_PREP_SOLANA_RPC_RETRY, MINT_SOLANA_RPC_RETRY, MINT_SOLANA_SEND_RETRY, withSolanaRpcRetry } from '@/lib/solana/rpc-retry'
import { createOwlCenterUmi } from '@/lib/solana/umi'
import { invalidLaunchMintIdReason, validateSolanaPubkeyInput } from '@/lib/solana/validate-pubkey'
import {
  extractTxSignatureFromUnknownError,
  pollTransactionSignatureStatus,
  recoverCandyMachineMint,
  recoverCandyMachineMintFromPlannedSigners,
} from '@/lib/solana/recover-candy-machine-mint'
import type { MintSessionDeadline } from '@/lib/owl-center/mint-time-budget'
import {
  createMintSessionDeadline,
  MINT_RECOVERY_RESERVE_MS,
  mintSessionRemainingMs,
  MintSessionTimeoutError,
  pauseMintSessionDeadline,
  resumeMintSessionDeadline,
  withMintSessionBudget,
} from '@/lib/owl-center/mint-time-budget'

/** mintV2 with guards comfortably fits in 800k CU (Metaplex-recommended ceiling). */
const MINT_COMPUTE_UNIT_LIMIT = 800_000
/** Solana per-transaction compute budget cap (mainnet). */
const SOLANA_MAX_COMPUTE_UNITS = 1_400_000
/** Estimated CU per mintV2 ix when batching (actual use is often lower). */
const ESTIMATED_COMPUTE_UNITS_PER_MINT = 380_000
/** Extra CU when batching allowList `route` (proof) into the same tx as mint. */
const ESTIMATED_COMPUTE_UNITS_ALLOWLIST_ROUTE = 100_000

const CM_SOLD_OUT_SIMULATION_PATTERNS = [
  'candymachineempty',
  'indexgreaterthanlength',
  'index greater than',
  'unable to increment',
  'not enough unminted',
  'collection is empty',
] as const

function friendlyMintSimulationError(msg: string, collectPlatformMintFee?: boolean): string | null {
  const low = msg.toLowerCase()
  if (CM_SOLD_OUT_SIMULATION_PATTERNS.some((p) => low.includes(p))) {
    return 'Sold out on-chain — no NFTs remain in the Candy Machine. Refresh the page; if the counter still looks wrong, contact support.'
  }
  if (low.includes('notenoughsol') || low.includes('not enough sol') || low.includes('insufficient funds')) {
    return 'Not enough SOL for the platform fee, NFT rent, and network fees.'
  }
  if (
    low.includes('blocked') ||
    low.includes('malicious') ||
    low.includes('security') ||
    low.includes('dapp could be')
  ) {
    return 'Your wallet blocked this mint for security. If you trust Owltopia, ask Phantom to review owltopia.xyz at review@phantom.com — or try Solflare.'
  }
  if (low.includes('accountnotfound') || low.includes('account does not exist')) {
    return 'Mint setup error — a required on-chain account was not found. Refresh and retry; if this persists, contact the collection team.'
  }
  if (low.includes('simulation failed')) {
    return collectPlatformMintFee
      ? 'Mint could not be simulated — Phantom and Solflare on mobile sometimes approve the mint but disconnect before the site finishes. If your NFT appears in your wallet, tap “My NFT minted — check wallet”.'
      : 'Mint could not be simulated — if your NFT is already in your wallet, tap “My NFT minted — check wallet”.'
  }
  return null
}

/**
 * Priority fee (micro-lamports per CU) for mainnet mint txs — at 800k CU the default
 * 100_000 adds 0.00008 SOL per mint. Set to 0 to disable.
 */
function mintPriorityFeeMicroLamports(): number {
  const raw = process.env.NEXT_PUBLIC_GEN2_MINT_PRIORITY_FEE_MICROLAMPORTS?.trim()
  if (!raw) return 400_000
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 250_000
}

const MINT_PREP_CACHE_TTL_MS = 90_000

type CachedMintMetadata = { expires: number; updateAuthorityB58: string }
type CachedMintPlan = { expires: number; plan: Gen2GuardMintPlan }

const mintMetadataCache = new Map<string, CachedMintMetadata>()
const mintPlanCache = new Map<string, CachedMintPlan>()

function mintPlanCacheKey(cmId: string, phase: Gen2MintablePhase): string {
  return `${cmId}:${phase}`
}

async function loadCollectionUpdateAuthority(
  umi: ReturnType<typeof createOwlCenterUmi>,
  collectionMintB58: string,
  collectionMetadata: ReturnType<typeof findMetadataPda>
): Promise<{ ok: true; updateAuthorityB58: string } | { ok: false; error: string }> {
  const cached = mintMetadataCache.get(collectionMintB58)
  if (cached && cached.expires > Date.now()) {
    return { ok: true, updateAuthorityB58: cached.updateAuthorityB58 }
  }
  try {
    const md = await withSolanaRpcRetry(() => fetchMetadata(umi, collectionMetadata), MINT_PREP_SOLANA_RPC_RETRY)
    const updateAuthorityB58 = String(md.updateAuthority)
    mintMetadataCache.set(collectionMintB58, {
      expires: Date.now() + MINT_PREP_CACHE_TTL_MS,
      updateAuthorityB58,
    })
    return { ok: true, updateAuthorityB58 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'metadata_fetch_failed' }
  }
}

async function loadGuardMintPlan(
  umi: ReturnType<typeof createOwlCenterUmi>,
  candyMachine: ReturnType<typeof publicKey>,
  cmId: string,
  phase: Gen2MintablePhase
): Promise<{ ok: true; plan: Gen2GuardMintPlan } | { ok: false; error: string }> {
  const key = mintPlanCacheKey(cmId, phase)
  const cached = mintPlanCache.get(key)
  if (cached && cached.expires > Date.now()) {
    return { ok: true, plan: cached.plan }
  }
  const planRes = await withSolanaRpcRetry(() => buildGen2GuardMintPlan(umi, candyMachine, phase), MINT_PREP_SOLANA_RPC_RETRY)
  if (!planRes.ok) return planRes
  mintPlanCache.set(key, { expires: Date.now() + MINT_PREP_CACHE_TTL_MS, plan: planRes.plan })
  return planRes
}

/** Optional DB-backed overrides (see `owl_center_launches` devnet columns). */
export type Gen2MintLaunchRefs = {
  candy_machine_id?: string | null
  collection_mint?: string | null
  devnet_candy_machine_id?: string | null
  devnet_collection_mint?: string | null
}

export type MintGen2Params = {
  walletAdapter: WalletAdapter
  candyMachineId: string
  collectionMint: string
  quantity: number
  phase: OwlCenterPhase
  /** When provided, resolves CM + collection from env + launch row (devnet vs mainnet). */
  launch?: Gen2MintLaunchRefs | null
  /** Override cluster for public_simple collections (independent of Gen2 devnet flag). */
  mintNetwork?: OwlMintNetwork
  /** When true, transfer Owltopia platform SOL fee to treasury in the same tx as each mint. */
  collectPlatformMintFee?: boolean
  /** Skip live Jupiter quote when eligibility already returned a lamports estimate. */
  platformFeeLamports?: bigint
  /** Skip redundant getBalance when eligibility already fetched wallet SOL. */
  prefetchedWalletBalanceLamports?: bigint
  /** Automated mint steps must finish before this deadline (default 30s). */
  sessionDeadline?: MintSessionDeadline
  /** Called before each on-chain mint (1-indexed current, total quantity). */
  onMintProgress?: (current: number, total: number) => void
}

export type MintGen2Result =
      | {
      ok: true
      /** One signature per transaction (batched mints share a single signature). */
      txSignatures: string[]
      mintedNftMints: string[]
    }
  | {
      ok: false
      error: string
      /** On-chain mints that succeeded before a later tx failed (e.g. blockhash expired). */
      txSignatures?: string[]
      mintedNftMints?: string[]
      /** Client-generated mint pubkeys from the last attempt — used for post-error recovery. */
      plannedMintB58s?: string[]
    }

const BLOCKHASH_EXPIRED_PATTERNS = [
  'block height exceeded',
  'blockhash not found',
  'blockhash expired',
  'transaction expired',
  'signature has expired',
] as const

function isBlockhashExpiredError(error: unknown): boolean {
  const low = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return BLOCKHASH_EXPIRED_PATTERNS.some((p) => low.includes(p))
}

function friendlyBlockhashExpiredError(): string {
  return 'Transaction expired before it landed on-chain — common on mobile if the wallet prompt sits open. Tap Mint again to finish; NFTs that already minted are safe in your wallet.'
}

function computeUnitsForBatch(quantity: number, includeAllowListRoute = false): number {
  const routeExtra = includeAllowListRoute ? ESTIMATED_COMPUTE_UNITS_ALLOWLIST_ROUTE : 0
  const estimated = routeExtra + 100_000 + quantity * ESTIMATED_COMPUTE_UNITS_PER_MINT
  return Math.min(SOLANA_MAX_COMPUTE_UNITS, Math.max(MINT_COMPUTE_UNIT_LIMIT, estimated))
}

const TX_TOO_LARGE_PATTERNS = [
  'too large',
  'transaction is too large',
  'encoding overruns',
  'exceeds max',
] as const

function isTransactionTooLargeError(error: unknown): boolean {
  const low = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return TX_TOO_LARGE_PATTERNS.some((p) => low.includes(p))
}

function friendlyTransactionTooLargeError(quantity: number): string {
  return quantity > 1
    ? `Could not fit ${quantity} mints in one transaction — try a smaller quantity (e.g. ${Math.max(1, Math.floor(quantity / 2))}).`
    : 'Mint transaction too large — contact support.'
}

type ResolvedMintIds = {
  cmId: string
  colMint: string
  network: OwlMintNetwork
}

function resolveMintIds(params: Pick<MintGen2Params, 'candyMachineId' | 'collectionMint' | 'launch' | 'mintNetwork'>): ResolvedMintIds | { error: string } {
  const { candyMachineId, collectionMint, launch, mintNetwork } = params
  const network =
    mintNetwork ??
    (launch && 'mint_mode' in launch
      ? resolveLaunchMintNetwork(launch as Parameters<typeof resolveLaunchMintNetwork>[0])
      : isDevnetMintEnabled()
        ? 'devnet'
        : 'mainnet')

  if (network === 'devnet' && getSolanaCluster().toLowerCase() !== 'devnet' && !mintNetwork) {
    return {
      error:
        'Wrong network / devnet required — use NEXT_PUBLIC_SOLANA_CLUSTER=devnet with NEXT_PUBLIC_GEN2_USE_DEVNET_MINT=true.',
    }
  }

  let cmId =
    candyMachineId.trim() ||
    (launch && 'mint_mode' in launch
      ? getLaunchCandyMachineId(launch as Parameters<typeof getLaunchCandyMachineId>[0], network)
      : getGen2CandyMachineId(launch ?? undefined))
  let colMint =
    collectionMint.trim() ||
    (launch && 'mint_mode' in launch
      ? getLaunchCollectionMint(launch as Parameters<typeof getLaunchCollectionMint>[0], network)
      : getGen2CollectionMint(launch ?? undefined))

  const invalidIds = invalidLaunchMintIdReason(
    candyMachineId.trim() ||
      (network === 'devnet' ? launch?.devnet_candy_machine_id : launch?.candy_machine_id) ||
      null,
    collectionMint.trim() ||
      (network === 'devnet' ? launch?.devnet_collection_mint : launch?.collection_mint) ||
      null
  )
  if (invalidIds) return { error: invalidIds }
  if (!cmId) return { error: 'Missing Candy Machine ID — set env or Owl Center admin devnet fields.' }
  if (!colMint) return { error: 'Missing Collection Mint — set env or Owl Center admin devnet fields.' }

  const cmCheck = validateSolanaPubkeyInput(cmId, 'Candy Machine ID')
  if (!cmCheck.ok) return { error: cmCheck.error }
  const colCheck = validateSolanaPubkeyInput(colMint, 'Collection mint')
  if (!colCheck.ok) return { error: colCheck.error }

  return { cmId: cmCheck.pubkey, colMint: colCheck.pubkey, network }
}

/** Prefetch CM guard plan + collection metadata while the user is on the mint page. */
export async function warmGen2MintPrep(
  params: Pick<
    MintGen2Params,
    'walletAdapter' | 'candyMachineId' | 'collectionMint' | 'phase' | 'launch' | 'mintNetwork'
  >
): Promise<void> {
  if (!params.walletAdapter.publicKey || !isGen2MintablePhase(params.phase)) return
  const resolved = resolveMintIds(params)
  if ('error' in resolved) return

  const { cmId, colMint, network } = resolved
  try {
    const umi = createOwlCenterUmi(params.walletAdapter, getLaunchSolanaRpcUrl(network))
    const collectionMetadata = findMetadataPda(umi, { mint: publicKey(colMint) })
    await Promise.all([
      loadCollectionUpdateAuthority(umi, colMint, collectionMetadata),
      loadGuardMintPlan(umi, publicKey(cmId), cmId, params.phase),
    ])
  } catch {
    // warm is best-effort
  }
}

/**
 * Prepare + sign + confirm Candy Machine `mintV2` txs via Phantom / Solflare (wallet-standard adapter).
 *
 * Guard-aware: fetches the candy guard, selects the guard group for the active phase
 * (`gen1` / `pre` / `wl` / `pub` — see `lib/solana/gen2-guards.ts`), builds `mintArgs`
 * (solPayment destination, mintLimit id, allowList merkle root) and batches the allowList
 * `route` proof instruction into the same transaction as `mintV2` when needed.
 *
 * Required packages: see `lib/solana/umi.ts` / `candy-machine-v3.ts` header comments.
 *
 * TODO: Collection authority / delegate flows if CM uses a separate update authority.
 */
export async function mintGen2FromCandyMachine(params: MintGen2Params): Promise<MintGen2Result> {
  const {
    walletAdapter,
    candyMachineId,
    collectionMint,
    quantity,
    phase,
    launch,
    mintNetwork,
    collectPlatformMintFee,
    platformFeeLamports: platformFeeLamportsOverride,
    prefetchedWalletBalanceLamports,
    sessionDeadline: sessionDeadlineParam,
    onMintProgress,
  } = params
  if (!walletAdapter.publicKey) {
    return { ok: false, error: 'Wallet not connected' }
  }
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 25) {
    return { ok: false, error: 'Invalid quantity (max 25 per transaction)' }
  }

  const resolved = resolveMintIds({ candyMachineId, collectionMint, launch, mintNetwork })
  if ('error' in resolved) {
    return { ok: false, error: resolved.error }
  }
  const { cmId, colMint, network } = resolved

  if (!isGen2MintablePhase(phase)) {
    return { ok: false, error: `Mint not available in phase ${phase}` }
  }

  try {
    const sessionDeadline = sessionDeadlineParam ?? createMintSessionDeadline()
    const umi = createOwlCenterUmi(walletAdapter, getLaunchSolanaRpcUrl(network))
    const candyMachine = publicKey(cmId)
    const collectionMintPk = publicKey(colMint)
    const collectionMetadata = findMetadataPda(umi, { mint: collectionMintPk })
    const collectionMasterEdition = findMasterEditionPda(umi, { mint: collectionMintPk })

    const [metadataRes, planRes, feeQuote] = await withMintSessionBudget(
      sessionDeadline,
      () =>
        Promise.all([
          loadCollectionUpdateAuthority(umi, colMint, collectionMetadata),
          loadGuardMintPlan(umi, candyMachine, cmId, phase),
          collectPlatformMintFee
            ? platformFeeLamportsOverride != null && platformFeeLamportsOverride > 0n
              ? Promise.resolve({
                  ok: true as const,
                  lamports: platformFeeLamportsOverride,
                  solUsdPrice: 0,
                })
              : resolveOwlCenterPlatformMintFeeLamports()
            : Promise.resolve({ ok: true as const, lamports: 0n, solUsdPrice: 0 }),
        ]),
      'Mint setup timed out — refresh and tap Mint again.'
    )

    if (!metadataRes.ok) {
      return { ok: false, error: metadataRes.error }
    }
    if (!planRes.ok) {
      return { ok: false, error: planRes.error }
    }
    const plan = planRes.plan
    const collectionUpdateAuthority = publicKey(metadataRes.updateAuthorityB58)

    const cmRemaining = Number(plan.candyMachine.itemsLoaded) - Number(plan.candyMachine.itemsRedeemed)
    if (cmRemaining <= 0) {
      return {
        ok: false,
        error:
          'Sold out on-chain — no NFTs remain in the Candy Machine. Refresh the page; if the counter still looks wrong, contact support.',
      }
    }

    const priorityFee = mintPriorityFeeMicroLamports()

    let platformFeeLamports = 0n
    if (collectPlatformMintFee) {
      if (!feeQuote.ok) {
        return { ok: false, error: feeQuote.error }
      }
      platformFeeLamports = feeQuote.lamports
    }

    let allowListRoutePlan: Gen2AllowListRoutePlan = { includeRoute: false }
    const walletB58 = walletAdapter.publicKey.toBase58()
    const prepTasks: Promise<unknown>[] = []

    if (plan.allowListMerkleRoot && plan.candyGuard) {
      prepTasks.push(
        resolveGen2AllowListRoutePlan(umi, {
          candyMachine,
          candyGuard: plan.candyGuard.publicKey,
          groupLabel: plan.groupLabel,
          merkleRoot: plan.allowListMerkleRoot,
          phase,
        }).then((routeRes) => {
          if (!routeRes.ok) throw new Error(routeRes.error)
          allowListRoutePlan = routeRes.plan
        })
      )
    }

    if (collectPlatformMintFee && platformFeeLamports > 0n) {
      const totalFee = platformFeeLamports * BigInt(quantity)
      const needed = totalFee + OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS * BigInt(quantity)
      if (prefetchedWalletBalanceLamports != null) {
        if (prefetchedWalletBalanceLamports < needed) {
          const feeSol = Number(totalFee) / 1_000_000_000
          const haveSol = Number(prefetchedWalletBalanceLamports) / 1_000_000_000
          return {
            ok: false,
            error: `Not enough SOL — need ~${(feeSol + 0.02 * quantity).toFixed(3)} SOL for ${quantity} mint${quantity === 1 ? '' : 's'} (you have ~${haveSol.toFixed(3)} SOL).`,
          }
        }
      } else {
        prepTasks.push(
          withSolanaRpcRetry(
            () =>
              assertOwlCenterPlatformMintFeeSolBalance(
                walletB58,
                network,
                platformFeeLamports,
                getLaunchSolanaRpcUrl(network),
                quantity,
                prefetchedWalletBalanceLamports
              ),
            MINT_SOLANA_RPC_RETRY
          ).then((feeBal) => {
            if (!feeBal.ok) throw new Error(feeBal.error)
          })
        )
      }
    }

    if (prepTasks.length > 0) {
      try {
        await withMintSessionBudget(
          sessionDeadline,
          () => Promise.all(prepTasks),
          'Mint setup timed out — refresh and tap Mint again.'
        )
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }

    const nftMints = Array.from({ length: quantity }, () => generateSigner(umi))
    onMintProgress?.(quantity, quantity)
    pauseMintSessionDeadline(sessionDeadline)

    const buildBatchMintBuilder = () => {
      const computeUnits = computeUnitsForBatch(quantity, allowListRoutePlan.includeRoute)
      let builder = transactionBuilder().add(setComputeUnitLimit(umi, { units: computeUnits }))
      if (priorityFee > 0) {
        builder = builder.add(setComputeUnitPrice(umi, { microLamports: priorityFee }))
      }
      if (allowListRoutePlan.includeRoute && plan.candyGuard) {
        builder = appendGen2AllowListRouteInstruction(umi, builder, {
          candyMachine,
          candyGuard: plan.candyGuard.publicKey,
          groupLabel: plan.groupLabel,
          merkleRoot: allowListRoutePlan.merkleRoot,
          merkleProof: allowListRoutePlan.merkleProof,
        })
      }
      if (collectPlatformMintFee && platformFeeLamports > 0n) {
        const totalFee = platformFeeLamports * BigInt(quantity)
        const feeRes = appendOwlCenterPlatformMintFeeSol(umi, totalFee, builder)
        if (!feeRes.ok) {
          return feeRes
        }
        builder = feeRes.builder
      }
      for (const nftMint of nftMints) {
        builder = builder.add(
          mintV2(umi, {
            candyMachine,
            candyGuard: plan.candyGuard?.publicKey,
            nftMint,
            collectionMint: collectionMintPk,
            collectionUpdateAuthority,
            collectionMetadata,
            collectionMasterEdition,
            mintArgs: plan.mintArgs,
            ...(plan.groupLabel ? { group: plan.groupLabel } : {}),
          })
        )
      }
      return { ok: true as const, builder }
    }

    const rpcUrl = getLaunchSolanaRpcUrl(network)

    const built = buildBatchMintBuilder()
    if (!built.ok) {
      resumeMintSessionDeadline(sessionDeadline)
      return { ok: false, error: built.error }
    }

    let lastMintError: unknown
    let submittedSig: string | null = null
    try {
      const res = await withSolanaRpcRetry(
        () => built.builder.sendAndConfirm(umi, { confirm: { commitment: 'processed' } }),
        MINT_SOLANA_SEND_RETRY
      )
      resumeMintSessionDeadline(sessionDeadline)
      const sig = res.signature as string | Uint8Array
      const sigStr = typeof sig === 'string' ? sig : bs58.encode(sig)
      return {
        ok: true,
        txSignatures: [sigStr],
        mintedNftMints: nftMints.map((m) => String(m.publicKey)),
      }
    } catch (e) {
      resumeMintSessionDeadline(sessionDeadline)
      lastMintError = e
      submittedSig = extractTxSignatureFromUnknownError(e)
    }

    const pollMs = Math.min(5000, mintSessionRemainingMs(sessionDeadline))
    if (submittedSig && pollMs > 0) {
      await pollTransactionSignatureStatus(rpcUrl, submittedSig, {
        maxWaitMs: pollMs,
        intervalMs: 300,
        minCommitment: 'processed',
      })
    }

    if (mintSessionRemainingMs(sessionDeadline) > 400) {
      const recoveredEarly = await recoverCandyMachineMintFromPlannedSigners({
        rpcUrl,
        walletB58,
        candyMachineB58: cmId,
        nftMints,
        lastError: lastMintError,
      })
      if (recoveredEarly?.mintedNftMints.length) {
        return {
          ok: true,
          txSignatures: recoveredEarly.txSignatures.length ? recoveredEarly.txSignatures : submittedSig ? [submittedSig] : [],
          mintedNftMints: recoveredEarly.mintedNftMints,
        }
      }
    }

    const msg = lastMintError instanceof Error ? lastMintError.message : String(lastMintError ?? 'mint_failed')
    if (lastMintError instanceof MintSessionTimeoutError && mintSessionRemainingMs(sessionDeadline) <= 0) {
      return {
        ok: false,
        error: msg,
        plannedMintB58s: nftMints.map((m) => String(m.publicKey)),
        txSignatures: submittedSig ? [submittedSig] : undefined,
      }
    }

    const recovered =
      mintSessionRemainingMs(sessionDeadline) > 400
        ? await recoverCandyMachineMint({
            rpcUrl,
            walletB58: walletAdapter.publicKey.toBase58(),
            candyMachineB58: cmId,
            nftMints,
            lastError: lastMintError,
          })
        : null

    if (recovered && (recovered.mintedNftMints.length > 0 || recovered.txSignatures.length > 0)) {
      return {
        ok: false,
        error:
          'Your wallet reported an error, but your mint appears on-chain — saving it now. Open your wallet Collectibles if the reveal is slow.',
        txSignatures: recovered.txSignatures,
        mintedNftMints: recovered.mintedNftMints,
        plannedMintB58s: nftMints.map((m) => String(m.publicKey)),
      }
    }

    const error = isBlockhashExpiredError(lastMintError)
      ? friendlyBlockhashExpiredError()
      : isTransactionTooLargeError(lastMintError)
        ? friendlyTransactionTooLargeError(quantity)
        : friendlyMintSimulationError(msg, collectPlatformMintFee) ??
          friendlySolanaRpcErrorMessage(lastMintError) ??
          msg
    return {
      ok: false,
      error,
      plannedMintB58s: nftMints.map((m) => String(m.publicKey)),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof MintSessionTimeoutError) {
      return { ok: false, error: msg }
    }
    const low = msg.toLowerCase()
    if (low.includes('could not find candy machine') || low.includes('account does not exist')) {
      return { ok: false, error: 'Candy Machine fetch failed — check RPC cluster and Candy Machine ID.' }
    }
    if (low.includes('user rejected') || low.includes('cancel')) {
      return { ok: false, error: 'Mint transaction rejected in wallet' }
    }
    if (isBlockhashExpiredError(e)) {
      return { ok: false, error: friendlyBlockhashExpiredError() }
    }
    const simulationHint = friendlyMintSimulationError(msg, collectPlatformMintFee)
    if (simulationHint) {
      return { ok: false, error: simulationHint }
    }
    if (low.includes('missingallowedlistproof') || low.includes('addressnotfoundinallowedlist')) {
      return { ok: false, error: 'Wallet not validated on the on-chain allowlist for this phase.' }
    }
    if (low.includes('provided public key is invalid') || low.includes('public keys must be base58')) {
      return {
        ok: false,
        error:
          'Candy Machine IDs are invalid — admin must paste base58 addresses from Sugar cache.json (program.candyMachine / program.collectionMint), not the launch UUID from the admin URL.',
      }
    }
    const rpcHint = friendlySolanaRpcErrorMessage(e)
    if (rpcHint) {
      return { ok: false, error: rpcHint }
    }
    return { ok: false, error: msg }
  }
}
