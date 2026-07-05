import 'server-only'

/**
 * GEN2 mint → Discord feed.
 *
 * Posts each freshly minted NFT (image + name + minter + phase + marketplace links) to a dedicated
 * Discord channel via an incoming webhook, and keeps ONE pinned-style "live progress" status message
 * up to date with per-phase + total mint bars (edited in place, not re-posted).
 *
 * Fire-and-forget: every call is wrapped in try/catch by the caller (`waitUntil`) and must never
 * throw into the mint-confirmation response. Mainnet only — devnet test mints are ignored.
 */
import {
  type DiscordIncomingEmbed,
  editDiscordIncomingWebhookEmbed,
  postDiscordIncomingWebhookContentAndEmbed,
  postDiscordIncomingWebhookEmbedReturnId,
  postDiscordIncomingWebhookEmbeds,
} from '@/lib/discord-incoming-webhook'
import {
  discordEmbedImageUrlFromRaw,
  isReliableDiscordFeedImageUri,
} from '@/lib/discord-nft-embed-image'
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { gen2PhasePoolCap, gen2PublicPoolCap } from '@/lib/owl-center/gen2-phase-advance'
import { owlCenterPhaseLabel } from '@/lib/owl-center/phase-display'
import { OWL_CENTER_MINTABLE_PHASES } from '@/lib/owl-center/phase-schedule'
import { sumOwlCenterPhaseMinted } from '@/lib/owl-center/presale-mint-pool'
import { reconcileLaunchMintedCount } from '@/lib/owl-center/reconcile-gen2-minted-count'
import type { OwlCenterLaunchPublic, OwlCenterPhase } from '@/lib/owl-center/types'
import { fetchNftMintMetaFromHelius } from '@/lib/nft-helius-image'
import { fetchMetadataJsonFromUri, imageUrlFromMetadataJson } from '@/lib/owl-center/metadata-json-fix'
import { getMetaplexTokenMetadata } from '@/lib/solana/metaplex-mint-onchain-metadata'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { Connection, PublicKey } from '@solana/web3.js'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

const GEN2_SLUG = 'gen2'

/** Owltopia purple for the live status message; per-phase mint posts get a phase-tinted color. */
const STATUS_COLOR = 0x7c3aed
const PHASE_COLORS: Record<OwlCenterPhase, number> = {
  AIRDROP: 0x22c55e,
  PRESALE: 0x3b82f6,
  PRESALE_OVERAGE: 0x0ea5e9,
  WHITELIST: 0xf59e0b,
  PUBLIC: 0x7c3aed,
  SOLD_OUT: 0xef4444,
  TRADING_ACTIVE: 0x10b981,
}

export function gen2MintFeedWebhookUrl(): string | null {
  const url = process.env.DISCORD_WEBHOOK_GEN2_MINT?.trim()
  return url || null
}

function shortWallet(w: string): string {
  return w.length > 8 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

/** Unicode progress bar (filled/empty blocks). */
function progressBar(percent: number, slots = 12): string {
  const pct = Math.max(0, Math.min(100, percent))
  const filled = Math.round((pct / 100) * slots)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, slots - filled))
}

function pct(minted: number, total: number): number {
  return total > 0 ? (minted / total) * 100 : 0
}

type PhaseProgress = { phase: OwlCenterPhase; label: string; minted: number; cap: number }
type MintProgressSnapshot = {
  total: number
  minted: number
  percent: number
  phases: PhaseProgress[]
}

