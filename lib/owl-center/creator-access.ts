import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { isOwlVisionAdmin } from '@/lib/admin/access'
import { getSessionFromRequest, requireSession } from '@/lib/auth-server'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export type LaunchEditorSession = {
  wallet: string
  isAdmin: boolean
  isCreator: boolean
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** Whether this wallet may edit mint-details for the launch (creator or Owl Vision admin). */
export async function canEditLaunchMintDetails(
  wallet: string,
  launch: Pick<OwlCenterLaunchPublic, 'creator_wallet'>
): Promise<{ ok: boolean; isAdmin: boolean; isCreator: boolean }> {
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized) return { ok: false, isAdmin: false, isCreator: false }

  const isAdmin = await isOwlVisionAdmin(normalized)
  const creator = launch.creator_wallet ? normalizeSolanaWalletAddress(launch.creator_wallet) : null
  const isCreator = !!(creator && walletsEqualSolana(creator, normalized))

  return { ok: isAdmin || isCreator, isAdmin, isCreator }
}

/** SIWS session that matches launch creator_wallet, or an Owl Vision admin. */
export async function requireLaunchMintEditorSession(
  request: NextRequest,
  launch: Pick<OwlCenterLaunchPublic, 'creator_wallet'>
): Promise<LaunchEditorSession | NextResponse> {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session

  const access = await canEditLaunchMintDetails(session.wallet, launch)
  if (!access.ok) {
    return jsonError(
      'This wallet is not the collection creator. Connect and sign in with the creator wallet used at submission.',
      403
    )
  }

  const wallet = normalizeSolanaWalletAddress(session.wallet)
  if (!wallet) return jsonError('Invalid session wallet', 401)

  return { wallet, isAdmin: access.isAdmin, isCreator: access.isCreator }
}

/** Optional session for list pages — null when unsigned in. */
export function getOptionalSessionWallet(request: NextRequest): string | null {
  const session = getSessionFromRequest(request)
  if (!session?.wallet) return null
  return normalizeSolanaWalletAddress(session.wallet)
}
