import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import {
  getDiscordRoleClaimsForWallet,
  getGrantedDiscordRoleClaim,
  insertDiscordRoleClaimPending,
  updateDiscordRoleClaimStatus,
  type Gen2DiscordRoleType,
} from '@/lib/db/discord-role-claims'
import { getDiscordUserIdsByWallets, getWalletProfileForDashboard } from '@/lib/db/wallet-profiles'
import { assignDiscordGuildRole, getDiscordRoleIdForGen2RoleType } from '@/lib/discord-guild-roles'
import {
  isValidGen2DiscordRoleType,
  walletQualifiesForGen2DiscordRoleType,
} from '@/lib/gen2-presale/discord-qualification'
import { resolvePrimaryWallet } from '@/lib/wallet-cluster'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * POST /api/discord/claim-role
 * Body: { role_type: "gen2_presale" | "gen2_whitelist" }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rlIp = rateLimit(`discord-claim-role-ip:${ip}`, 20, 60_000)
    const rlWallet = rateLimit(`discord-claim-role-wallet:${session.wallet}`, 10, 60_000)
    if (!rlIp.allowed || !rlWallet.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const sessionWallet = normalizeSolanaWalletAddress(session.wallet)
    if (!sessionWallet) {
      return NextResponse.json({ error: 'Invalid session wallet' }, { status: 401 })
    }

    const wallet = (await resolvePrimaryWallet(sessionWallet)) ?? sessionWallet

    const body = (await request.json().catch(() => ({}))) as { role_type?: string }
    const roleTypeRaw = typeof body.role_type === 'string' ? body.role_type.trim() : ''
    if (!isValidGen2DiscordRoleType(roleTypeRaw)) {
      return NextResponse.json(
        { error: 'role_type must be gen2_presale or gen2_whitelist' },
        { status: 400 }
      )
    }
    const roleType = roleTypeRaw as Gen2DiscordRoleType

    const qualified = await walletQualifiesForGen2DiscordRoleType(wallet, roleType)
    if (!qualified) {
      return NextResponse.json(
        {
          error:
            roleType === 'gen2_presale'
              ? 'No confirmed Gen2 presale purchase on your primary or linked wallets.'
              : 'No Gen2 whitelist entry on your primary or linked wallets.',
          code: 'not_eligible',
        },
        { status: 403 }
      )
    }

    const profile = await getWalletProfileForDashboard(wallet)
    if (!profile.discord.linked) {
      return NextResponse.json(
        { error: 'Connect Discord first, then claim your role.', code: 'discord_not_linked' },
        { status: 400 }
      )
    }

    const discordIds = await getDiscordUserIdsByWallets([wallet])
    const discordId = discordIds[wallet]
    if (!discordId) {
      return NextResponse.json(
        { error: 'Discord account not found for this wallet.', code: 'discord_not_linked' },
        { status: 400 }
      )
    }

    const existing = await getGrantedDiscordRoleClaim(wallet, roleType)
    if (existing) {
      return NextResponse.json(
        {
          error: 'You have already claimed this role.',
          code: 'already_claimed',
          claim: { id: existing.id, status: existing.status, role_type: roleType },
        },
        { status: 409 }
      )
    }

    const roleId = getDiscordRoleIdForGen2RoleType(roleType)
    if (!roleId) {
      return NextResponse.json(
        { error: 'Discord role is not configured on the server.', code: 'not_configured' },
        { status: 503 }
      )
    }

    const pending = await insertDiscordRoleClaimPending({
      walletAddress: wallet,
      discordId,
      roleType,
    })
    if (!pending.ok) {
      const claims = await getDiscordRoleClaimsForWallet(wallet)
      const granted = claims.find((c) => c.role_type === roleType && c.status === 'granted')
      if (granted) {
        return NextResponse.json(
          {
            error: 'You have already claimed this role.',
            code: 'already_claimed',
            claim: { id: granted.id, status: granted.status, role_type: roleType },
          },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: pending.message, code: 'claim_failed' }, { status: 500 })
    }

    console.info('[discord/claim-role] assigning', {
      tag: 'gen2_discord_role_claim',
      wallet,
      session_wallet: sessionWallet,
      discord_id: discordId,
      role_type: roleType,
      claim_id: pending.id,
    })

    const assign = await assignDiscordGuildRole(discordId, roleId)
    if (!assign.ok) {
      await updateDiscordRoleClaimStatus(pending.id, 'failed', assign.message)
      console.warn('[discord/claim-role] assign failed', {
        tag: 'gen2_discord_role_claim',
        wallet,
        discord_id: discordId,
        role_type: roleType,
        claim_id: pending.id,
        code: assign.code,
        message: assign.message,
      })
      return NextResponse.json(
        { error: assign.message, code: assign.code },
        { status: assign.code === 'not_in_guild' ? 400 : 502 }
      )
    }

    await updateDiscordRoleClaimStatus(pending.id, 'granted', null)

    console.info('[discord/claim-role] granted', {
      tag: 'gen2_discord_role_claim',
      wallet,
      discord_id: discordId,
      discord_username: profile.discord.username,
      role_type: roleType,
      claim_id: pending.id,
    })

    return NextResponse.json({
      ok: true,
      claim: {
        id: pending.id,
        status: 'granted',
        role_type: roleType,
        discord_username: profile.discord.username,
      },
    })
  } catch (e) {
    console.error('[discord/claim-role]', e)
    return NextResponse.json({ error: 'Failed to claim Discord role' }, { status: 500 })
  }
}