/** Mirror the admin `/state` math: reconciled total + per-phase minted vs each phase's pool cap. */
async function buildProgressSnapshot(
  launch: OwlCenterLaunchPublic,
  network: 'mainnet' | 'devnet'
): Promise<MintProgressSnapshot> {
  const minted = await reconcileLaunchMintedCount(launch.id, network)

  const phaseMintedEntries = await Promise.all(
    OWL_CENTER_MINTABLE_PHASES.map(
      async (phase) => [phase, await sumOwlCenterPhaseMinted(launch.id, phase, network)] as const
    )
  )
  const phaseMinted = Object.fromEntries(phaseMintedEntries) as Record<OwlCenterPhase, number>

  const phases: PhaseProgress[] = OWL_CENTER_MINTABLE_PHASES.map((phase) => {
    const cap =
      phase === 'PUBLIC'
        ? gen2PublicPoolCap(launch, phaseMinted.WHITELIST ?? 0)
        : gen2PhasePoolCap(launch, phase)
    return { phase, label: owlCenterPhaseLabel(phase), minted: phaseMinted[phase] ?? 0, cap }
  })

  return { total: launch.total_supply, minted, percent: pct(minted, launch.total_supply), phases }
}

function discordImageUrl(rawImageUri: string | null | undefined): string | undefined {
  return discordEmbedImageUrlFromRaw(rawImageUri)
}

type MintFeedMeta = { name: string | null; image: string | null }

/** On-chain Metaplex metadata + JSON — available the instant the mint confirms (before DAS indexes). */
async function fetchOnChainMintFeedMeta(mint: string): Promise<MintFeedMeta> {
  const rpcUrl = getHeliusMainnetRpcUrl()
  if (!rpcUrl) return { name: null, image: null }

  try {
    const connection = new Connection(rpcUrl, 'confirmed')
    const onChain = await getMetaplexTokenMetadata(connection, new PublicKey(mint))
    if (!onChain) return { name: null, image: null }

    let name = onChain.name?.trim() || null
    let image: string | null = null

    if (onChain.uri) {
      const json = await fetchMetadataJsonFromUri(onChain.uri, 'mainnet')
      if (json) {
        const fromJson = imageUrlFromMetadataJson(json)
        if (fromJson && isReliableDiscordFeedImageUri(fromJson)) image = fromJson
        if (!name && typeof json.name === 'string' && json.name.trim()) name = json.name.trim()
      }
    }

    return { name, image }
  } catch (e) {
    console.error('[gen2-mint-discord-feed] on-chain metadata read failed', mint, e)
    return { name: null, image: null }
  }
}

/**
 * Resolve a just-minted owl's name + image for the Discord card.
 *
 * On-chain JSON is read first (available at confirm time). DAS supplements the token id when the
 * indexer has caught up. Unreliable interim gateway/CDN URLs from DAS are never posted.
 */
async function resolveMintFeedMeta(mint: string): Promise<MintFeedMeta> {
  const [onChain, das] = await Promise.all([
    fetchOnChainMintFeedMeta(mint),
    fetchNftMintMetaFromHelius(mint, { preferMainnet: true, bypassCache: true }),
  ])

  let name = onChain.name ?? das?.name ?? null
  let image = onChain.image ?? null

  if (!image && das?.image && isReliableDiscordFeedImageUri(das.image)) {
    image = das.image
  }
  if (!name && das?.name) name = das.name

  if (!image) {
    console.warn('[gen2-mint-discord-feed] no image for mint embed', mint, { name })
  }

  return { name, image }
}

function buildMintEmbed(input: {
  mint: string
  name: string | null
  imageUrl?: string
  fallbackThumbnailUrl?: string
  wallet: string
  phase: OwlCenterPhase
  txSig: string
}): DiscordIncomingEmbed {
  const { mint, name, imageUrl, fallbackThumbnailUrl, wallet, phase, txSig } = input
  const links = [
    `[Tx](https://solscan.io/tx/${encodeURIComponent(txSig)})`,
    `[Magic Eden](https://magiceden.io/item-details/${encodeURIComponent(mint)})`,
    `[Tensor](https://www.tensor.trade/item/${encodeURIComponent(mint)})`,
  ].join(' • ')

  return {
    title: name?.trim() || 'GEN2 Owl',
    url: `https://solscan.io/token/${encodeURIComponent(mint)}`,
    color: PHASE_COLORS[phase] ?? STATUS_COLOR,
    description: `Minted in **${owlCenterPhaseLabel(phase)}** by [${shortWallet(wallet)}](https://solscan.io/account/${encodeURIComponent(wallet)})`,
    fields: [{ name: 'Links', value: links }],
    ...(imageUrl
      ? { image: { url: imageUrl } }
      : fallbackThumbnailUrl
        ? { thumbnail: { url: fallbackThumbnailUrl } }
        : {}),
    timestamp: new Date().toISOString(),
  }
}

