import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import { isAdmin } from '@/lib/db/admins'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

function parseAdminWalletsFromEnv(): string[] {
  const raw = process.env.ADMIN_WALLETS?.trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => normalizeSolanaWalletAddress(s.trim()))
    .filter((x): x is string => !!x)
}

/** Full admin (DB) or comma-separated `ADMIN_WALLETS` env (base58). */
export async function isGen2PresaleAdmin(wallet: string): Promise<boolean> {
  if (await isAdmin(wallet)) return true
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return false
  const envList = parseAdminWalletsFromEnv()
  return envList.some((a) => a === w)
}

export async function requireGen2PresaleAdminSession(
  request: NextRequest
): Promise<{ wallet: string } | NextResponse> {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session
  const ok = await isGen2PresaleAdmin(session.wallet)
  if (!ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return session
}
