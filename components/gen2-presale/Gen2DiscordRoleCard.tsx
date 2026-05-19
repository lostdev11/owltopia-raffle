'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, MessageCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import { COMMUNITY_DISCORD_INVITE_URL } from '@/lib/site-config'
import { cn } from '@/lib/utils'

type ClaimStatusResponse = {
  discord?: { linked: boolean; username: string | null }
  eligibility?: {
    presale: boolean
    whitelist: boolean
    eligibleRoleTypes: ('gen2_presale' | 'gen2_whitelist')[]
  }
  claims?: {
    gen2_presale: { id: string; status: string } | null
    gen2_whitelist: { id: string; status: string } | null
  }
  error?: string
}

type RoleUi = {
  roleType: 'gen2_presale' | 'gen2_whitelist'
  label: string
  description: string
}

const ROLES: RoleUi[] = [
  {
    roleType: 'gen2_presale',
    label: 'Gen2 presale role',
    description: 'For wallets with at least one confirmed presale purchase.',
  },
  {
    roleType: 'gen2_whitelist',
    label: 'Gen2 whitelist role',
    description: 'For wallets on the official Gen2 whitelist.',
  },
]

function discordOAuthReturnMessage(code: string): string {
  switch (code) {
    case 'discord_linked':
      return 'Discord connected. You can claim your server role below.'
    case 'discord_taken':
      return 'That Discord account is already linked to another wallet.'
    case 'sign_in_required':
      return 'Sign in with your wallet first, then connect Discord.'
    case 'not_configured':
      return 'Discord linking is not configured on this environment.'
    default:
      return 'Could not connect Discord. Try again.'
  }
}

type Props = {
  connected: boolean
  walletAddress: string | null
  className?: string
}

