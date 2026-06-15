export type AssetStepValues = {
  logo_url: string
  banner_url: string
  collection_image_url: string
  assets_package_url: string
  metadata_package_url: string
  traits_csv_url: string
  asset_notes: string
  total_images: string
  total_metadata: string
}

export const emptyAssetStepValues = (): AssetStepValues => ({
  logo_url: '',
  banner_url: '',
  collection_image_url: '',
  assets_package_url: '',
  metadata_package_url: '',
  traits_csv_url: '',
  asset_notes: '',
  total_images: '',
  total_metadata: '',
})