/** Plain content line carrying the live progress for the just-minted phase + total. */
function buildMintContentLine(phase: OwlCenterPhase, qty: number, snap: MintProgressSnapshot): string {
  const phaseLabel = owlCenterPhaseLabel(phase)
  const p = snap.phases.find((x) => x.phase === phase)
  const head = `🦉 **${qty} GEN2 Owl${qty > 1 ? 's' : ''} minted** • ${phaseLabel}`
  const phaseLine = p
    ? `${phaseLabel} ${p.minted}/${p.cap}  ${progressBar(pct(p.minted, p.cap), 10)} ${Math.floor(pct(p.minted, p.cap))}%`
    : ''
  const totalLine = `Total ${snap.minted}/${snap.total}  ${progressBar(snap.percent, 10)} ${Math.floor(snap.percent)}%`
  return [head, phaseLine, totalLine].filter(Boolean).join('\n')
}

function buildStatusEmbed(launch: OwlCenterLaunchPublic, snap: MintProgressSnapshot): DiscordIncomingEmbed {
  const phaseLines = snap.phases
    .filter((p) => p.cap > 0)
    .map((p) => `**${p.label}** — ${p.minted}/${p.cap}\n${progressBar(pct(p.minted, p.cap))} ${Math.floor(pct(p.minted, p.cap))}%`)
    .join('\n\n')
  const totalLine = `**Total** — ${snap.minted}/${snap.total}\n${progressBar(snap.percent)} ${Math.floor(snap.percent)}%`

  return {
    title: '🦉 GEN2 Mint — Live Progress',
    color: STATUS_COLOR,
    description: `${phaseLines}\n\n${totalLine}`,
    ...(launch.image_url?.trim() ? { thumbnail: { url: discordImageUrl(launch.image_url)! } } : {}),
    footer: { text: 'Owltopia • updates live as owls mint' },
    timestamp: new Date().toISOString(),
  }
}

/** Edit the existing live status message, or post a fresh one and remember its id. */
async function upsertStatusMessage(
  launch: OwlCenterLaunchPublic,
  snap: MintProgressSnapshot,
  network: 'mainnet' | 'devnet',
  webhookUrl: string
): Promise<boolean> {
  const db = getSupabaseAdmin()
  const rowId = `${launch.slug}-${network}`
  const embed = buildStatusEmbed(launch, snap)

  const { data } = await db
    .from('owl_center_discord_mint_feed')
    .select('status_message_id')
    .eq('id', rowId)
    .maybeSingle()

  const existingId = (data as { status_message_id?: string | null } | null)?.status_message_id?.trim() || null

  const persist = async (statusMessageId: string) => {
    await db.from('owl_center_discord_mint_feed').upsert(
      {
        id: rowId,
        launch_slug: launch.slug,
        network,
        status_message_id: statusMessageId,
        last_minted: snap.minted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
  }

  if (existingId) {
    const result = await editDiscordIncomingWebhookEmbed(webhookUrl, existingId, embed)
    if (result === 'ok') {
      await persist(existingId)
      return true
    }
    // 'failed' = transient (rate limit / network); keep the id and try again next mint.
    if (result === 'failed') return false
    // 'not_found' = message was deleted in Discord; fall through and recreate it.
  }

  const newId = await postDiscordIncomingWebhookEmbedReturnId(webhookUrl, embed)
  if (newId) {
    await persist(newId)
    return true
  }
  return false
}

type Gen2MintEventForFeed = {
  wallet_address: string
  quantity: number
  phase: OwlCenterPhase
  minted_nft_mints: string[] | null
  network: string
}

async function getGen2MintEventForDiscordFeed(txSignature: string): Promise<Gen2MintEventForFeed | null> {
  const launch = await getOwlCenterLaunchBySlug(GEN2_SLUG)
  if (!launch) return null

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_mint_events')
    .select('wallet_address, quantity, phase, minted_nft_mints, network')
    .eq('launch_id', launch.id)
    .eq('tx_signature', txSignature)
    .maybeSingle()
  if (error || !data) return null
  return data as Gen2MintEventForFeed
}

/** Atomically mark a mint event as Discord-notified; returns false when already posted. */
async function claimGen2MintDiscordFeedPost(txSignature: string): Promise<boolean> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_mint_events')
    .update({ discord_feed_posted_at: new Date().toISOString() })
    .eq('tx_signature', txSignature)
    .is('discord_feed_posted_at', null)
    .select('tx_signature')
    .maybeSingle()
  return !error && Boolean(data)
}

async function releaseGen2MintDiscordFeedClaim(txSignature: string): Promise<void> {
  const db = getSupabaseAdmin()
  await db.from('owl_center_mint_events').update({ discord_feed_posted_at: null }).eq('tx_signature', txSignature)
}

async function listPendingGen2MintDiscordFeedTxs(limit: number): Promise<string[]> {
  const launch = await getOwlCenterLaunchBySlug(GEN2_SLUG)
  if (!launch) return []

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_mint_events')
    .select('tx_signature')
    .eq('launch_id', launch.id)
    .eq('network', 'mainnet')
    .is('discord_feed_posted_at', null)
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 50)))
  if (error) return []
  return (data ?? []).map((row) => String((row as { tx_signature: string }).tx_signature))
}

