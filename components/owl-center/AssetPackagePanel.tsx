import type { OwlCenterAssetPackage } from '@/lib/owl-center/asset-types'
import { MetadataUploadStatusBadge } from '@/components/owl-center/MetadataUploadStatusBadge'
import { cn } from '@/lib/utils'

export function AssetPackagePanel({
  pkg,
  validationLabel,
  className,
}: {
  pkg: OwlCenterAssetPackage | null
  validationLabel?: string
  className?: string
}) {
  if (!pkg) {
    return (
      <p className={cn('font-mono text-sm text-[#5C6773]', className)}>
        No asset package row — save package fields to create one.
      </p>
    )
  }

  return (
    <div className={cn('grid gap-4 font-mono text-xs text-[#9BA8B4] md:grid-cols-2', className)}>
      <div className="space-y-2 border border-[#1A222B] bg-[#0F1419]/80 p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#00C97A]">ASSET STATUS</p>
        <p>
          <span className="text-[#5C6773]">validation</span>{' '}
          <span className="text-[#F4FBF8]">{validationLabel ?? pkg.validation_status}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <MetadataUploadStatusBadge status={pkg.metadata_upload_status} />
        </div>
      </div>
      <div className="space-y-2 border border-[#1A222B] bg-[#0F1419]/80 p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#00C97A]">COUNTS</p>
        <p>
          images <span className="text-[#00FF9C]">{pkg.total_images}</span> · metadata{' '}
          <span className="text-[#00FF9C]">{pkg.total_metadata}</span> · expected supply{' '}
          <span className="text-[#00FF9C]">{pkg.expected_supply}</span>
        </p>
        <p className="text-[10px] text-[#5C6773]">storage_provider={pkg.storage_provider}</p>
      </div>
      <div className="md:col-span-2 space-y-2 border border-[#1A222B] bg-[#0F1419]/80 p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#00C97A]">PATHS / URLS</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          <li>logo: {pkg.logo_url ?? '—'}</li>
          <li>banner: {pkg.banner_url ?? '—'}</li>
          <li className="sm:col-span-2">collection image: {pkg.collection_image_url ?? '—'}</li>
          <li className="sm:col-span-2">assets package: {pkg.assets_storage_path ?? '—'}</li>
          <li className="sm:col-span-2">metadata package: {pkg.metadata_storage_path ?? '—'}</li>
          <li className="sm:col-span-2">traits CSV: {pkg.traits_csv_url ?? '—'}</li>
        </ul>
      </div>
    </div>
  )
}
