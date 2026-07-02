import 'server-only'

import bs58 from 'bs58'
import { fetchMetadata, findMetadataPda, updateV1 } from '@metaplex-foundation/mpl-token-metadata'
import { publicKey, some, type Umi } from '@metaplex-foundation/umi'

import {
  buildWalletImageSetFromImageUrl,
  fetchMetadataJsonFromUri,
  imageUrlFromMetadataJson,
  metadataJsonImageNeedsWalletFix,
  rewriteJsonImageFields,
} from '@/lib/owl-center/metadata-json-fix'
import {
  createIrysUploader,
  ensureIrysFundedForUpload,
  isIrysUploadConfigured,
  uploadBufferWithUploader,
  type IrysUploaderHandle,
} from '@/lib/owl-center/irys-uploader'
import { createIrysDeployerUmi } from '@/lib/owl-center/sugar-deploy-onchain'
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { getGen2CollectionMint, isDevnetMintEnabled, type OwlMintNetwork } from '@/lib/solana/network'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

/** Marker every wallet-safe `image` URL contains (Owltopia proxy). */
const PROXY_IMAGE_MARKER = '/api/proxy-image'

/** Rough size used to top up the Irys bundler before a batch (each metadata JSON is ~1 KB). */
const ESTIMATED_JSON_BYTES = 1500

export type WalletSafeFixOutcome =
  | { mint: string; ok: true; status: 'fixed'; signature: string; uri: string }
  | { mint: string; ok: true; status: 'already_safe' }
  | { mint: string; ok: true; status: 'dry_run'; wouldUploadFrom: string }
  | { mint: string; ok: false; error: string }

export type WalletSafeFixSummary = {
  network: OwlMintNetwork
  dry_run: boolean
  collection_mint: string | null
  candidates: number
  processed: number
  fixed: number
  already_safe: number
  failed: number
  time_budget_hit: boolean
  results: WalletSafeFixOutcome[]
}

function dasRpcUrl(): string {
  return resolveServerSolanaRpcUrl()
}

/** Recent Gen2 mint addresses from DB — cheap cron candidate set vs full getAssetsByGroup walk. */
async function listRecentGen2MintAddresses(limit = 60): Promise<string[]> {
  const launch = await getOwlCenterLaunchBySlug('gen2')
  if (!launch) return []
  const network = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  const db = getSupabaseAdmin()
  const { data } = await db
    .from('owl_center_mint_events')
    .select('minted_nft_mints')
    .eq('launch_id', launch.id)
    .eq('network', network)
    .order('created_at', { ascending: false })
    .limit(Math.max(10, limit))
  const out: string[] = []
  const seen = new Set<string>()
  for (const row of data ?? []) {
    const list = (row as { minted_nft_mints?: string[] | null }).minted_nft_mints
    if (!Array.isArray(list)) continue
    for (const m of list) {
      const id = String(m ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
      if (out.length >= limit) return out
    }
  }
  return out
}

async function dasGetAssetImage(mint: string): Promise<string | null> {
  const res = await fetch(dasRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'owl-wallet-safe-asset',
      method: 'getAsset',
      params: { id: mint },
    }),
    cache: 'no-store',
  })
  const json = (await res.json()) as { result?: DasAsset; error?: unknown }
  if (json.error || !json.result) return null
  const a = json.result
  return a.content?.links?.image ?? a.content?.files?.[0]?.uri ?? null
}

/**
 * Cheap pre-filter for cron: check recent mints via getAsset instead of paginating the whole collection.
 */
export async function listRecentGen2WalletUnsafeMints(max = 30): Promise<string[]> {
  const collection = getGen2CollectionMint().trim()
  if (!collection) return []
  const recent = await listRecentGen2MintAddresses(max * 2)
  const out: string[] = []
  for (const mint of recent) {
    const image = await dasGetAssetImage(mint)
    if (!isProxyImageUrl(image)) out.push(mint)
    if (out.length >= max) break
  }
  return out
}

function isProxyImageUrl(url: unknown): boolean {
  return typeof url === 'string' && url.includes(PROXY_IMAGE_MARKER)
}