export type Gen2MintFeedInput = {
  wallet: string
  phase: OwlCenterPhase
  quantity: number
  txSignature: string
  mints: string[]
  network: 'mainnet' | 'devnet'
}

/** Cap embeds per message (Discord allows 10); a single confirm-mint rarely carries more than a few. */
const MAX_MINT_EMBEDS = 10

/**
 * Post the just-minted NFT(s) to the GEN2 mint channel and refresh the live progress message.
 * No-ops when not configured / not mainnet. Designed to be called inside `waitUntil(...)`.
 * Returns true when at least the mint card or live status message was posted successfully.
 */
export async function postGen2MintFeed(input: Gen2MintFeedInput): Promise<boolean> {
  if (input.network !== 'mainnet') return false
  const webhookUrl = gen2MintFeedWebhookUrl()
  if (!webhookUrl) return false

  const launch = await getOwlCenterLaunchBySlug(GEN2_SLUG)
  if (!launch) return false

  const mints = input.mints.filter((m) => typeof m === 'string' && m.trim()).slice(0, MAX_MINT_EMBEDS)
  const fallbackThumbnailUrl = launch.image_url?.trim()
    ? discordImageUrl(launch.image_url)
    : undefined

  const [snapshot, metas] = await Promise.all([
    buildProgressSnapshot(launch, input.network),
    Promise.all(mints.map((mint) => resolveMintFeedMeta(mint))),
  ])

  const contentLine = buildMintContentLine(input.phase, input.quantity, snapshot)
  let mintCardPosted = false

  if (mints.length > 0) {
    const embeds: DiscordIncomingEmbed[] = mints.map((mint, i) => {
      const meta = metas[i]!
      return buildMintEmbed({
        mint,
        name: meta.name,
        imageUrl: discordImageUrl(meta.image),
        fallbackThumbnailUrl,
        wallet: input.wallet,
        phase: input.phase,
        txSig: input.txSignature,
      })
    })
    mintCardPosted = await postDiscordIncomingWebhookEmbeds(webhookUrl, embeds, contentLine)
  } else {
    mintCardPosted = await postDiscordIncomingWebhookContentAndEmbed(
      webhookUrl,
      contentLine,
      {
        title: `🦉 ${input.quantity} GEN2 Owl${input.quantity > 1 ? 's' : ''} minted`,
        color: PHASE_COLORS[input.phase] ?? STATUS_COLOR,
        description: `Minted in **${owlCenterPhaseLabel(input.phase)}** by [${shortWallet(input.wallet)}](https://solscan.io/account/${encodeURIComponent(input.wallet)})`,
        fields: [
          {
            name: 'Links',
            value: `[Tx](https://solscan.io/tx/${encodeURIComponent(input.txSignature)})`,
          },
        ],
        ...(fallbackThumbnailUrl ? { thumbnail: { url: fallbackThumbnailUrl } } : {}),
        timestamp: new Date().toISOString(),
      }
    )
  }

  const statusUpdated = await upsertStatusMessage(launch, snapshot, input.network, webhookUrl)
  return mintCardPosted || statusUpdated
}