export function Gen2DiscordRoleCard({ connected, walletAddress, className }: Props) {
  const { signIn, signingIn, error: signInError } = useSiwsSignIn()
  const [status, setStatus] = useState<ClaimStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [claiming, setClaiming] = useState<'gen2_presale' | 'gen2_whitelist' | null>(null)
  const [claimMsg, setClaimMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [oauthFlash, setOauthFlash] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    if (!connected || !walletAddress?.trim()) {
      setStatus(null)
      setFetchError(null)
      return
    }
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/discord/claim-role/status', {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => ({}))) as ClaimStatusResponse
      if (!res.ok) {
        if (res.status === 401) {
          setStatus(null)
          setFetchError('Sign in with Owltopia to connect Discord and claim roles.')
          return
        }
        throw new Error(data.error || 'Could not load Discord status')
      }
      setStatus(data)
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Could not load Discord status')
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [connected, walletAddress])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const linked = sp.get('discord_linked')
    const err = sp.get('discord_error')
    if (linked === '1') {
      setOauthFlash(discordOAuthReturnMessage('discord_linked'))
      sp.delete('discord_linked')
      sp.delete('discord_error')
      const qs = sp.toString()
      const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
      window.history.replaceState({}, '', next)
      void refreshStatus()
    } else if (err) {
      setOauthFlash(discordOAuthReturnMessage(err))
      sp.delete('discord_linked')
      sp.delete('discord_error')
      const qs = sp.toString()
      const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
      window.history.replaceState({}, '', next)
    }
  }, [refreshStatus])

  const eligibleTypes = useMemo(
    () => new Set(status?.eligibility?.eligibleRoleTypes ?? []),
    [status?.eligibility?.eligibleRoleTypes]
  )

  const handleClaim = useCallback(
    async (roleType: 'gen2_presale' | 'gen2_whitelist') => {
      setClaimMsg(null)
      setClaiming(roleType)
      try {
        const res = await fetch('/api/discord/claim-role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ role_type: roleType }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          setClaimMsg({ type: 'err', text: data.error || 'Could not claim role' })
          return
        }
        setClaimMsg({
          type: 'ok',
          text:
            roleType === 'gen2_presale'
              ? 'Presale Discord role granted. Check the Owltopia server.'
              : 'Whitelist Discord role granted. Check the Owltopia server.',
        })
        await refreshStatus()
      } catch {
        setClaimMsg({ type: 'err', text: 'Network error. Try again.' })
      } finally {
        setClaiming(null)
      }
    },
    [refreshStatus]
  )

  const discordLinked = status?.discord?.linked === true
  const hasAnyEligibility = eligibleTypes.size > 0
  const needsSignIn = !!fetchError
  const connectHref = '/api/me/discord/link?return_to=/gen2-presale'

  return (
    <div
      id="gen2-discord-role"
      className={cn(
        'scroll-mt-28 rounded-2xl border border-[#00E58B]/25 bg-[#151D24]/95 p-6 shadow-[inset_0_0_40px_rgba(0,229,139,0.06)]',
        className
      )}
    >
      <DiscordRoleCardHeader />
      <p className="mt-2 text-sm leading-relaxed text-[#A9CBB9]">
        Connect Discord, join the Owltopia server, then claim your presale or whitelist role if you qualify.
      </p>

      {oauthFlash ? (
        <p
          className="mt-3 rounded-lg border border-[#00FF9C]/30 bg-[#00E58B]/10 px-3 py-2 text-sm text-[#EAFBF4]"
          role="status"
        >
          {oauthFlash}
        </p>
      ) : null}

      {fetchError ? (
        <p
          className="mt-3 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-100"
          role="alert"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {fetchError}
        </p>
      ) : null}

      {signInError ? (
        <p className="mt-3 text-sm text-red-300" role="alert">
          {signInError}
        </p>
      ) : null}

      {!connected ? (
        <p className="mt-4 text-sm text-[#A9CBB9]">Connect your wallet to check eligibility and claim roles.</p>
      ) : loading && !status ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-[#A9CBB9]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Discord status…
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <DiscordLinkStatus linked={discordLinked} username={status?.discord?.username ?? null} />
            <div className="flex flex-col sm:flex-row gap-2 shrink-0">
              {needsSignIn && !discordLinked ? (
                <Button
                  type="button"
                  variant="outline"
                  className="touch-manipulation min-h-[44px] w-full sm:w-auto border-[#1F6F54] text-[#EAFBF4]"
                  disabled={signingIn}
                  onClick={() => void signIn().then(() => refreshStatus())}
                >
                  {signingIn ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Signing in…
                    </>
                  ) : (
                    'Sign in with Owltopia'
                  )}
                </Button>
              ) : null}
              {!discordLinked ? (
                <Button
                  asChild
                  className="touch-manipulation min-h-[44px] w-full sm:w-auto bg-[#00E58B]/25 hover:bg-[#00E58B]/40 text-[#EAFBF4] border border-[#00FF9C]/35"
                >
                  <a href={connectHref}>Connect Discord</a>
                </Button>
              ) : null}
            </div>
          </div>

          <p className="text-xs text-[#A9CBB9]">
            Not in the server yet?{' '}
            <a
              href={COMMUNITY_DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#00FF9C] underline underline-offset-2 touch-manipulation"
            >
              Join Owltopia on Discord
            </a>{' '}
            first, then claim.
          </p>

          {!hasAnyEligibility ? (
            <p className="text-sm text-[#A9CBB9]">
              No qualifying presale purchase or whitelist entry for this wallet yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {ROLES.map((role) => (
                <RoleClaimRow
                  key={role.roleType}
                  role={role}
                  eligible={eligibleTypes.has(role.roleType)}
                  granted={status?.claims?.[role.roleType]?.status === 'granted'}
                  discordLinked={discordLinked}
                  claiming={claiming === role.roleType}
                  onClaim={() => void handleClaim(role.roleType)}
                />
              ))}
            </ul>
          )}

          {claimMsg ? (
            <p
              className={cn(
                'flex gap-2 rounded-lg px-3 py-2 text-sm',
                claimMsg.type === 'ok'
                  ? 'border border-[#00FF9C]/35 bg-[#00E58B]/15 text-[#EAFBF4]'
                  : 'border border-red-500/40 bg-red-950/40 text-red-100'
              )}
              role="status"
            >
              {claimMsg.type === 'ok' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#00FF9C]" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              {claimMsg.text}
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}

function DiscordRoleCardHeader() {
  return (
    <div className="flex items-center gap-2">
      <MessageCircle className="h-5 w-5 text-[#00FF9C]" aria-hidden />
      <h2 className="font-display text-xl text-[#EAFBF4]">Discord server role</h2>
    </div>
  )
}

function DiscordLinkStatus({ linked, username }: { linked: boolean; username: string | null }) {
  return (
    <div className="text-sm text-[#A9CBB9] min-h-[44px] flex flex-col justify-center">
      {linked ? (
        <>
          <span className="font-medium text-[#EAFBF4]">Discord connected</span>
          {username ? <span className="text-xs mt-0.5">{username}</span> : null}
        </>
      ) : (
        <span>Discord not connected</span>
      )}
    </div>
  )
}

function RoleClaimRow({
  role,
  eligible,
  granted,
  discordLinked,
  claiming,
  onClaim,
}: {
  role: RoleUi
  eligible: boolean
  granted: boolean
  discordLinked: boolean
  claiming: boolean
  onClaim: () => void
}) {
  if (!eligible && !granted) return null

  return (
    <li className="rounded-xl border border-[#1F6F54]/60 bg-[#10161C]/80 px-4 py-3">
      <p className="font-semibold text-[#EAFBF4]">{role.label}</p>
      <p className="mt-1 text-xs text-[#A9CBB9]">{role.description}</p>
      {granted ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-[#00FF9C]">
          <CheckCircle2 className="h-4 w-4" />
          Role claimed
        </p>
      ) : (
        <Button
          type="button"
          className="mt-3 touch-manipulation min-h-[44px] w-full sm:w-auto bg-[#00E58B]/25 hover:bg-[#00E58B]/40 text-[#EAFBF4] border border-[#00FF9C]/35"
          disabled={!discordLinked || claiming}
          onClick={onClaim}
        >
          {claiming ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Claiming…
            </>
          ) : (
            'Claim Discord role'
          )}
        </Button>
      )}
    </li>
  )
}
