export type OwlCenterValidationStatus = 'PENDING' | 'VALID' | 'INVALID' | 'NEEDS_REVIEW'

export type OwlCenterMetadataUploadStatus =
  | 'NOT_UPLOADED'
  | 'UPLOADING'
  | 'UPLOADED_TO_IPFS'
  | 'UPLOADED_TO_ARWEAVE'
  | 'READY_FOR_CANDY_MACHINE'

export type OwlCenterMarketplaceTrackStatus =
  | 'NOT_READY'
  | 'READY_FOR_INDEXING'
  | 'INDEXING'
  | 'LISTED'
  | 'CLAIMED'
  | 'VERIFIED'
  | 'NEEDS_MANUAL_REVIEW'

/** Manual checklist keys (V1); admins tick when verified. */
export type OwlCenterAssetValidationChecklist = {
  image_count_matches_metadata_count: boolean
  metadata_count_matches_supply: boolean
  numeric_file_naming: boolean
  matching_image_json_pairs: boolean
  json_has_name: boolean
  json_has_symbol: boolean
  json_has_description: boolean
  json_has_image: boolean
  json_has_attributes: boolean
  no_duplicate_names: boolean
  no_missing_indices: boolean
  image_references_match: boolean
}

export type OwlCenterAssetPackage = {
  id: string
  launch_id: string
  logo_url: string | null
  banner_url: string | null
  collection_image_url: string | null
  assets_storage_path: string | null
  metadata_storage_path: string | null
  traits_csv_url: string | null
  expected_supply: number
  total_images: number
  total_metadata: number
  validation_status: OwlCenterValidationStatus
  validation_errors: unknown[]
  validation_checklist: Partial<OwlCenterAssetValidationChecklist>
  storage_provider: string
  metadata_upload_status: OwlCenterMetadataUploadStatus
  admin_notes: string | null
  created_at: string
  updated_at: string
}

export type OwlCenterMarketplaceReadiness = {
  id: string
  launch_id: string
  collection_mint: string | null
  candy_machine_id: string | null
  hash_list_url: string | null
  magic_eden_url: string | null
  tensor_url: string | null
  metadata_status: OwlCenterMarketplaceTrackStatus
  verified_collection_status: OwlCenterMarketplaceTrackStatus
  magic_eden_status: OwlCenterMarketplaceTrackStatus
  tensor_status: OwlCenterMarketplaceTrackStatus
  trading_links_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export const OWL_CENTER_VALIDATION_STATUSES: OwlCenterValidationStatus[] = [
  'PENDING',
  'VALID',
  'INVALID',
  'NEEDS_REVIEW',
]

export const OWL_CENTER_METADATA_UPLOAD_STATUSES: OwlCenterMetadataUploadStatus[] = [
  'NOT_UPLOADED',
  'UPLOADING',
  'UPLOADED_TO_IPFS',
  'UPLOADED_TO_ARWEAVE',
  'READY_FOR_CANDY_MACHINE',
]

export const OWL_CENTER_MARKETPLACE_STATUSES: OwlCenterMarketplaceTrackStatus[] = [
  'NOT_READY',
  'READY_FOR_INDEXING',
  'INDEXING',
  'LISTED',
  'CLAIMED',
  'VERIFIED',
  'NEEDS_MANUAL_REVIEW',
]