type DasAsset = {
  id: string
  content?: { links?: { image?: string }; json_uri?: string; files?: { uri?: string }[] }
}

async function dasGetAssetsByGroupPage(collection: string, page: number): Promise<{ items: DasAsset[]; total: number }> {
  const res = await fetch(dasRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'owl-wallet-safe',
      method: 'getAssetsByGroup',
      params: { groupKey: 'collection', groupValue: collection, page, limit: 1000 },
    }),
    cache: 'no-store',
  })
  const json = (await res.json()) as { result?: { items?: DasAsset[]; total?: number }; error?: unknown }
  if (json.error) throw new Error(`getAssetsByGroup: ${JSON.stringify(json.error)}`)
  return { items: json.result?.items ?? [], total: json.result?.total ?? 0 }
}

/**
 * Cheap DAS pre-filter: list collection mints whose indexed `image` is NOT the Owltopia proxy
 * (i.e. still the raw arweave.net URL that Solflare can't render). The authoritative idempotency
 * check still happens per-mint inside {@link fixOnChainMintWalletSafeMetadata} before any write.
 */
export async function listGen2WalletUnsafeMints(params: {
  collection: string
  max?: number
}): Promise<string[]> {
  const { collection, max } = params
  const out: string[] = []
  for (let page = 1; page <= 50; page++) {
    const { items } = await dasGetAssetsByGroupPage(collection, page)
    if (items.length === 0) break
    for (const a of items) {
      const image = a.content?.links?.image ?? a.content?.files?.[0]?.uri
      if (!isProxyImageUrl(image)) out.push(a.id)
      if (max && out.length >= max) return out
    }
    if (items.length < 1000) break
  }
  return out
}

function cleanName(s: string | null | undefined): string {
  return (s ?? '').replace(/\0/g, '').trim()
}

/**
 * Re-point ONE minted NFT (or the collection NFT) at wallet-safe metadata:
 * re-upload its JSON with the Owltopia proxy `image` + Irys gateway mirror in `properties.files`,
 * then `updateV1` the on-chain metadata URI. Idempotent — re-checks the live on-chain JSON and
 * skips (no upload, no tx) when it is already wallet-safe. Requires the server IRYS signer to be the
 * mint's update authority.
 */
