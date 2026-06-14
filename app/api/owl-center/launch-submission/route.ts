import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

import { getSessionFromRequest } from '@/lib/auth-server'
import { getOwlCenterAdminWallet } from '@/lib/owl-center/admin-access'
import { attachGeneratorStagedJobToLaunch } from '@/lib/owl-center/attach-generator-staged-job'
import { parseMintDetailsConfig } from '@/lib/owl-center/launch-mint-config'
import { mergeValidationChecklist, validateAssetPackageInput } from '@/lib/owl-center/asset-validation'
import { upsertAssetPackageForLaunch } from '@/lib/db/owl-center-asset-package'
import { upsertMarketplaceReadinessForLaunch } from '@/lib/db/owl-center-marketplace'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
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

  if (!name || name.length > 120) return jsonError('Invalid collection name', 400)
  if (!symbol || symbol.length > 16) return jsonError('Invalid symbol', 400)
  if (!Number.isInteger(supply) || supply < 1 || supply > 1_000_000) {
    return jsonError('Invalid total supply', 400)
  }

  const mintConfig = parseMintDetailsConfig({ ...body, total_supply: supply })
  if ('error' in mintConfig) return jsonError(mintConfig.error, 400)

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

  const slug = `sub-${randomUUID().replace(/-/g, '')}`

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
      total_supply: mintConfig.total_supply,
      minted_count: 0,
      active_phase: 'PRESALE',
      status: 'PENDING_REVIEW',
      presale_supply: mintConfig.presale_supply,
      wl_supply: mintConfig.wl_supply,
      public_supply: mintConfig.public_supply,
      airdrop_supply: mintConfig.airdrop_supply,
      presale_overage_supply: mintConfig.presale_overage_supply,
      presale_price_usdc: null,
      wl_price_usdc: mintConfig.wl_price_usdc,
      public_price_usdc: mintConfig.public_price_usdc,
      wallet_mint_limit: mintConfig.wallet_mint_limit,
      magic_eden_url: null,
      tensor_url: null,
      is_featured: false,
      is_paused: true,
      launch_deadline_at: mintConfig.launch_deadline_at,
      phase_schedule: mintConfig.phase_schedule,
      creator_presale_enabled: mintConfig.creator_presale_enabled,
      creator_wl_enabled: mintConfig.creator_wl_enabled,
      creator_mint_price: mintConfig.creator_mint_price,
      creator_mint_currency: mintConfig.creator_mint_currency,
      creator_launch_date: mintConfig.launch_deadline_at,
      mint_mode: 'public_simple',
      mint_network: 'mainnet',
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
