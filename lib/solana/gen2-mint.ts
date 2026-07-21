import type { WalletAdapter } from '@solana/wallet-adapter-base'
import { Connection } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  generateSigner,
  publicKey,
  signAllTransactions,
  transactionBuilder,
  type Transaction,
  type TransactionBuilder,
} from '@metaplex-foundation/umi'
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters'
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
  detectPlannedMintAccounts,
  extractTxSignatureFromUnknownError,
  findRecentCandyMachineMintSignature,
  pollTransactionSignatureStatus,
} from '@/lib/solana/recover-candy-machine-mint'
import {
  sendTransactionPreferPhantomSignAndSend,
  walletAdapterIsPhantom,
} from '@/lib/solana/phantom-sign-and-send-transaction'
import { assertTransactionSimulatesClean } from '@/lib/solana/phantom-presimulate'
import type { MintSessionDeadline } from '@/lib/owl-center/mint-time-budget'
import {
  createMintSessionDeadline,
  MINT_RECOVERY_RESERVE_MS,
  MINT_SEND_MIN_MS,
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
  if (low.includes('afterenddate') || low.includes('after the set end date')) {
    return 'This free redemption window closed on-chain — you were only charged fees, not the mint price. The team is reopening it; refresh shortly or contact support.'
  }
  if (
    low.includes('blocked') ||
    low.includes('malicious') ||
    low.includes('security') ||
    low.includes('dapp could be')
  ) {
    return (
      'Your wallet blocked this mint after simulation. Owltopia signs with Phantom first, then the mint key, then broadcasts — ' +
      'if this keeps happening, try Solflare or ask Phantom to review the failing mint (see PHANTOM_DOMAIN_REVIEW.md).'
    )
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

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Free-phase (gen1/presale) mints carry a `thirdPartySigner` guard, so the wallet-signed txs must
 * be co-signed by the server before they can land. Send them to `/api/owl-center/gen2/cosign-mint`,
 * which verifies the wallet's remaining credits (the per-wallet limit the chain can't express) and
 * returns the txs with its signature added.
 */
async function cosignGatedMintTransactions(
  umi: ReturnType<typeof createOwlCenterUmi>,
  signedTransactions: Transaction[],
  args: { wallet: string; network: OwlMintNetwork; phase: OwlCenterPhase }
): Promise<{ ok: true; transactions: Transaction[] } | { ok: false; error: string }> {
  try {
    const payload = signedTransactions.map((tx) => uint8ToBase64(umi.transactions.serialize(tx)))
    const res = await fetch('/api/owl-center/gen2/cosign-mint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: args.wallet, network: args.network, phase: args.phase, transactions: payload }),
    })
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; transactions?: string[]; error?: string }
      | null
    if (!res.ok || !body?.ok || !Array.isArray(body.transactions)) {
      return { ok: false, error: body?.error || 'Mint authorization failed — refresh and try again.' }
    }
    // The server co-signs only the wallet's remaining on-chain entitlement, so it may return FEWER
    // txs than sent (when the off-chain ledger briefly lags the chain). Accept any non-empty subset
    // up to what we sent — the caller mints exactly the co-signed ones and reports that as success.
    if (body.transactions.length < 1 || body.transactions.length > signedTransactions.length) {
      return { ok: false, error: 'Mint authorization returned an unexpected response — try again.' }
    }
    const cosigned = body.transactions.map((b64) => umi.transactions.deserialize(base64ToUint8(b64)))
    return { ok: true, transactions: cosigned }
  } catch {
    return { ok: false, error: 'Mint authorization failed — check your connection and retry.' }
  }
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

    // The wallet must cover the on-chain mint PRICE (candy-guard solPayment/freeze, e.g. WL/public)
    // in ADDITION to the platform fee + rent. Checking only the fee let under-funded WL/public
    // wallets sign a mint that bot-taxes — charging the platform fee + bot tax while never taking the
    // mint price or minting an NFT. Include the price so we fail fast with a clear message instead.
    const mintPriceLamports = plan.mintPriceLamports > 0n ? plan.mintPriceLamports : 0n
    if ((collectPlatformMintFee && platformFeeLamports > 0n) || mintPriceLamports > 0n) {
      const totalFee = collectPlatformMintFee ? platformFeeLamports * BigInt(quantity) : 0n
      const totalPrice = mintPriceLamports * BigInt(quantity)
      const needed =
        totalFee + totalPrice + OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS * BigInt(quantity)
      if (prefetchedWalletBalanceLamports != null) {
        if (prefetchedWalletBalanceLamports < needed) {
          const priceSol = Number(totalPrice) / 1_000_000_000
          const feeSol = Number(totalFee) / 1_000_000_000
          const haveSol = Number(prefetchedWalletBalanceLamports) / 1_000_000_000
          const needSol = priceSol + feeSol + 0.02 * quantity
          const priceCopy = priceSol > 0 ? `the ${priceSol.toFixed(3)} SOL mint price plus ` : ''
          return {
            ok: false,
            error: `Not enough SOL — need ~${needSol.toFixed(3)} SOL for ${priceCopy}fees on ${quantity} mint${quantity === 1 ? '' : 's'} (you have ~${haveSol.toFixed(3)} SOL).`,
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
                prefetchedWalletBalanceLamports,
                mintPriceLamports
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
    const plannedB58s = nftMints.map((m) => String(m.publicKey))
    const rpcUrl = getLaunchSolanaRpcUrl(network)

    // One transaction per NFT. A single legacy tx cannot fit more than one mintV2 — each
    // references ~25 accounts and nearly fills the 1232-byte limit, so batching several mints
    // into one tx silently overflows and fails (works at qty 1, fails at qty >= 2). We build N
    // single-mint txs and sign them all in ONE wallet prompt (UMI groups signing by signer, so
    // the wallet's signAllTransactions is invoked once).
    const includeAllowListRoute = allowListRoutePlan.includeRoute && Boolean(plan.candyGuard)

    // A single `mintV2` already nearly fills the 1232-byte legacy tx limit. The allowList `route`
    // (proof) instruction carries the wallet's merkle proof, whose node count VARIES per wallet (the
    // snapshot is not a power of two), so batching it into the mint tx pushes longer-proof wallets
    // over the size limit ("transaction too large"). Send the proof as its OWN tx that lands first
    // (creating the proof PDA); every `mintV2` tx then stays small and fits for all wallets/proofs.
    const buildRouteBuilder = (): { ok: true; builder: TransactionBuilder } | { ok: false; error: string } => {
      if (!allowListRoutePlan.includeRoute || !plan.candyGuard) {
        return { ok: false, error: 'Allowlist proof unavailable — refresh and try again.' }
      }
      let builder = transactionBuilder().add(setComputeUnitLimit(umi, { units: 200_000 }))
      if (priorityFee > 0) {
        builder = builder.add(setComputeUnitPrice(umi, { microLamports: priorityFee }))
      }
      builder = appendGen2AllowListRouteInstruction(umi, builder, {
        candyMachine,
        candyGuard: plan.candyGuard.publicKey,
        groupLabel: plan.groupLabel,
        merkleRoot: allowListRoutePlan.merkleRoot,
        merkleProof: allowListRoutePlan.merkleProof,
      })
      return { ok: true, builder }
    }

    const buildSingleMintBuilder = (
      nftMint: (typeof nftMints)[number]
    ): { ok: true; builder: TransactionBuilder } | { ok: false; error: string } => {
      let builder = transactionBuilder().add(
        setComputeUnitLimit(umi, { units: computeUnitsForBatch(1, false) })
      )
      if (priorityFee > 0) {
        builder = builder.add(setComputeUnitPrice(umi, { microLamports: priorityFee }))
      }
      if (collectPlatformMintFee && platformFeeLamports > 0n) {
        const feeRes = appendOwlCenterPlatformMintFeeSol(umi, platformFeeLamports, builder)
        if (!feeRes.ok) return feeRes
        builder = feeRes.builder
      }
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
      return { ok: true, builder }
    }

    let routeBuilder: TransactionBuilder | null = null
    if (includeAllowListRoute) {
      const routeRes = buildRouteBuilder()
      if (!routeRes.ok) return { ok: false, error: routeRes.error }
      routeBuilder = routeRes.builder
    }

    const builders: TransactionBuilder[] = []
    for (let i = 0; i < quantity; i++) {
      const res = buildSingleMintBuilder(nftMints[i]!)
      if (!res.ok) return { ok: false, error: res.error }
      builders.push(res.builder)
    }

    onMintProgress?.(quantity, quantity)
    pauseMintSessionDeadline(sessionDeadline)

    /**
     * Paid public (no server co-sign) + Phantom multi-signer mint txs:
     * Phantom docs require wallet `signTransaction` / `signAllTransactions` first, then other
     * signers (mint keypair), then broadcast — not `signAndSend` on a pre-partial-signed tx.
     * Allowlist route stays single-signer → `signAndSend` (Blowfish/Lighthouse OK).
     *
     * @see https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings
     */
    const usePhantomMultiSignerMint =
      !plan.thirdPartySignerKey && walletAdapterIsPhantom(walletAdapter)

    if (usePhantomMultiSignerMint) {
      try {
        const connection = new Connection(rpcUrl, { commitment: 'confirmed' })
        const blockhash = await withSolanaRpcRetry(
          () => umi.rpc.getLatestBlockhash({ commitment: 'confirmed' }),
          MINT_SOLANA_SEND_RETRY
        )
        const feePayer = walletAdapter.publicKey
        if (!feePayer) {
          resumeMintSessionDeadline(sessionDeadline)
          return { ok: false, error: 'Wallet not connected' }
        }

        const fallbackSend = (
          transaction: Parameters<NonNullable<typeof walletAdapter.sendTransaction>>[0],
          conn: Connection,
          options?: Parameters<NonNullable<typeof walletAdapter.sendTransaction>>[2]
        ) => {
          if (typeof walletAdapter.sendTransaction !== 'function') {
            throw new Error('Wallet cannot send transactions')
          }
          return walletAdapter.sendTransaction(transaction, conn, options)
        }

        // Allowlist proof must land before mintV2 (own tx — keeps mint txs under size limit).
        if (includeAllowListRoute) {
          const routeRes = buildRouteBuilder()
          if (!routeRes.ok) {
            resumeMintSessionDeadline(sessionDeadline)
            return { ok: false, error: routeRes.error }
          }
          const routeBuilt = routeRes.builder.setBlockhash(blockhash).build(umi)
          const routeWeb3 = toWeb3JsTransaction(routeBuilt)
          const routeSig = await sendTransactionPreferPhantomSignAndSend({
            transaction: routeWeb3,
            connection,
            adapter: walletAdapter,
            publicKey: feePayer,
            fallbackSendTransaction: fallbackSend,
            options: { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 },
          })
          const routeConfirmMs = Math.max(
            MINT_SEND_MIN_MS,
            mintSessionRemainingMs(sessionDeadline) - MINT_RECOVERY_RESERVE_MS
          )
          const routeOk = await pollTransactionSignatureStatus(rpcUrl, routeSig, {
            maxWaitMs: routeConfirmMs,
            intervalMs: 400,
            minCommitment: 'confirmed',
          })
          if (!routeOk) {
            resumeMintSessionDeadline(sessionDeadline)
            return {
              ok: false,
              error:
                'Allowlist setup didn’t confirm — tap Mint again to finish (your spots are still reserved).',
              plannedMintB58s: plannedB58s,
            }
          }
        }

        const builtMints: Transaction[] = []
        for (let i = 0; i < quantity; i++) {
          const nftMint = nftMints[i]!
          const res = buildSingleMintBuilder(nftMint)
          if (!res.ok) {
            resumeMintSessionDeadline(sessionDeadline)
            return { ok: false, error: res.error, plannedMintB58s: plannedB58s }
          }
          builtMints.push(res.builder.setBlockhash(blockhash).build(umi))
        }

        // Pre-sim before the wallet sheet so doomed mints do not look "malicious".
        for (const built of builtMints) {
          await assertTransactionSimulatesClean(connection, toWeb3JsTransaction(built), {
            failMessagePrefix: 'Mint would fail on-chain before wallet approval.',
          })
        }

        // 1) Phantom signs fee payer only (one prompt for the batch).
        const walletSigned = await signAllTransactions(
          builtMints.map((transaction) => ({
            transaction,
            signers: [umi.identity],
          }))
        )

        // 2) Mint keypairs sign after Phantom (required account signer for each mint).
        const fullySigned: Transaction[] = []
        for (let i = 0; i < quantity; i++) {
          fullySigned.push(await nftMints[i]!.signTransaction(walletSigned[i]!))
        }

        resumeMintSessionDeadline(sessionDeadline)

        // 3) Broadcast fully signed txs (no second wallet prompt).
        let firstSendError: unknown = null
        const sendOneMint = async (
          tx: Transaction
        ): Promise<{ sig: string | null; confirmed: boolean }> => {
          let sig: string | null = null
          try {
            const sigBytes = await withSolanaRpcRetry(
              () => umi.rpc.sendTransaction(tx, { skipPreflight: false }),
              MINT_SOLANA_SEND_RETRY
            )
            sig = typeof sigBytes === 'string' ? sigBytes : bs58.encode(sigBytes)
            const confirmMs = Math.max(
              MINT_SEND_MIN_MS,
              mintSessionRemainingMs(sessionDeadline) - MINT_RECOVERY_RESERVE_MS
            )
            const confirmed = await pollTransactionSignatureStatus(rpcUrl, sig, {
              maxWaitMs: confirmMs,
              intervalMs: 400,
              minCommitment: 'confirmed',
            })
            return { sig, confirmed }
          } catch (e) {
            firstSendError = firstSendError ?? e
            return { sig: sig ?? extractTxSignatureFromUnknownError(e), confirmed: false }
          }
        }

        const sendResults: Array<{ sig: string | null; confirmed: boolean }> = []
        const all = await Promise.all(fullySigned.map((tx) => sendOneMint(tx)))
        all.forEach((r) => sendResults.push(r))

        const confirmedSigs: string[] = []
        const confirmedMints: string[] = []
        for (let i = 0; i < quantity; i++) {
          const r = sendResults[i]
          if (r?.confirmed && r.sig) {
            confirmedSigs.push(r.sig)
            confirmedMints.push(plannedB58s[i]!)
          }
        }

        const pendingIdx = Array.from({ length: quantity }, (_, i) => i).filter(
          (i) => !(sendResults[i]?.confirmed && sendResults[i]?.sig)
        )
        if (pendingIdx.length > 0 && mintSessionRemainingMs(sessionDeadline) > 400) {
          const pendingB58s = pendingIdx.map((i) => plannedB58s[i]!)
          const onChain = new Set(
            await detectPlannedMintAccounts(rpcUrl, pendingB58s, { attempts: 3, delayMs: 600 })
          )
          for (const i of pendingIdx) {
            const b58 = plannedB58s[i]!
            if (!onChain.has(b58)) continue
            const sig =
              sendResults[i]?.sig ??
              (await findRecentCandyMachineMintSignature(rpcUrl, walletB58, cmId, [b58]))
            if (sig) {
              confirmedSigs.push(sig)
              confirmedMints.push(b58)
            }
          }
        }

        if (confirmedMints.length >= quantity) {
          return { ok: true, txSignatures: confirmedSigs, mintedNftMints: confirmedMints }
        }
        if (confirmedMints.length > 0) {
          return {
            ok: false,
            error:
              'Your wallet reported an error, but your mint appears on-chain — saving it now. Open your wallet Collectibles if the reveal is slow.',
            txSignatures: confirmedSigs,
            mintedNftMints: confirmedMints,
            plannedMintB58s: plannedB58s.filter((b) => !confirmedMints.includes(b)),
          }
        }
        const msg =
          firstSendError instanceof Error
            ? firstSendError.message
            : String(firstSendError ?? 'Mint transaction failed to confirm — check your wallet Collectibles, then retry.')
        const simulationHint = friendlyMintSimulationError(msg, collectPlatformMintFee)
        return {
          ok: false,
          error:
            simulationHint ??
            friendlySolanaRpcErrorMessage(firstSendError) ??
            msg,
          plannedMintB58s: plannedB58s,
        }
      } catch (e) {
        resumeMintSessionDeadline(sessionDeadline)
        const msg = e instanceof Error ? e.message : String(e)
        const low = msg.toLowerCase()
        if (low.includes('user rejected') || low.includes('cancel')) {
          return { ok: false, error: 'Mint transaction rejected in wallet' }
        }
        if (isTransactionTooLargeError(e)) {
          return {
            ok: false,
            error: friendlyTransactionTooLargeError(quantity),
            plannedMintB58s: plannedB58s,
          }
        }
        const simulationHint = friendlyMintSimulationError(msg, collectPlatformMintFee)
        if (simulationHint) {
          return { ok: false, error: simulationHint, plannedMintB58s: plannedB58s }
        }
        return {
          ok: false,
          error: friendlySolanaRpcErrorMessage(e) ?? msg,
          plannedMintB58s: plannedB58s,
        }
      }
    }

    // The optional allowList proof tx (if any) is signed in the SAME wallet prompt as the mints —
    // UMI's signAllTransactions invokes the wallet once — then split out so it can be sent first and
    // kept OUT of the co-sign round-trip (the cosign endpoint requires exactly one mintV2 per tx).
    let routeSignedTx: Transaction | null = null
    let signedTransactions: Transaction[]
    try {
      const blockhash = await withSolanaRpcRetry(
        () => umi.rpc.getLatestBlockhash({ commitment: 'confirmed' }),
        MINT_SOLANA_SEND_RETRY
      )
      const orderedBuilders = routeBuilder ? [routeBuilder, ...builders] : builders
      const toSign = orderedBuilders.map((b) => {
        const withBlockhash = b.setBlockhash(blockhash)
        return { transaction: withBlockhash.build(umi), signers: withBlockhash.getSigners(umi) }
      })
      const signed = await signAllTransactions(toSign)
      resumeMintSessionDeadline(sessionDeadline)
      if (routeBuilder) {
        routeSignedTx = signed[0]!
        signedTransactions = signed.slice(1)
      } else {
        signedTransactions = signed
      }
    } catch (e) {
      resumeMintSessionDeadline(sessionDeadline)
      const msg = e instanceof Error ? e.message : String(e)
      const low = msg.toLowerCase()
      if (low.includes('user rejected') || low.includes('cancel')) {
        return { ok: false, error: 'Mint transaction rejected in wallet' }
      }
      return { ok: false, error: friendlySolanaRpcErrorMessage(e) ?? msg }
    }

    // Free phases (gen1/presale) require a server co-signature (thirdPartySigner) gated on remaining
    // credits — round the wallet-signed mint txs through the co-sign endpoint before sending. The
    // allowList proof tx is NOT co-signed (it carries no mintV2).
    // May shrink below `quantity` when the server only co-signs the wallet's remaining entitlement
    // (off-chain ledger lagging the chain). From here on the pipeline operates on `effectiveQuantity`.
    let effectiveQuantity = quantity
    if (plan.thirdPartySignerKey) {
      const cosignRes = await cosignGatedMintTransactions(umi, signedTransactions, {
        wallet: walletB58,
        network,
        phase,
      })
      if (!cosignRes.ok) {
        return { ok: false, error: cosignRes.error, plannedMintB58s: plannedB58s }
      }
      signedTransactions = cosignRes.transactions
      effectiveQuantity = signedTransactions.length
    }
    // The first `effectiveQuantity` planned mints align 1:1 with the co-signed (and only sent) txs;
    // any extras the wallet pre-signed are simply dropped (never sent, no on-chain effect).
    const activePlannedB58s = plannedB58s.slice(0, effectiveQuantity)

    // Send + confirm via HTTP polling (the mint RPC proxy has no websocket, so UMI
    // sendAndConfirm would block until blockhash expiry even after the tx lands).
    let firstSendError: unknown = null
    const sendOneMint = async (tx: Transaction): Promise<{ sig: string | null; confirmed: boolean }> => {
      let sig: string | null = null
      try {
        const sigBytes = await withSolanaRpcRetry(
          () => umi.rpc.sendTransaction(tx, { skipPreflight: false }),
          MINT_SOLANA_SEND_RETRY
        )
        sig = typeof sigBytes === 'string' ? sigBytes : bs58.encode(sigBytes)
        const confirmMs = Math.max(
          MINT_SEND_MIN_MS,
          mintSessionRemainingMs(sessionDeadline) - MINT_RECOVERY_RESERVE_MS
        )
        const confirmed = await pollTransactionSignatureStatus(rpcUrl, sig, {
          maxWaitMs: confirmMs,
          intervalMs: 400,
          minCommitment: 'confirmed',
        })
        return { sig, confirmed }
      } catch (e) {
        firstSendError = firstSendError ?? e
        return { sig: sig ?? extractTxSignatureFromUnknownError(e), confirmed: false }
      }
    }

    // The allowList proof tx creates the PDA that every mintV2 reads, so it must land FIRST. Send
    // it on its own and confirm before the mints. If it doesn't confirm, bail with a retry hint —
    // a retry will see the PDA exists (or not) and rebuild accordingly; no mints are at risk yet.
    if (routeSignedTx) {
      const routeResult = await sendOneMint(routeSignedTx)
      if (!routeResult.confirmed) {
        return {
          ok: false,
          error:
            isBlockhashExpiredError(firstSendError)
              ? friendlyBlockhashExpiredError()
              : 'Allowlist setup didn’t confirm — tap Mint again to finish (your spots are still reserved).',
          plannedMintB58s: plannedB58s,
        }
      }
    }

    const sendResults: Array<{ sig: string | null; confirmed: boolean }> = new Array(effectiveQuantity)
    const all = await Promise.all(signedTransactions.map((tx) => sendOneMint(tx)))
    all.forEach((r, i) => {
      sendResults[i] = r
    })

    const confirmedSigs: string[] = []
    const confirmedMints: string[] = []
    for (let i = 0; i < effectiveQuantity; i++) {
      const r = sendResults[i]
      if (r?.confirmed && r.sig) {
        confirmedSigs.push(r.sig)
        confirmedMints.push(activePlannedB58s[i]!)
      }
    }

    // Mobile wallets (Phantom/Solflare) often disconnect after the mint actually lands.
    // Verify the exact mint pubkeys WE generated this attempt — never a stale earlier mint.
    const pendingIdx = Array.from({ length: effectiveQuantity }, (_, i) => i).filter(
      (i) => !(sendResults[i]?.confirmed && sendResults[i]?.sig)
    )
    if (pendingIdx.length > 0 && mintSessionRemainingMs(sessionDeadline) > 400) {
      const pendingB58s = pendingIdx.map((i) => activePlannedB58s[i]!)
      const onChain = new Set(
        await detectPlannedMintAccounts(rpcUrl, pendingB58s, { attempts: 3, delayMs: 600 })
      )
      for (const i of pendingIdx) {
        const b58 = activePlannedB58s[i]!
        if (!onChain.has(b58)) continue
        const sig =
          sendResults[i]?.sig ??
          (await findRecentCandyMachineMintSignature(rpcUrl, walletB58, cmId, [b58]))
        if (sig) {
          confirmedSigs.push(sig)
          confirmedMints.push(b58)
        }
      }
    }

    if (confirmedMints.length >= effectiveQuantity) {
      return { ok: true, txSignatures: confirmedSigs, mintedNftMints: confirmedMints }
    }

    if (confirmedMints.length > 0) {
      // Some mints landed, some did not (e.g. blockhash expiry on a later tx). Celebrate the
      // successes; the UI prompts the user to tap Mint again for the remainder.
      return {
        ok: false,
        error:
          'Your wallet reported an error, but your mint appears on-chain — saving it now. Open your wallet Collectibles if the reveal is slow.',
        txSignatures: confirmedSigs,
        mintedNftMints: confirmedMints,
        plannedMintB58s: activePlannedB58s.filter((b) => !confirmedMints.includes(b)),
      }
    }

    const msg =
      firstSendError instanceof Error ? firstSendError.message : String(firstSendError ?? 'mint_failed')
    if (firstSendError instanceof MintSessionTimeoutError) {
      return { ok: false, error: msg, plannedMintB58s: activePlannedB58s }
    }
    const error = isBlockhashExpiredError(firstSendError)
      ? friendlyBlockhashExpiredError()
      : isTransactionTooLargeError(firstSendError)
        ? friendlyTransactionTooLargeError(quantity)
        : friendlyMintSimulationError(msg, collectPlatformMintFee) ??
          friendlySolanaRpcErrorMessage(firstSendError) ??
          msg
    return { ok: false, error, plannedMintB58s: activePlannedB58s }
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
