import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { collectMintedNftMintsForLaunch } from '@/lib/owl-center/hash-list'
import { formatHashListJson, formatHashListText, suggestMagicEdenCollectionUrl, suggestTensorCollectionUrl } from '@/lib/owl-center/marketplace-urls'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { resolveLaunchMintNetwork, getLaunchCollectionMint } from '@/lib/solana/launch-cm'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** Generate hash list + suggested ME/Tensor URLs from recorded mint events. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid collection id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const mints = await collectMintedNftMintsForLaunch(id)
  const network = resolveLaunchMintNetwork(launch)
  const collectionMint = getLaunchCollectionMint(launch, network) || launch.collection_mint || ''

  return NextResponse.json({
    launch_id: id,
    slug: launch.slug,
    mint_count: mints.length,
    mints,
    hash_list_text: formatHashListText(mints),
    hash_list_json: formatHashListJson(mints),
    suggested_magic_eden_url: collectionMint ? suggestMagicEdenCollectionUrl(collectionMint, network) : null,
    suggested_tensor_url: collectionMint ? suggestTensorCollectionUrl(collectionMint) : null,
    collection_mint: collectionMint || null,
    mint_network: network,
    me_submit_hint:
      'Upload hash_list_text to Magic Eden creator hub → Collection → Submit hash list. Then paste collection URL below and mark LISTED.',
    tensor_submit_hint:
      'Submit collection_mint on Tensor creator tools for verification. Then paste trade URL and mark LISTED.',
  })
}
