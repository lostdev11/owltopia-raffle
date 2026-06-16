import 'server-only'

import { normalizeOwlCenterArweaveGatewayUri } from '@/lib/owl-center/arweave-gateway-uri'
import { uploadBufferToArweaveViaIrys } from '@/lib/owl-center/irys-uploader'
import { buildOwlCenterWalletProxyImageUrl } from '@/lib/owl-center/metadata-json-fix'
import { walletSafeArweaveImageUri } from '@/lib/owl-center/arweave-gateway-uri'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

const REVEAL_PLACEHOLDER_JSON_PATH = 'assets/reveal-placeholder.json'
const REVEAL_PLACEHOLDER_PNG_PATH = 'assets/reveal-placeholder.png'

/** Resolve placeholder metadata URI for reveal_day deploy (from job or auto-upload). */
export async function resolveRevealPlaceholderMetadataUri(params: {
  launch: Pick<OwlCenterLaunchPublic, 'name' | 'mint_mode' | 'mint_network'>
  job: OwlCenterAssetUploadJob
  existingUri?: string | null
}): Promise<string | null> {
  const { launch, job, existingUri } = params
  const network = resolveLaunchMintNetwork(launch)
  const uploaded = job.upload_progress.uploaded ?? {}

  const fromJob = uploaded[REVEAL_PLACEHOLDER_JSON_PATH]?.trim()
  if (fromJob) {
    return normalizeOwlCenterArweaveGatewayUri(fromJob, network)
  }

  if (existingUri?.trim()) {
    return normalizeOwlCenterArweaveGatewayUri(existingUri, network)
  }

  const pngRaw = uploaded[REVEAL_PLACEHOLDER_PNG_PATH]?.trim()
  let primaryImage = ''
  if (pngRaw) {
    const gateway = walletSafeArweaveImageUri(pngRaw, network)
    const gatewayBase = gateway.split('?')[0] ?? gateway
    primaryImage = buildOwlCenterWalletProxyImageUrl(gatewayBase)
  }

  const collectionName = (launch.name ?? 'Collection').trim() || 'Collection'
  const json = {
    name: 'Unrevealed',
    description: `${collectionName} — art reveals on reveal day.`,
    image: primaryImage || undefined,
    attributes: [],
    properties: {
      category: 'image',
      files: primaryImage
        ? [
            { uri: primaryImage, type: 'image/png', cdn: true },
            ...(pngRaw
              ? [{ uri: walletSafeArweaveImageUri(pngRaw, network), type: 'image/png' }]
              : []),
          ]
        : [],
    },
  }

  const { uri } = await uploadBufferToArweaveViaIrys(
    Buffer.from(JSON.stringify(json, null, 2), 'utf8'),
    'application/json'
  )
  return normalizeOwlCenterArweaveGatewayUri(uri, network)
}

export { REVEAL_PLACEHOLDER_JSON_PATH, REVEAL_PLACEHOLDER_PNG_PATH }