export async function fixOnChainMintWalletSafeMetadata(params: {
  umi: Umi
  irys: IrysUploaderHandle
  mint: string
  network: OwlMintNetwork
  dryRun?: boolean
}): Promise<WalletSafeFixOutcome> {
  const { umi, irys, mint, network, dryRun } = params

  let md
  try {
    md = await fetchMetadata(umi, findMetadataPda(umi, { mint: publicKey(mint) }))
  } catch {
    return { mint, ok: false, error: 'could_not_load_onchain_metadata' }
  }

  const serverSigner = String(umi.identity.publicKey)
  if (String(md.updateAuthority) !== serverSigner) {
    return { mint, ok: false, error: `update_authority_mismatch:${String(md.updateAuthority)}` }
  }

  const currentUri = md.uri?.trim()
  if (!currentUri) return { mint, ok: false, error: 'missing_onchain_uri' }

  const json = await fetchMetadataJsonFromUri(currentUri, network)
  if (!json) return { mint, ok: false, error: 'could_not_fetch_offchain_json' }

  // Authoritative idempotency gate — never re-upload / re-sign already wallet-safe metadata.
  if (!metadataJsonImageNeedsWalletFix(json, network)) {
    return { mint, ok: true, status: 'already_safe' }
  }

  const rawImage = imageUrlFromMetadataJson(json)
  if (!rawImage) return { mint, ok: false, error: 'no_image_in_offchain_json' }
  const images = buildWalletImageSetFromImageUrl(rawImage, network)
  if (!images) return { mint, ok: false, error: `image_not_arweave:${rawImage.slice(0, 64)}` }

  if (dryRun) return { mint, ok: true, status: 'dry_run', wouldUploadFrom: rawImage }

  const fixed = rewriteJsonImageFields(json, images)
  const { uri } = await uploadBufferWithUploader(
    irys,
    Buffer.from(JSON.stringify(fixed, null, 2), 'utf8'),
    'application/json'
  )

  const res = await updateV1(umi, {
    mint: publicKey(mint),
    authority: umi.identity,
    data: some({
      name: cleanName(md.name) || md.name,
      symbol: cleanName(md.symbol),
      uri,
      sellerFeeBasisPoints: md.sellerFeeBasisPoints,
      creators: md.creators,
    }),
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

  const sig = res.signature
  const signature = typeof sig === 'string' ? sig : bs58.encode(sig)
  return { mint, ok: true, status: 'fixed', signature, uri }
}

async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  shouldStop: () => boolean,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length && !shouldStop()) {
      const idx = cursor++
      results.push(await worker(items[idx]!))
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * Drain wallet-unsafe Gen2 mints (backfill of existing mints + forward catch-all for new ones).
 * Bounded by `max` and `timeBudgetMs` so it fits a single serverless invocation; safe to call
 * repeatedly (idempotent per mint). Pass `mints` to target a specific set (e.g. a fresh mint tx).
 */
export async function runGen2WalletSafeMetadataFix(opts?: {
  network?: OwlMintNetwork
  mints?: string[]
  max?: number
  timeBudgetMs?: number
  concurrency?: number
  dryRun?: boolean
}): Promise<WalletSafeFixSummary> {
  const network: OwlMintNetwork = opts?.network ?? (isDevnetMintEnabled() ? 'devnet' : 'mainnet')
  const dryRun = opts?.dryRun ?? false
  const max = Math.max(1, opts?.max ?? 30)
  const timeBudgetMs = Math.max(5_000, opts?.timeBudgetMs ?? 50_000)
  const concurrency = Math.max(1, Math.min(8, opts?.concurrency ?? 4))
  const collection = getGen2CollectionMint().trim() || null

  const empty: WalletSafeFixSummary = {
    network,
    dry_run: dryRun,
    collection_mint: collection,
    candidates: 0,
    processed: 0,
    fixed: 0,
    already_safe: 0,
    failed: 0,
    time_budget_hit: false,
    results: [],
  }

  if (!isIrysUploadConfigured()) return { ...empty, results: [{ mint: '-', ok: false, error: 'irys_not_configured' }], failed: 1 }
  if (!collection) return { ...empty, results: [{ mint: '-', ok: false, error: 'no_collection_mint' }], failed: 1 }

  // Candidate set: explicit mints (confirm-mint), else recent DB mints checked via getAsset (cron).
  let candidates: string[]
  if (opts?.mints?.length) {
    candidates = [...new Set(opts.mints.map((m) => m.trim()).filter(Boolean))]
  } else {
    const unsafe = await listRecentGen2WalletUnsafeMints(max)
    candidates = [...new Set([collection, ...unsafe])].slice(0, max)
  }
  if (candidates.length === 0) return empty

  const umi = createIrysDeployerUmi(network)
  const irys = await createIrysUploader()

  // Top up the bundler once for the whole batch (skipped on dry runs).
  if (!dryRun) {
    try {
      await ensureIrysFundedForUpload(ESTIMATED_JSON_BYTES * candidates.length, candidates.length)
    } catch {
      /* fund best-effort: per-upload errors below will surface real shortfalls */
    }
  }

  const start = Date.now()
  const shouldStop = () => Date.now() - start > timeBudgetMs
  const results = await processWithConcurrency(candidates, concurrency, shouldStop, (mint) =>
    fixOnChainMintWalletSafeMetadata({ umi, irys, mint, network, dryRun }).catch(
      (e): WalletSafeFixOutcome => ({ mint, ok: false, error: e instanceof Error ? e.message : String(e) })
    )
  )

  let fixed = 0
  let alreadySafe = 0
  let failed = 0
  for (const r of results) {
    if (!r.ok) failed++
    else if (r.status === 'fixed') fixed++
    else if (r.status === 'already_safe') alreadySafe++
  }

  return {
    network,
    dry_run: dryRun,
    collection_mint: collection,
    candidates: candidates.length,
    processed: results.length,
    fixed,
    already_safe: alreadySafe,
    failed,
    time_budget_hit: shouldStop() && results.length < candidates.length,
    results,
  }
}
