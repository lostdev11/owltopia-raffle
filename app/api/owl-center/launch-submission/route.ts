import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

import { getSessionFromRequest } from '@/lib/auth-server'
import { getOwlCenterAdminWallet } from '@/lib/owl-center/admin-access'
import { attachGeneratorStagedJobToLaunch } from '@/lib/owl-center/attach-generator-staged-job'
import { mergeValidationChecklist, validateAssetPackageInput } from '@/lib/owl-center/asset-validation'
import { upsertAssetPackageForLaunch } from '@/lib/db/owl-center-asset-package'
import { upsertMarketplaceReadinessForLaunch } from '@/lib/db/owl-center-marketplace'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { datetimeLocalToIso, parsePhaseSchedule } from '@/lib/owl-center/phase-schedule'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-launch-sub:${ip}`, 6, 3600_000).allowed) {
    return jsonError('Too many submissions — try later.', 429)
  }

  const adminWallet = await getOwlCenterAdminWallet(request)
  if (!adminWallet) return jsonError('Admin access required', 403)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const sessionWallet = getSessionFromRequest(request)?.wallet

  let creator = normalizeSolanaWalletAddress(
    typeof body.creator_wallet === 'string' ? body.creator_wallet : ''
  )
  if (sessionWallet) {
    const normalizedSession = normalizeSolanaWalletAddress(sessionWallet)
    if (normalizedSession) creator = normalizedSession
  }
  if (!creator) {
    return jsonError('Connect and sign in, or provide a valid creator wallet.', 400)
  }

  const name = typeof body.collection_name === 'string' ? body.collection_name.trim() : ''
  const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : ''
  const description = typeof body.description === 'string' ? body.description.slice(0, 4000) : null
  let treasury: string | null = null
  if (typeof body.treasury_wallet === 'string' && body.treasury_wallet.trim()) {
    const t = normalizeSolanaWalletAddress(body.treasury_wallet.trim())
    if (!t) return jsonError('Invalid treasury wallet', 400)
    treasury = t
  }

  const supply = Number(body.total_supply)
  const price = Number(body.mint_price)
  const currency = body.currency === 'USDC' ? 'USDC' : 'SOL'
  const limit = Number(body.wallet_mint_limit)
  const presaleEnabled = Boolean(body.presale_enabled)
  const wlEnabled = Boolean(body.wl_enabled)

  if (!name || name.length > 120) return jsonError('Invalid collection name', 400)
  if (!symbol || symbol.length > 16) return jsonError('Invalid symbol', 400)
  if (!Number.isInteger(supply) || supply < 1 || supply > 1_000_000) {
    return jsonError('Invalid total supply', 400)
  }
  if (!Number.isFinite(price) || price < 0) return jsonError('Invalid mint price', 400)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return jsonError('Invalid wallet mint limit', 400)
  }

  let launchDeadline: string | null = null
  if (typeof body.launch_date === 'string' && body.launch_date.trim()) {
    launchDeadline = datetimeLocalToIso(body.launch_date.trim()) ?? new Date(body.launch_date).toISOString()
  }
  const phaseSchedule = parsePhaseSchedule(body.phase_schedule)
  if (launchDeadline && !phaseSchedule.AIRDROP) {
    phaseSchedule.AIRDROP = launchDeadline
  }

  const slug = `sub-${randomUUID().replace(/-/g, '')}`

  const logoUrl = typeof body.logo_url === 'string' ? body.logo_url.trim().slice(0, 2000) : null
  const bannerUrl = typeof body.banner_url === 'string' ? body.banner_url.trim().slice(0, 2000) : null
  const collectionImageUrl =
    typeof body.collection_image_url === 'string' ? body.collection_image_url.trim().slice(0, 2000) : null
  const assetsPath =
    typeof body.assets_package_url === 'string' ? body.assets_package_url.trim().slice(0, 4000) : null
  const metadataPath =
    typeof body.metadata_package_url === 'string' ? body.metadata_package_url.trim().slice(0, 4000) : null
  const traitsCsv =
    typeof body.traits_csv_url === 'string' ? body.traits_csv_url.trim().slice(0, 2000) : null
  const assetNotes = typeof body.asset_notes === 'string' ? body.asset_notes.slice(0, 4000) : null

  const hasAssets =
    !!(logoUrl || bannerUrl || collectionImageUrl || assetsPath || metadataPath || traitsCsv || assetNotes)

  if (hasAssets) {
    const v = validateAssetPackageInput({
      logo_url: logoUrl ?? '',
      banner_url: bannerUrl ?? '',
      collection_image_url: collectionImageUrl ?? '',
      assets_storage_path: assetsPath ?? '',
      metadata_storage_path: metadataPath ?? '',
      traits_csv_url: traitsCsv ?? '',
      expected_supply: supply,
      total_images: body.total_images !== undefined ? Number(body.total_images) : undefined,
      total_metadata: body.total_metadata !== undefined ? Number(body.total_metadata) : undefined,
    })
    if (!v.ok) return jsonError(v.errors.join('; '), 400)
  }

  const db = getSupabaseAdmin()
  const imageUrl = collectionImageUrl || logoUrl || null

  const { data: inserted, error: insErr } = await db
    .from('owl_center_launches')
    .insert({
      slug,
      name,
      symbol,
      description,
      image_url: imageUrl,
      creator_wallet: creator,
      treasury_wallet: treasury,
      mint_standard: 'token_metadata',
      total_supply: supply,
      minted_count: 0,
      active_phase: 'PRESALE',
      status: 'PENDING_REVIEW',
      presale_supply: 0,
      wl_supply: 0,
      public_supply: supply,
      airdrop_supply: 0,
      presale_price_usdc: null,
      wl_price_usdc: null,
      public_price_usdc: currency === 'USDC' ? price : null,
      wallet_mint_limit: limit,
      magic_eden_url: null,
      tensor_url: null,
      is_featured: false,
      is_paused: true,
      launch_deadline_at: launchDeadline,
      phase_schedule: phaseSchedule,
      creator_presale_enabled: presaleEnabled,
      creator_wl_enabled: wlEnabled,
      creator_mint_price: price,
      creator_mint_currency: currency,
      creator_launch_date: launchDeadline,
    })
    .select('id')
    .single()

  if (insErr || !inserted) {
    console.error('owl_center_launches insert', insErr)
    return jsonError('Save failed', 500)
  }

  const launchId = String((inserted as { id: string }).id)

  await upsertMarketplaceReadinessForLaunch(launchId, {
    metadata_status: 'NOT_READY',
    verified_collection_status: 'NOT_READY',
    magic_eden_status: 'NOT_READY',
    tensor_status: 'NOT_READY',
    trading_links_active: false,
    notes: 'Creator submission — configure marketplace tracking after approval.',
  })

  if (hasAssets) {
    const ti = Number(body.total_images)
    const tm = Number(body.total_metadata)
    await upsertAssetPackageForLaunch(launchId, {
      logo_url: logoUrl,
      banner_url: bannerUrl,
      collection_image_url: collectionImageUrl,
      assets_storage_path: assetsPath,
      metadata_storage_path: metadataPath,
      traits_csv_url: traitsCsv,
      expected_supply: supply,
      total_images: Number.isInteger(ti) ? ti : 0,
      total_metadata: Number.isInteger(tm) ? tm : 0,
      admin_notes: assetNotes,
      validation_checklist: mergeValidationChecklist({}) as unknown as Record<string, unknown>,
      validation_status: 'PENDING',
      metadata_upload_status: 'NOT_UPLOADED',
      storage_provider: 'pending',
    })
  }

  const generatorProjectId =
    typeof body.generator_project_id === 'string' ? body.generator_project_id.trim() : ''
  let generatorStaged = false
  if (generatorProjectId) {
    const attach = await attachGeneratorStagedJobToLaunch(generatorProjectId, launchId)
    generatorStaged = attach.attached
    if (attach.attached) {
      await db.from('owl_center_activity_logs').insert({
        launch_id: launchId,
        message: `Generator ZIP linked · job ${attach.job?.id.slice(0, 8) ?? '—'} · ${attach.job?.status ?? ''}`,
        event_type: 'system',
      })
    }
  }

  await db.from('owl_center_activity_logs').insert({
    launch_id: launchId,
    message: 'Launch submitted for review',
    event_type: 'submission',
  })

  return NextResponse.json({ ok: true, id: launchId, slug, generator_staged: generatorStaged })
}