/**
 * Idempotent GEN2 mint-feed notify for one recorded tx. Safe from confirm-mint, reconcile backfill,
 * and duplicate_tx retries — claims `discord_feed_posted_at` before posting so concurrent callers
 * cannot double-post.
 */
export async function notifyGen2MintDiscordFeedForTx(txSignature: string): Promise<boolean> {
  if (!gen2MintFeedWebhookUrl()) return false

  const event = await getGen2MintEventForDiscordFeed(txSignature)
  if (!event || event.network !== 'mainnet') return false

  const claimed = await claimGen2MintDiscordFeedPost(txSignature)
  if (!claimed) return false

  try {
    const posted = await postGen2MintFeed({
      wallet: event.wallet_address,
      phase: event.phase,
      quantity: event.quantity,
      txSignature,
      mints: (event.minted_nft_mints ?? []).filter((m) => typeof m === 'string' && m.trim()),
      network: 'mainnet',
    })
    if (!posted) {
      await releaseGen2MintDiscordFeedClaim(txSignature)
    }
    return posted
  } catch (e) {
    await releaseGen2MintDiscordFeedClaim(txSignature)
    console.error('[gen2-mint-discord-feed] notify failed', txSignature, e)
    return false
  }
}

/** Drain pending mainnet GEN2 mint events that never reached Discord (reconcile-first race, etc.). */
export async function flushPendingGen2MintDiscordFeed(opts?: { limit?: number }): Promise<number> {
  const sigs = await listPendingGen2MintDiscordFeedTxs(opts?.limit ?? 20)
  let posted = 0
  for (let i = 0; i < sigs.length; i++) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    if (await notifyGen2MintDiscordFeedForTx(sigs[i]!)) posted += 1
  }
  return posted
}

/**
 * Admin/setup helper: posts ONE per-mint card (clearly labeled as a preview) for a real minted owl
 * and refreshes the live progress status message. Used to verify the channel + webhook before mint
 * day without faking a live mint notification. Mainnet only; no-ops when the webhook env is unset.
 */
export async function sendGen2MintFeedPreview(input: {
  mint: string
  wallet: string
  phase: OwlCenterPhase
  txSignature: string
}): Promise<{ ok: boolean; reason?: string }> {
  const webhookUrl = gen2MintFeedWebhookUrl()
  if (!webhookUrl) return { ok: false, reason: 'webhook_not_configured' }

  const launch = await getOwlCenterLaunchBySlug(GEN2_SLUG)
  if (!launch) return { ok: false, reason: 'launch_not_found' }

  const snapshot = await buildProgressSnapshot(launch, 'mainnet')
  const meta = await resolveMintFeedMeta(input.mint)
  const embed = buildMintEmbed({
    mint: input.mint,
    name: meta.name,
    imageUrl: discordImageUrl(meta.image),
    fallbackThumbnailUrl: launch.image_url?.trim() ? discordImageUrl(launch.image_url) : undefined,
    wallet: input.wallet,
    phase: input.phase,
    txSig: input.txSignature,
  })

  const previewContent = [
    '🔧 **Channel setup preview** — this is what each GEN2 mint will look like. Safe to delete.',
    buildMintContentLine(input.phase, 1, snapshot),
  ].join('\n')

  const posted = await postDiscordIncomingWebhookEmbeds(webhookUrl, [embed], previewContent)
  await upsertStatusMessage(launch, snapshot, 'mainnet', webhookUrl)
  return { ok: posted }
}
