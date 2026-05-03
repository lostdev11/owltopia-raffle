import { cn } from '@/lib/utils'
import type { OwlCenterMetadataUploadStatus } from '@/lib/owl-center/asset-types'

const LABELS: Record<OwlCenterMetadataUploadStatus, string> = {
  NOT_UPLOADED: 'NOT_UPLOADED',
  UPLOADING: 'UPLOADING',
  UPLOADED_TO_IPFS: 'IPFS',
  UPLOADED_TO_ARWEAVE: 'ARWEAVE',
  READY_FOR_CANDY_MACHINE: 'CM_READY',
}

export function MetadataUploadStatusBadge({
  status,
  className,
}: {
  status: OwlCenterMetadataUploadStatus
  className?: string
}) {
  const glow =
    status === 'READY_FOR_CANDY_MACHINE'
      ? 'border-[#00FF9C]/50 text-[#00FF9C] shadow-[0_0_18px_rgba(0,255,156,0.22)]'
      : status === 'NOT_UPLOADED'
        ? 'border-[#5C6773]/60 text-[#9BA8B4]'
        : 'border-[#C9A227]/45 text-[#E8D089]'

  return (
    <span
      className={cn(
        'inline-flex min-h-[28px] items-center border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest',
        glow,
        className
      )}
    >
      METADATA · {LABELS[status]}
    </span>
  )
}
