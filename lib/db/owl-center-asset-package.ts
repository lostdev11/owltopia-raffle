import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { OwlCenterAssetPackage } from '@/lib/owl-center/asset-types'
import { mergeValidationChecklist } from '@/lib/owl-center/asset-validation'

function mapAssetRow(row: Record<string, unknown>): OwlCenterAssetPackage {
  return {
    id: String(row.id),
    launch_id: String(row.launch_id),
    logo_url: row.logo_url != null ? String(row.logo_url) : null,
    banner_url: row.banner_url != null ? String(row.banner_url) : null,
    collection_image_url: row.collection_image_url != null ? String(row.collection_image_url) : null,
    assets_storage_path: row.assets_storage_path != null ? String(row.assets_storage_path) : null,
    metadata_storage_path: row.metadata_storage_path != null ? String(row.metadata_storage_path) : null,
    traits_csv_url: row.traits_csv_url != null ? String(row.traits_csv_url) : null,
    expected_supply: Number(row.expected_supply ?? 0),
    total_images: Number(row.total_images ?? 0),
    total_metadata: Number(row.total_metadata ?? 0),
    validation_status: String(row.validation_status ?? 'PENDING') as OwlCenterAssetPackage['validation_status'],
    validation_errors: Array.isArray(row.validation_errors) ? row.validation_errors : [],
    validation_checklist: mergeValidationChecklist(row.validation_checklist as Record<string, unknown>),
    storage_provider: String(row.storage_provider ?? 'pending'),
    metadata_upload_status: String(row.metadata_upload_status ?? 'NOT_UPLOADED') as OwlCenterAssetPackage['metadata_upload_status'],
    admin_notes: row.admin_notes != null ? String(row.admin_notes) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

export async function getAssetPackageByLaunchId(launchId: string): Promise<OwlCenterAssetPackage | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('owl_center_asset_packages').select('*').eq('launch_id', launchId).maybeSingle()
  if (error || !data) return null
  return mapAssetRow(data as Record<string, unknown>)
}

export async function upsertAssetPackageForLaunch(
  launchId: string,
  patch: Partial<{
    logo_url: string | null
    banner_url: string | null
    collection_image_url: string | null
    assets_storage_path: string | null
    metadata_storage_path: string | null
    traits_csv_url: string | null
    expected_supply: number
    total_images: number
    total_metadata: number
    validation_status: OwlCenterAssetPackage['validation_status']
    validation_errors: unknown[]
    validation_checklist: Record<string, unknown>
    storage_provider: string
    metadata_upload_status: OwlCenterAssetPackage['metadata_upload_status']
    admin_notes: string | null
  }>
): Promise<OwlCenterAssetPackage | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_asset_packages')
    .upsert(
      {
        launch_id: launchId,
        ...patch,
      },
      { onConflict: 'launch_id' }
    )
    .select('*')
    .single()
  if (error || !data) {
    console.error('upsertAssetPackageForLaunch', error)
    return null
  }
  return mapAssetRow(data as Record<string, unknown>)
}

export async function rpcUpdateAssetPackageStatus(
  launchId: string,
  validationStatus: OwlCenterAssetPackage['validation_status'],
  metadataUploadStatus: OwlCenterAssetPackage['metadata_upload_status'],
  validationErrors: unknown[],
  validationChecklist: Record<string, unknown>
): Promise<boolean> {
  const db = getSupabaseAdmin()
  const { error } = await db.rpc('update_asset_package_status', {
    p_launch_id: launchId,
    p_validation_status: validationStatus,
    p_metadata_upload_status: metadataUploadStatus,
    p_validation_errors: validationErrors,
    p_validation_checklist: validationChecklist,
  })
  if (error) {
    console.error('rpcUpdateAssetPackageStatus', error)
    return false
  }
  return true
}
