import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import {
  mergeValidationChecklist,
  validateAssetPackageInput,
  allChecklistComplete,
  formatValidationErrors,
} from '@/lib/owl-center/asset-validation'
import {
  OWL_CENTER_METADATA_UPLOAD_STATUSES,
  OWL_CENTER_VALIDATION_STATUSES,
  type OwlCenterMetadataUploadStatus,
  type OwlCenterValidationStatus,
} from '@/lib/owl-center/asset-types'
import {
  getAssetPackageByLaunchId,
  rpcUpdateAssetPackageStatus,
  upsertAssetPackageForLaunch,
} from '@/lib/db/owl-center-asset-package'
import { getMarketplaceReadinessByLaunchId } from '@/lib/db/owl-center-marketplace'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function loadBundle(launchId: string) {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return null
  const [assetPackage, marketplaceReadiness] = await Promise.all([
    getAssetPackageByLaunchId(launchId),
    getMarketplaceReadinessByLaunchId(launchId),
  ])
  return { launch, assetPackage, marketplaceReadiness }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid collection id', 400)

  const bundle = await loadBundle(id)
  if (!bundle) return jsonError('Launch not found', 404)

  return NextResponse.json(bundle)
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-assets:${ip}`, 120, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid collection id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const action = typeof body.action === 'string' ? body.action : ''
  const existing = await getAssetPackageByLaunchId(id)

  const pickStr = (key: string): string | null | undefined => {
    if (!(key in body)) return undefined
    const v = body[key]
    if (v === null) return null
    if (typeof v !== 'string') return undefined
    const t = v.trim()
    return t === '' ? null : t
  }

  const pickNum = (key: string): number | undefined => {
    if (!(key in body)) return undefined
    const v = Number(body[key])
    if (!Number.isFinite(v)) return undefined
    return Math.floor(v)
  }

  const upsertPatch: Parameters<typeof upsertAssetPackageForLaunch>[1] = {}

  const keys = [
    'logo_url',
    'banner_url',
    'collection_image_url',
    'assets_storage_path',
    'metadata_storage_path',
    'traits_csv_url',
    'expected_supply',
    'total_images',
    'total_metadata',
  ] as const

  for (const k of keys) {
    if (k === 'expected_supply' || k === 'total_images' || k === 'total_metadata') {
      const n = pickNum(k)
      if (n !== undefined) upsertPatch[k] = n
    } else {
      const s = pickStr(k)
      if (s !== undefined) upsertPatch[k] = s
    }
  }

  if ('admin_notes' in body && typeof body.admin_notes === 'string') {
    upsertPatch.admin_notes = body.admin_notes.slice(0, 8000) || null
  }

  if ('validation_checklist' in body && body.validation_checklist && typeof body.validation_checklist === 'object') {
    upsertPatch.validation_checklist = mergeValidationChecklist(
      body.validation_checklist as Record<string, unknown>
    ) as unknown as Record<string, unknown>
  }

  if ('validation_errors' in body && Array.isArray(body.validation_errors)) {
    upsertPatch.validation_errors = body.validation_errors
  }

  if ('validation_status' in body && typeof body.validation_status === 'string') {
    const s = body.validation_status.toUpperCase() as OwlCenterValidationStatus
    if (!OWL_CENTER_VALIDATION_STATUSES.includes(s)) return jsonError('Invalid validation_status', 400)
    upsertPatch.validation_status = s
  }

  if ('metadata_upload_status' in body && typeof body.metadata_upload_status === 'string') {
    const s = body.metadata_upload_status.toUpperCase() as OwlCenterMetadataUploadStatus
    if (!OWL_CENTER_METADATA_UPLOAD_STATUSES.includes(s)) return jsonError('Invalid metadata_upload_status', 400)
    upsertPatch.metadata_upload_status = s
  }

  const mergedForValidate = {
    logo_url: upsertPatch.logo_url ?? existing?.logo_url ?? '',
    banner_url: upsertPatch.banner_url ?? existing?.banner_url ?? '',
    collection_image_url: upsertPatch.collection_image_url ?? existing?.collection_image_url ?? '',
    assets_storage_path: upsertPatch.assets_storage_path ?? existing?.assets_storage_path ?? '',
    metadata_storage_path: upsertPatch.metadata_storage_path ?? existing?.metadata_storage_path ?? '',
    traits_csv_url: upsertPatch.traits_csv_url ?? existing?.traits_csv_url ?? '',
    expected_supply: upsertPatch.expected_supply ?? existing?.expected_supply ?? 0,
    total_images: upsertPatch.total_images ?? existing?.total_images ?? 0,
    total_metadata: upsertPatch.total_metadata ?? existing?.total_metadata ?? 0,
  }

  if (Object.keys(upsertPatch).length > 0 || !existing) {
    const v = validateAssetPackageInput(mergedForValidate)
    if (!v.ok) return jsonError(v.errors.join('; '), 400)
  }

  if (Object.keys(upsertPatch).length > 0 || !existing) {
    const saved = await upsertAssetPackageForLaunch(id, upsertPatch)
    if (!saved) return jsonError('Save failed', 500)
  }

  const fresh = await getAssetPackageByLaunchId(id)
  if (!fresh) return jsonError('Asset package missing', 500)

  let validationStatus = fresh.validation_status as OwlCenterValidationStatus
  let metadataUploadStatus = fresh.metadata_upload_status as OwlCenterMetadataUploadStatus
  let validationChecklist = mergeValidationChecklist(fresh.validation_checklist as Record<string, unknown>)
  let validationErrors = fresh.validation_errors

  if ('validation_checklist' in body && body.validation_checklist && typeof body.validation_checklist === 'object') {
    validationChecklist = mergeValidationChecklist(body.validation_checklist as Record<string, unknown>)
  }
  if ('validation_errors' in body && Array.isArray(body.validation_errors)) {
    validationErrors = body.validation_errors
  }
  if ('validation_status' in body && typeof body.validation_status === 'string') {
    const s = body.validation_status.toUpperCase() as OwlCenterValidationStatus
    if (OWL_CENTER_VALIDATION_STATUSES.includes(s)) validationStatus = s
  }
  if ('metadata_upload_status' in body && typeof body.metadata_upload_status === 'string') {
    const s = body.metadata_upload_status.toUpperCase() as OwlCenterMetadataUploadStatus
    if (OWL_CENTER_METADATA_UPLOAD_STATUSES.includes(s)) metadataUploadStatus = s
  }

  if (action === 'mark_valid') {
    validationStatus = 'VALID'
  } else if (action === 'mark_needs_review') {
    validationStatus = 'NEEDS_REVIEW'
  } else if (action === 'mark_ready_cm') {
    validationStatus = 'VALID'
    metadataUploadStatus = 'READY_FOR_CANDY_MACHINE'
  }

  if (action === 'mark_valid' || action === 'mark_ready_cm') {
    if (!allChecklistComplete(validationChecklist)) {
      return NextResponse.json(
        {
          error: 'Checklist incomplete',
          validation_errors: formatValidationErrors([
            ...formatValidationErrors(validationErrors),
            'Complete all checklist items before marking VALID / ready for Candy Machine.',
          ]),
          validation_checklist: validationChecklist,
        },
        { status: 400 }
      )
    }
  }

  const rpcOk = await rpcUpdateAssetPackageStatus(
    id,
    validationStatus,
    metadataUploadStatus,
    validationErrors,
    validationChecklist as unknown as Record<string, unknown>
  )
  if (!rpcOk) return jsonError('Status sync failed', 500)

  const bundle = await loadBundle(id)
  return NextResponse.json(bundle)
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return PATCH(request, context)
}
