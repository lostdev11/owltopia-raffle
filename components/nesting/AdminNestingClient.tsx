'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, ChevronDown, Globe, Loader2, PauseCircle, Plus, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type {
  StakingPoolRow,
  StakingAssetType,
  RewardRateUnit,
  NestingAdapterMode,
  LockEnforcementSource,
  NftLockStandard,
} from '@/lib/db/staking-pools'
import { getCachedAdmin, setCachedAdmin, type AdminRole } from '@/lib/admin-check-cache'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'
import { StakingPoolCard } from '@/components/nesting/StakingPoolCard'
import { AdminGenOwlNestRosterSection } from '@/components/nesting/AdminGenOwlNestRosterSection'
import { SectionHeader } from '@/components/council/SectionHeader'
import { PoolOnChainSettingsForm } from '@/components/nesting/PoolOnChainSettingsForm'
import { NESTING_RECONCILE_MAX_BATCH } from '@/lib/nesting/rpc-policy'
import {
  buildQuickNftPoolDescription,
  isProbableSolanaPubkey,
  suggestedNftPoolSlug,
} from '@/lib/nesting/admin-quick-pool'

const emptyForm = () => ({
  name: '',
  slug: '',
  description: '',
  asset_type: 'token' as StakingAssetType,
  token_mint: '',
  collection_key: '',
  reward_token: '',
  reward_rate: '0',
  reward_rate_unit: 'daily' as RewardRateUnit,
  lock_period_days: '0',
  minimum_stake: '',
  maximum_stake: '',
  platform_fee_bps: '0',
  display_order: '0',
  is_active: true,
  partner_project_slug: '',
  nft_lock_standard: 'auto' as NftLockStandard,
  adapter_mode: 'mock' as NestingAdapterMode,
  lock_enforcement_source: 'database' as LockEnforcementSource,
  is_onchain_enabled: false,
  requires_onchain_sync: false,
})

export function AdminNestingClient() {
  const { publicKey, connected, signMessage } = useWallet()
  const visibilityTick = useVisibilityTick()
  const wallet = publicKey?.toBase58() ?? ''

  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdmin(wallet) : null
  )
  const [loadingAdmin, setLoadingAdmin] = useState(true)
  const [sessionReady, setSessionReady] = useState<boolean | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)

  const [pools, setPools] = useState<StakingPoolRow[]>([])
  const [loadingPools, setLoadingPools] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState(emptyForm)
  const [quickName, setQuickName] = useState('')
  const [quickCollection, setQuickCollection] = useState('')
  const [quickLocked, setQuickLocked] = useState(true)
  const [quickMaxLockDays, setQuickMaxLockDays] = useState('365')
  const [quickMinLockDays, setQuickMinLockDays] = useState('30')
  const [quickPartnerSlug, setQuickPartnerSlug] = useState('')
  const [quickLockStandard, setQuickLockStandard] = useState<NftLockStandard>('auto')
  const [savingPoolId, setSavingPoolId] = useState<string | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null)
  const [claimAuditWallet, setClaimAuditWallet] = useState('')
  const [claimAuditing, setClaimAuditing] = useState(false)
  const [claimAuditReport, setClaimAuditReport] = useState<{
    generated_at: string
    wallets: Array<{
      wallet_address: string
      estimated_claimable_owl: number
      onchain_claim_owl_24h: number
      onchain_claim_tx_count_24h: number
      risk_flags: string[]
      risk_summary: string
    }>
  } | null>(null)
  const [claimCatchupMsg, setClaimCatchupMsg] = useState<string | null>(null)
  const [claimCatchupRunning, setClaimCatchupRunning] = useState(false)

  const [forceUnstakePositionId, setForceUnstakePositionId] = useState('')
  const [forceUnstaking, setForceUnstaking] = useState(false)
  const [forceUnstakeMsg, setForceUnstakeMsg] = useState<string | null>(null)

  const [supportWallet, setSupportWallet] = useState('')
  const [walletDiagRunning, setWalletDiagRunning] = useState(false)
  const [walletHealRunning, setWalletHealRunning] = useState(false)
  const [ghostClearRunning, setGhostClearRunning] = useState(false)
  const [walletDiagReport, setWalletDiagReport] = useState<{
    wallet: string
    wallet_nest_mint_count: number
    positions_under_wallet: { active: number; pending: number; unstaked: number; ghost_active?: number }
    cross_wallet_rows: Array<{
      position_id: string
      prior_wallet: string
      asset_identifier: string
      status: string
    }>
    issues: Array<{
      kind: string
      severity: string
      message: string
      suggested_action: string
      other_wallet?: string
    }>
    summary?: {
      issue_count: number
      high_severity_count: number
      ghost_active_count?: number
      recommended_heal?: {
        clear_pending: boolean
        clear_active: boolean
        clear_cross_wallet: boolean
      }
    }
  } | null>(null)
  const [walletSupportMsg, setWalletSupportMsg] = useState<string | null>(null)

  const [supportPlaybook, setSupportPlaybook] = useState<{
    wallet: string
    generated_at: string
    claim_audit: {
      estimated_claimable_owl: number
      active_nest_count: number
      onchain_claim_owl_24h: number
      onchain_claim_tx_count_24h: number
      risk_flags: string[]
      risk_summary: string
    } | null
    nest_diagnostics: {
      wallet_nest_mint_count: number
      positions_under_wallet: { active: number; pending: number; unstaked: number; ghost_active?: number }
      cross_wallet_rows: unknown[]
    }
    warnings: Array<{ severity: string; code: string; title: string; detail: string }>
    recommendations: Array<{ action: string; detail: string }>
    guards: {
      block_apply_catch_up: boolean
      block_apply_catch_up_reason: string | null
      block_wallet_heal: boolean
      block_wallet_heal_reason: string | null
      wallet_heal_recommended: boolean
      catch_up_recommended: boolean
    }
  } | null>(null)
  const [supportPlaybookRunning, setSupportPlaybookRunning] = useState(false)
  const [supportPlaybookMsg, setSupportPlaybookMsg] = useState<string | null>(null)
  const [overrideCatchUpBlock, setOverrideCatchUpBlock] = useState(false)
  const [overrideWalletHealBlock, setOverrideWalletHealBlock] = useState(false)

  const [landingPublic, setLandingPublic] = useState(false)
  const [landingPublicLoading, setLandingPublicLoading] = useState(false)
  const [landingPublicSaving, setLandingPublicSaving] = useState(false)
  const [landingPublicUpdatedAt, setLandingPublicUpdatedAt] = useState<string | null>(null)
  const [landingPublicUpdatedBy, setLandingPublicUpdatedBy] = useState<string | null>(null)

  const [nestingOpsPaused, setNestingOpsPaused] = useState(false)
  const [nestingOpsSaving, setNestingOpsSaving] = useState(false)
  const [nestingEnvKillSwitch, setNestingEnvKillSwitch] = useState(false)

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setLoadingAdmin(false)
      return
    }
    const addr = publicKey.toBase58()
    if (getCachedAdmin(addr) === true) {
      setIsAdmin(true)
      setLoadingAdmin(false)
      return
    }
    let cancelled = false
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role = admin && data?.role ? data.role : null
        setCachedAdmin(addr, admin, role as AdminRole | undefined)
        setIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
      .finally(() => {
        if (!cancelled) setLoadingAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, visibilityTick])

  useEffect(() => {
    if (!connected || !publicKey || !isAdmin) {
      setSessionReady(null)
      return
    }
    let cancelled = false
    fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' })
      .then((res) => {
        if (!cancelled) setSessionReady(res.ok)
      })
      .catch(() => {
        if (!cancelled) setSessionReady(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, isAdmin, visibilityTick])

  const fetchPools = useCallback(async () => {
    setLoadingPools(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/staking/pools', { credentials: 'include', cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Failed to load pools')
        return
      }
      setPools(Array.isArray(json.pools) ? json.pools : [])
    } finally {
      setLoadingPools(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin && sessionReady) void fetchPools()
  }, [isAdmin, sessionReady, fetchPools])

  useEffect(() => {
    if (!sessionReady || !isAdmin) return
    let cancelled = false
    setLandingPublicLoading(true)
    fetch('/api/admin/nesting/public-landing', { credentials: 'include', cache: 'no-store' })
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((json) => {
        if (cancelled || !json) return
        setLandingPublic(Boolean(json.landing_public))
        setLandingPublicUpdatedAt(typeof json.updated_at === 'string' ? json.updated_at : null)
        setLandingPublicUpdatedBy(
          typeof json.updated_by_wallet === 'string' ? json.updated_by_wallet : null
        )
        setNestingOpsPaused(Boolean(json.nesting_operations_paused))
        setNestingEnvKillSwitch(Boolean(json.nesting_env_kill_switch))
      })
      .catch(() => {
        if (!cancelled) {
          setLandingPublic(false)
          setLandingPublicUpdatedAt(null)
          setLandingPublicUpdatedBy(null)
          setNestingOpsPaused(false)
          setNestingEnvKillSwitch(false)
        }
      })
      .finally(() => {
        if (!cancelled) setLandingPublicLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionReady, isAdmin, visibilityTick])

  const patchLandingPublic = useCallback(async (next: boolean) => {
    setLandingPublicSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/nesting/public-landing', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ landing_public: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Could not update public landing')
        return
      }
      setLandingPublic(Boolean(json.landing_public))
      setLandingPublicUpdatedAt(typeof json.updated_at === 'string' ? json.updated_at : null)
      setLandingPublicUpdatedBy(
        typeof json.updated_by_wallet === 'string' ? json.updated_by_wallet : null
      )
      setNestingOpsPaused(Boolean(json.nesting_operations_paused))
      setNestingEnvKillSwitch(Boolean(json.nesting_env_kill_switch))
    } finally {
      setLandingPublicSaving(false)
    }
  }, [])

  const patchNestingOpsPaused = useCallback(async (nextPaused: boolean) => {
    setNestingOpsSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/nesting/public-landing', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nesting_operations_paused: nextPaused }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Could not update nesting pause')
        return
      }
      setNestingOpsPaused(Boolean(json.nesting_operations_paused))
      setNestingEnvKillSwitch(Boolean(json.nesting_env_kill_switch))
      setLandingPublic(Boolean(json.landing_public))
      setLandingPublicUpdatedAt(typeof json.updated_at === 'string' ? json.updated_at : null)
      setLandingPublicUpdatedBy(
        typeof json.updated_by_wallet === 'string' ? json.updated_by_wallet : null
      )
    } finally {
      setNestingOpsSaving(false)
    }
  }, [])

  const handleSignIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setSignInError('Your wallet does not support message signing.')
      return
    }
    setSignInError(null)
    setSigningIn(true)
    try {
      const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(publicKey.toBase58())}`, {
        credentials: 'include',
      })
      if (!nonceRes.ok) {
        const data = await nonceRes.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to get nonce')
      }
      const { message } = await nonceRes.json()
      const messageBytes = new TextEncoder().encode(message)
      const signature = await signMessage(messageBytes)
      const signatureBase64 =
        typeof signature === 'string'
          ? btoa(signature)
          : btoa(String.fromCharCode(...new Uint8Array(signature)))
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          message,
          signature: signatureBase64,
        }),
      })
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error(data?.error || 'Verification failed')
      }
      setSessionReady(true)
      await fetchPools()
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }, [publicKey, signMessage, fetchPools])

  const createQuickPool = async () => {
    const name = quickName.trim()
    const coll = quickCollection.trim()
    setSaveError(null)
    if (!name || !coll) {
      setSaveError('Enter a pool name and collection address.')
      return
    }
    if (!isProbableSolanaPubkey(coll)) {
      setSaveError('Collection address does not look like a Solana public key.')
      return
    }
    let maxLock = 365
    let minLock = 30
    if (quickLocked) {
      maxLock = Number(quickMaxLockDays)
      minLock = Number(quickMinLockDays)
      if (!Number.isFinite(maxLock) || !Number.isFinite(minLock)) {
        setSaveError('Lock days must be valid numbers.')
        return
      }
      if (!Number.isInteger(maxLock) || !Number.isInteger(minLock) || maxLock < 1 || minLock < 1) {
        setSaveError('Lock days must be whole numbers of at least 1.')
        return
      }
      if (minLock > maxLock) {
        setSaveError('Minimum lock days cannot be greater than maximum lock days.')
        return
      }
    }

    const slug = suggestedNftPoolSlug(name, coll)
    const description = buildQuickNftPoolDescription({
      poolName: name,
      collectionMint: coll,
      locked: quickLocked,
      minLockDays: quickLocked ? minLock : 0,
      maxLockDays: quickLocked ? maxLock : 0,
    })

    setSaving(true)
    try {
      const onchain =
        quickLockStandard !== 'database_only' &&
        (quickLockStandard === 'auto' ||
          quickLockStandard === 'mpl_core_freeze_delegate' ||
          quickLockStandard === 'spl_token_account_freeze')
      const res = await fetch('/api/admin/staking/pools', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug,
          description,
          asset_type: 'nft',
          token_mint: null,
          collection_key: coll,
          reward_token: 'OWL',
          reward_rate: 1,
          reward_rate_unit: 'daily',
          lock_period_days: quickLocked ? maxLock : 0,
          minimum_stake: null,
          maximum_stake: null,
          platform_fee_bps: 0,
          display_order: 0,
          is_active: true,
          partner_project_slug: quickPartnerSlug.trim() || null,
          nft_lock_standard: quickLockStandard,
          adapter_mode: onchain ? 'onchain_enabled' : 'mock',
          lock_enforcement_source: onchain ? 'hybrid' : 'database',
          is_onchain_enabled: onchain,
          requires_onchain_sync: false,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Save failed')
        return
      }
      setQuickName('')
      setQuickCollection('')
      setQuickLocked(true)
      setQuickMaxLockDays('365')
      setQuickMinLockDays('30')
      setQuickPartnerSlug('')
      setQuickLockStandard('auto')
      await fetchPools()
    } finally {
      setSaving(false)
    }
  }

  const createPool = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/staking/pools', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          description: form.description,
          asset_type: form.asset_type,
          token_mint: form.token_mint || null,
          collection_key: form.collection_key || null,
          reward_token: form.reward_token || null,
          reward_rate: Number(form.reward_rate),
          reward_rate_unit: form.reward_rate_unit,
          lock_period_days: Number(form.lock_period_days),
          minimum_stake: form.minimum_stake === '' ? null : Number(form.minimum_stake),
          maximum_stake: form.maximum_stake === '' ? null : Number(form.maximum_stake),
          platform_fee_bps: Number(form.platform_fee_bps),
          display_order: Number(form.display_order),
          is_active: form.is_active,
          partner_project_slug: form.partner_project_slug || null,
          nft_lock_standard: form.nft_lock_standard,
          adapter_mode: form.adapter_mode,
          lock_enforcement_source: form.lock_enforcement_source,
          is_onchain_enabled: form.is_onchain_enabled,
          requires_onchain_sync: form.requires_onchain_sync,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Save failed')
        return
      }
      setForm(emptyForm())
      await fetchPools()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (pool: StakingPoolRow, next: boolean) => {
    setSaveError(null)
    const res = await fetch(`/api/admin/staking/pools/${pool.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setSaveError(typeof json?.error === 'string' ? json.error : 'Update failed')
      return
    }
    await fetchPools()
  }

  const toggleAdminPreview = async (pool: StakingPoolRow, next: boolean) => {
    setSaveError(null)
    const res = await fetch(`/api/admin/staking/pools/${pool.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_only: next }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setSaveError(typeof json?.error === 'string' ? json.error : 'Update failed')
      return
    }
    await fetchPools()
  }

  const runReconcile = async () => {
    setReconciling(true)
    setReconcileMsg(null)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/staking/reconcile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: NESTING_RECONCILE_MAX_BATCH }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Reconcile failed')
        return
      }
      const n = typeof json?.processed === 'number' ? json.processed : 0
      setReconcileMsg(`Processed ${n} position(s). Max ${json?.max_batch ?? NESTING_RECONCILE_MAX_BATCH} per call — no polling.`)
      await fetchPools()
    } finally {
      setReconciling(false)
    }
  }

  const runClaimLedgerAudit = async () => {
    setClaimAuditing(true)
    setClaimCatchupMsg(null)
    setSaveError(null)
    try {
      const q = new URLSearchParams()
      const w = claimAuditWallet.trim()
      if (w) {
        q.set('wallet', w)
        q.set('flagged_only', 'false')
      }
      const res = await fetch(`/api/admin/staking/claim-ledger-audit?${q.toString()}`, {
        credentials: 'include',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Claim ledger audit failed')
        return
      }
      setClaimAuditReport(json as typeof claimAuditReport)
    } finally {
      setClaimAuditing(false)
    }
  }

  const runSupportPlaybook = async () => {
    const wallet = supportWallet.trim()
    setSupportPlaybook(null)
    setWalletDiagReport(null)
    setClaimAuditReport(null)
    setWalletSupportMsg(null)
    setClaimCatchupMsg(null)
    setSupportPlaybookMsg(null)
    setSaveError(null)
    setOverrideCatchUpBlock(false)
    setOverrideWalletHealBlock(false)
    if (!wallet) {
      setSupportPlaybookMsg('Enter the holder wallet address.')
      return
    }
    if (!isProbableSolanaPubkey(wallet)) {
      setSupportPlaybookMsg('Wallet address does not look like a valid Solana public key.')
      return
    }
    setClaimAuditWallet(wallet)
    setSupportPlaybookRunning(true)
    setSupportPlaybookMsg('Running claim audit and nest diagnostics (large wallets may take 30–60s)…')
    try {
      const res = await fetch(
        `/api/admin/staking/support-playbook?wallet=${encodeURIComponent(wallet)}`,
        { credentials: 'include' }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const err =
          typeof json?.error === 'string'
            ? json.error
            : res.status === 504
              ? 'Support playbook timed out. Try again, or run wallet diagnostics and claim audit separately below.'
              : 'Support playbook failed'
        setSupportPlaybookMsg(err)
        setSaveError(err)
        return
      }
      setSupportPlaybook(json as typeof supportPlaybook)
      if (json.nest_diagnostics) {
        setWalletDiagReport(json.nest_diagnostics as typeof walletDiagReport)
      }
      if (json.claim_audit) {
        setClaimAuditReport({
          generated_at: json.generated_at ?? new Date().toISOString(),
          wallets: [json.claim_audit],
        })
      }
      const warningCount = Array.isArray(json.warnings) ? json.warnings.length : 0
      const activeNests = json.claim_audit?.active_nest_count ?? json.nest_diagnostics?.positions_under_wallet?.active
      setSupportPlaybookMsg(
        `Playbook complete${typeof activeNests === 'number' ? ` · ${activeNests} active nest(s)` : ''}${
          warningCount > 0 ? ` · ${warningCount} warning(s)` : ''
        }.`
      )
    } catch {
      const err = 'Support playbook failed — check your connection and try again.'
      setSupportPlaybookMsg(err)
      setSaveError(err)
    } finally {
      setSupportPlaybookRunning(false)
    }
  }

  const runClaimLedgerCatchup = async (dryRun: boolean) => {
    const wallet = claimAuditWallet.trim()
    if (!wallet) {
      setSaveError('Enter holder wallet for catch-up.')
      return
    }
    if (
      supportPlaybook?.guards.block_apply_catch_up &&
      !overrideCatchUpBlock &&
      supportPlaybook.wallet === wallet
    ) {
      setSaveError(
        supportPlaybook.guards.block_apply_catch_up_reason ??
          'Catch-up is blocked for this wallet. Run support playbook or enable override only if they were already paid on-chain.'
      )
      return
    }
    setClaimCatchupRunning(true)
    setClaimCatchupMsg(null)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/staking/claim-ledger-catchup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, dry_run: dryRun }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Catch-up failed')
        return
      }
      const updated = typeof json?.positions_updated === 'number' ? json.positions_updated : 0
      const zeroed =
        typeof json?.total_claimable_zeroed_owl === 'number' ? json.total_claimable_zeroed_owl : 0
      setClaimCatchupMsg(
        dryRun
          ? `Dry run: would update ${updated} nest(s), zero ~${zeroed.toFixed(6)} OWL of claimable UI.`
          : `Updated ${updated} nest(s); zeroed ~${zeroed.toFixed(6)} OWL claimable in UI.`
      )
      if (!dryRun) await runClaimLedgerAudit()
    } finally {
      setClaimCatchupRunning(false)
    }
  }

  const runWalletNestDiagnostics = async () => {
    const wallet = supportWallet.trim()
    setWalletSupportMsg(null)
    setSaveError(null)
    setWalletDiagReport(null)
    if (!wallet) {
      setSaveError('Enter the holder wallet address.')
      return
    }
    setWalletDiagRunning(true)
    try {
      const res = await fetch(
        `/api/admin/staking/wallet-diagnostics?wallet=${encodeURIComponent(wallet)}`,
        { credentials: 'include' }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Diagnostics failed')
        return
      }
      setWalletDiagReport(json as typeof walletDiagReport)
    } finally {
      setWalletDiagRunning(false)
    }
  }

  const runClearGhostActives = async () => {
    const wallet = supportWallet.trim()
    setWalletSupportMsg(null)
    setSaveError(null)
    if (!wallet) {
      setSaveError('Enter the holder wallet address.')
      return
    }
    setGhostClearRunning(true)
    try {
      const res = await fetch('/api/admin/staking/clear-ghost-active', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Clear ghost actives failed')
        return
      }
      const cleared = typeof json?.cleared_count === 'number' ? json.cleared_count : 0
      setWalletSupportMsg(
        cleared > 0
          ? `Cleared ${cleared} ghost active row(s) for ${wallet}. Real nests and claimable OWL are unchanged — user should refresh nesting.`
          : `No ghost active rows found for ${wallet}.`
      )
      if (json.diagnostics_after) {
        setWalletDiagReport(json.diagnostics_after as typeof walletDiagReport)
      } else {
        await runWalletNestDiagnostics()
      }
    } finally {
      setGhostClearRunning(false)
    }
  }

  const runWalletNestHeal = async () => {
    const wallet = supportWallet.trim()
    setWalletSupportMsg(null)
    setSaveError(null)
    if (!wallet) {
      setSaveError('Enter the holder wallet address.')
      return
    }
    if (
      supportPlaybook?.guards.block_wallet_heal &&
      !overrideWalletHealBlock &&
      supportPlaybook.wallet === wallet
    ) {
      setSaveError(
        supportPlaybook.guards.block_wallet_heal_reason ??
          'Wallet heal is blocked for this wallet. Run support playbook first.'
      )
      return
    }
    setWalletHealRunning(true)
    try {
      const res = await fetch('/api/admin/staking/heal-wallet', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, full: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Heal failed')
        return
      }
      const pending = typeof json?.cleared_pending_count === 'number' ? json.cleared_pending_count : 0
      const active = typeof json?.cleared_active_count === 'number' ? json.cleared_active_count : 0
      const cross = typeof json?.cleared_cross_wallet_count === 'number' ? json.cleared_cross_wallet_count : 0
      const remaining =
        typeof json?.summary?.remaining_high_severity === 'number'
          ? json.summary.remaining_high_severity
          : null
      setWalletSupportMsg(
        `Healed ${wallet}: ${pending} pending, ${active} active orphan, ${cross} cross-wallet row(s) cleared.${
          remaining != null ? ` ${remaining} high-severity issue(s) remain — re-run diagnostics.` : ''
        } User should refresh nesting and re-open nests with wallet lock.`
      )
      if (json.diagnostics_after) {
        setWalletDiagReport(json.diagnostics_after as typeof walletDiagReport)
      }
    } finally {
      setWalletHealRunning(false)
    }
  }

  const ghostActiveCount =
    walletDiagReport?.positions_under_wallet.ghost_active ??
    supportPlaybook?.nest_diagnostics.positions_under_wallet.ghost_active ??
    0

  const runForceUnstake = async () => {
    const id = forceUnstakePositionId.trim()
    setForceUnstakeMsg(null)
    setSaveError(null)
    if (!id) {
      setSaveError('Paste a staking position id (UUID from Supabase or support ticket).')
      return
    }
    setForceUnstaking(true)
    try {
      const res = await fetch('/api/admin/staking/unstake-override', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_id: id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof json?.error === 'string' ? json.error : 'Force unstake failed')
        return
      }
      const holder =
        typeof json?.holder_wallet === 'string' ? json.holder_wallet : (json?.position?.wallet_address as string) ?? ''
      setForceUnstakeMsg(
        holder
          ? `Closed nest for holder ${holder}. Position status is now unstaked.`
          : 'Nest closed successfully.'
      )
      setForceUnstakePositionId('')
    } finally {
      setForceUnstaking(false)
    }
  }

  if (!connected || !publicKey) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <p className="text-muted-foreground mb-4">Connect an admin wallet to manage nesting pools.</p>
      </div>
    )
  }

  if (loadingAdmin) {
    return (
      <div className="container mx-auto px-4 py-10 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Checking access…
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-xl">
        <p className="text-destructive">This wallet is not an admin.</p>
        <Button variant="outline" className="mt-4 min-h-[44px]" asChild>
          <Link href="/admin">Back to Owl Vision</Link>
        </Button>
      </div>
    )
  }

  if (!sessionReady) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-xl space-y-4">
        <Button variant="ghost" size="sm" asChild className="min-h-[44px]">
          <Link href="/admin" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Owl Vision
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Owl Nesting admin</h1>
        <p className="text-muted-foreground text-sm">Sign in to create and edit staking pools.</p>
        {signInError && <p className="text-destructive text-sm">{signInError}</p>}
        <Button onClick={() => void handleSignIn()} disabled={signingIn || !signMessage}>
          {signingIn ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Sign in with wallet
        </Button>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-10 pb-16 max-w-5xl space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="min-h-[44px] mb-2">
            <Link href="/admin" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Owl Vision
            </Link>
          </Button>
          <h1 className="text-2xl sm:text-3xl font-display text-theme-prime tracking-wide">Owl Nesting admin</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pools live in Supabase (read model). Adapter mode and on-chain addresses prepare for real staking without
            wallet-wide RPC scans.
          </p>
        </div>
        <Button variant="outline" size="sm" className="min-h-[44px]" asChild>
          <Link href="/nesting">View public page</Link>
        </Button>
      </div>

      {saveError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {saveError}
        </div>
      )}

      <section className="space-y-4">
        <SectionHeader
          title="Public staking page"
          description="Turn on the /nesting landing page when you are ready for all visitors. The site header always shows a Nesting link; while this is off, non-admins who tap it land on their dashboard nest instead of the public page. To pause actual nesting (claims, new nests, leaving), use Live nesting actions below or NESTING_DISABLED in deployment env."
        />
        <Card className="rounded-xl border-green-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-5 w-5 shrink-0" aria-hidden />
              Public /nesting page
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-medium">Visible to everyone</p>
                <p className="text-xs text-muted-foreground">
                  When off, only admins can open /nesting (others are sent to the dashboard nest). When on, anyone can
                  browse perches; staking still requires wallet connect and sign-in.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3 min-h-[44px] shrink-0 touch-manipulation">
                {landingPublicLoading || landingPublicSaving ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                ) : null}
                <Switch
                  id="nesting-public-landing"
                  ariaLabel="Make Owl Nesting landing page public"
                  checked={landingPublic}
                  disabled={landingPublicLoading || landingPublicSaving}
                  onCheckedChange={(v) => void patchLandingPublic(v)}
                />
              </div>
            </div>
            {landingPublicUpdatedAt ? (
              <p className="text-xs text-muted-foreground">
                Last updated {new Date(landingPublicUpdatedAt).toLocaleString()}
                {landingPublicUpdatedBy ? ` · ${landingPublicUpdatedBy}` : ''}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Live nesting actions"
          description="Controls the “Nesting is paused” banner and server blocks for new nests and leaving a nest. Holders can still claim accrued OWL while this is on. Use NESTING_DISABLED in deployment env to block claims too. This is not the same as showing the public /nesting page."
        />
        <Card className="rounded-xl border-amber-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PauseCircle className="h-5 w-5 shrink-0" aria-hidden />
              Pause holder actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {nestingEnvKillSwitch ? (
              <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <span className="font-medium">Env kill switch is on.</span>{' '}
                <span className="text-destructive/95">
                  This deployment reads <span className="font-mono">NESTING_DISABLED=true</span> from its environment.
                  Nesting stays paused for everyone until that value is unset (Vercel env for this deploy target, or{' '}
                  <span className="font-mono">.env.local</span> when developing). After changing Vercel env vars, trigger a
                  new deployment so functions pick up the change. The switch below cannot override it.
                </span>
              </div>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-medium">Pause new nests and leaving</p>
                <p className="text-xs text-muted-foreground">
                  Claims stay enabled so holders can collect OWL they already earned. Turn off when you want holders to
                  open or leave nests again. Existing nests stay as they are on
                  chain / in the database. Switch <span className="text-foreground font-medium">off</span> = live
                  holder actions; <span className="text-foreground font-medium">on</span> = paused.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3 min-h-[44px] shrink-0 touch-manipulation">
                {landingPublicLoading || nestingOpsSaving ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                ) : null}
                <Switch
                  id="nesting-ops-paused"
                  ariaLabel="Pause nesting holder actions"
                  checked={nestingOpsPaused}
                  disabled={landingPublicLoading || nestingOpsSaving}
                  onCheckedChange={(v) => void patchNestingOpsPaused(v)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Create pool"
          description="Quick path: NFT collection perch with a preset description and OWL/day rewards. Expand Advanced for token pools, custom slug, or economics."
        />
        <Card className="rounded-xl border-green-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-5 w-5" aria-hidden />
              New pool (quick)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="qk-name">Pool name</Label>
                <Input
                  id="qk-name"
                  autoComplete="off"
                  placeholder="e.g. Gen2 collection nest"
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  className="min-h-[44px] touch-manipulation"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="qk-coll">Collection address</Label>
                <Input
                  id="qk-coll"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Solana collection mint"
                  value={quickCollection}
                  onChange={(e) => setQuickCollection(e.target.value)}
                  className="font-mono text-xs min-h-[44px] touch-manipulation"
                />
                <p className="text-xs text-muted-foreground">
                  Slug is generated from the name plus part of this mint. Rewards: 1 OWL/day/NFT (site policy).
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-medium">Locked staking</p>
                <p className="text-xs text-muted-foreground">
                  Off means no lock period on this perch. On requires max/min lock days (max is what unstaking waits for).
                </p>
              </div>
              <div className="flex items-center justify-end gap-3 min-h-[44px] shrink-0 touch-manipulation">
                <Switch id="qk-locked" ariaLabel="Locked staking" checked={quickLocked} onCheckedChange={setQuickLocked} />
                <Label htmlFor="qk-locked" className="text-sm cursor-pointer">
                  {quickLocked ? 'Lock enabled' : 'No lock'}
                </Label>
              </div>
            </div>
            {quickLocked ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="qk-max-lock">Maximum lock (days)</Label>
                  <Input
                    id="qk-max-lock"
                    inputMode="numeric"
                    value={quickMaxLockDays}
                    onChange={(e) => setQuickMaxLockDays(e.target.value)}
                    className="min-h-[44px] touch-manipulation"
                  />
                  <p className="text-xs text-muted-foreground">Stored as pool lock; unstaking follows this.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="qk-min-lock">Minimum commitment (days)</Label>
                  <Input
                    id="qk-min-lock"
                    inputMode="numeric"
                    value={quickMinLockDays}
                    onChange={(e) => setQuickMinLockDays(e.target.value)}
                    className="min-h-[44px] touch-manipulation"
                  />
                  <p className="text-xs text-muted-foreground">Included in the preset description (defaults 30).</p>
                </div>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="qk-partner">Partner slug (optional)</Label>
                <Input
                  id="qk-partner"
                  autoComplete="off"
                  placeholder="e.g. lesharx"
                  value={quickPartnerSlug}
                  onChange={(e) => setQuickPartnerSlug(e.target.value)}
                  className="min-h-[44px] touch-manipulation"
                />
                <p className="text-xs text-muted-foreground">Shown on nest cards for partner-branded perches.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="qk-lock-standard">NFT lock standard</Label>
                <select
                  id="qk-lock-standard"
                  value={quickLockStandard}
                  onChange={(e) => setQuickLockStandard(e.target.value as NftLockStandard)}
                  className="min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm touch-manipulation"
                >
                  <option value="auto">Auto-detect (Helius)</option>
                  <option value="mpl_core_freeze_delegate">Metaplex Core freeze</option>
                  <option value="spl_token_account_freeze">SPL token account freeze</option>
                  <option value="database_only">Preview only (DB lock)</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Partner collections should use Core or SPL freeze — not preview mode. Run freeze-readiness after create.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                className="min-h-[44px] bg-green-600 hover:bg-green-700 touch-manipulation"
                disabled={saving || !quickName.trim() || !quickCollection.trim()}
                onClick={() => void createQuickPool()}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
                Create NFT pool
              </Button>
            </div>

            <details className="group rounded-xl border border-border/60 bg-background">
              <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium touch-manipulation min-h-[44px] [&::-webkit-details-marker]:hidden">
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden
                />
                Advanced — full fields (token pool, custom slug, fees, adapters)
              </summary>
              <div className="border-t border-border/60 px-4 pb-4 pt-2">
                <p className="text-xs text-muted-foreground mb-4">
                  Use this when you need a token stake pool, a hand-written slug/description, or non-default reward
                  settings.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="np-name">Name</Label>
              <Input id="np-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-slug">Slug</Label>
              <Input id="np-slug" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} className="font-mono min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-order">Display order</Label>
              <Input id="np-order" inputMode="numeric" value={form.display_order} onChange={(e) => setForm((f) => ({ ...f, display_order: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="np-desc">Description</Label>
              <Input id="np-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-asset">Asset type</Label>
              <select
                id="np-asset"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
                value={form.asset_type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, asset_type: e.target.value as StakingAssetType }))
                }
              >
                <option value="token">token</option>
                <option value="nft">nft</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-lock">Lock (days)</Label>
              <Input id="np-lock" inputMode="numeric" value={form.lock_period_days} onChange={(e) => setForm((f) => ({ ...f, lock_period_days: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-rate">Reward rate</Label>
              <Input id="np-rate" inputMode="decimal" value={form.reward_rate} onChange={(e) => setForm((f) => ({ ...f, reward_rate: e.target.value }))} className="font-mono min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-unit">Reward unit</Label>
              <select
                id="np-unit"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
                value={form.reward_rate_unit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, reward_rate_unit: e.target.value as RewardRateUnit }))
                }
              >
                <option value="hourly">hourly</option>
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-rt">Reward token label</Label>
              <Input id="np-rt" placeholder="e.g. OWL" value={form.reward_token} onChange={(e) => setForm((f) => ({ ...f, reward_token: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-mint">Token mint (optional)</Label>
              <Input id="np-mint" className="font-mono text-xs min-h-[44px]" value={form.token_mint} onChange={(e) => setForm((f) => ({ ...f, token_mint: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-coll">Collection key (optional)</Label>
              <Input id="np-coll" className="font-mono text-xs min-h-[44px]" value={form.collection_key} onChange={(e) => setForm((f) => ({ ...f, collection_key: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-min">Min stake</Label>
              <Input id="np-min" inputMode="decimal" value={form.minimum_stake} onChange={(e) => setForm((f) => ({ ...f, minimum_stake: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-max">Max stake</Label>
              <Input id="np-max" inputMode="decimal" value={form.maximum_stake} onChange={(e) => setForm((f) => ({ ...f, maximum_stake: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-fee">Platform fee (bps)</Label>
              <Input id="np-fee" inputMode="numeric" value={form.platform_fee_bps} onChange={(e) => setForm((f) => ({ ...f, platform_fee_bps: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-partner">Partner slug (optional)</Label>
              <Input id="np-partner" value={form.partner_project_slug} onChange={(e) => setForm((f) => ({ ...f, partner_project_slug: e.target.value }))} className="min-h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-lock-standard">NFT lock standard</Label>
              <select
                id="np-lock-standard"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
                value={form.nft_lock_standard}
                onChange={(e) =>
                  setForm((f) => ({ ...f, nft_lock_standard: e.target.value as NftLockStandard }))
                }
              >
                <option value="auto">auto</option>
                <option value="mpl_core_freeze_delegate">mpl_core_freeze_delegate</option>
                <option value="spl_token_account_freeze">spl_token_account_freeze</option>
                <option value="database_only">database_only</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-adapter">Default adapter mode</Label>
              <select
                id="np-adapter"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
                value={form.adapter_mode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, adapter_mode: e.target.value as NestingAdapterMode }))
                }
              >
                <option value="mock">mock</option>
                <option value="solana_ready">solana_ready</option>
                <option value="onchain_enabled">onchain_enabled</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-lock-src">Lock enforcement</Label>
              <select
                id="np-lock-src"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
                value={form.lock_enforcement_source}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    lock_enforcement_source: e.target.value as LockEnforcementSource,
                  }))
                }
              >
                <option value="database">database</option>
                <option value="onchain">onchain</option>
                <option value="hybrid">hybrid</option>
              </select>
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                id="np-onchain-flag"
                ariaLabel="On-chain enabled flag for new pool"
                checked={form.is_onchain_enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_onchain_enabled: v }))}
              />
              <Label htmlFor="np-onchain-flag">On-chain enabled (metadata)</Label>
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                id="np-req-sync"
                ariaLabel="Requires on-chain sync for new pool"
                checked={form.requires_onchain_sync}
                onCheckedChange={(v) => setForm((f) => ({ ...f, requires_onchain_sync: v }))}
              />
              <Label htmlFor="np-req-sync">Requires on-chain sync (users can POST /sync)</Label>
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                id="np-active"
                ariaLabel="Pool active — shown on public nesting landing"
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
              <Label htmlFor="np-active">Active (shown on public landing)</Label>
            </div>
            <div className="sm:col-span-2">
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px] touch-manipulation"
                disabled={saving || !form.name.trim() || !form.slug.trim() || !form.description.trim()}
                onClick={() => void createPool()}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
                Create pool (advanced)
              </Button>
            </div>
                </div>
              </div>
            </details>
          </CardContent>
        </Card>
      </section>

      <AdminGenOwlNestRosterSection />

      <section className="space-y-4">
        <SectionHeader
          title="Support playbook (start here)"
          description="Runs claim-ledger audit + nest diagnostics together and shows when catch-up or wallet heal would harm unpaid rewards. Always run this before catch-up or full heal."
        />
        <Card className="rounded-xl border-primary/40 bg-primary/5">
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="playbook-wallet">Holder wallet</Label>
              <Input
                id="playbook-wallet"
                autoComplete="off"
                spellCheck={false}
                placeholder="Solana address"
                value={supportWallet}
                onChange={(e) => {
                  setSupportWallet(e.target.value)
                  setClaimAuditWallet(e.target.value)
                }}
                className="font-mono text-xs min-h-[44px] touch-manipulation"
              />
            </div>
            <Button
              type="button"
              className="min-h-[44px] touch-manipulation"
              disabled={
                supportPlaybookRunning ||
                walletDiagRunning ||
                walletHealRunning ||
                ghostClearRunning ||
                claimCatchupRunning ||
                !supportWallet.trim()
              }
              onClick={() => void runSupportPlaybook()}
            >
              {supportPlaybookRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Run support playbook
            </Button>
            {supportPlaybookMsg ? (
              <p
                className={
                  supportPlaybook || supportPlaybookRunning
                    ? 'text-sm text-muted-foreground'
                    : 'text-sm text-destructive'
                }
                role="status"
              >
                {supportPlaybookMsg}
              </p>
            ) : null}
            {supportPlaybook ? (
              <div className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  {supportPlaybook.wallet.slice(0, 4)}…{supportPlaybook.wallet.slice(-4)} ·{' '}
                  {new Date(supportPlaybook.generated_at).toLocaleString()}
                </p>
                {supportPlaybook.claim_audit ? (
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground tabular-nums">
                      {supportPlaybook.claim_audit.estimated_claimable_owl.toFixed(4)}
                    </span>{' '}
                    OWL claimable · {supportPlaybook.claim_audit.active_nest_count} active nests · 24h on-chain
                    claims {supportPlaybook.claim_audit.onchain_claim_owl_24h.toFixed(4)} OWL (
                    {supportPlaybook.claim_audit.onchain_claim_tx_count_24h} tx)
                  </p>
                ) : null}
                <ul className="space-y-2">
                  {supportPlaybook.warnings.length === 0 ? (
                    <li className="rounded-lg border border-border/50 p-3 text-muted-foreground text-xs">
                      No blocking patterns detected in this scan.
                    </li>
                  ) : null}
                  {supportPlaybook.warnings.map((w) => (
                    <li
                      key={w.code}
                      className={
                        w.severity === 'block'
                          ? 'rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-destructive-foreground'
                          : w.severity === 'caution'
                            ? 'rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-100'
                            : 'rounded-lg border border-border/50 p-3 text-muted-foreground'
                      }
                    >
                      <p className="font-medium">{w.title}</p>
                      <p className="text-xs mt-1 leading-relaxed opacity-90">{w.detail}</p>
                    </li>
                  ))}
                </ul>
                {supportPlaybook.recommendations.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Recommended</p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {supportPlaybook.recommendations.map((r, i) => (
                        <li key={i}>
                          <span className="text-foreground">{r.action}</span> — {r.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {supportPlaybook.guards.block_apply_catch_up ? (
                  <div className="flex items-start gap-3">
                    <Switch
                      id="support-override-catch-up"
                      ariaLabel="Override catch-up block"
                      checked={overrideCatchUpBlock}
                      onCheckedChange={setOverrideCatchUpBlock}
                    />
                    <Label htmlFor="support-override-catch-up" className="text-xs leading-relaxed text-muted-foreground">
                      Override: allow catch-up anyway (only if OWL was already sent on-chain)
                    </Label>
                  </div>
                ) : null}
                {supportPlaybook.guards.block_wallet_heal ? (
                  <div className="flex items-start gap-3">
                    <Switch
                      id="support-override-wallet-heal"
                      ariaLabel="Override wallet heal block"
                      checked={overrideWalletHealBlock}
                      onCheckedChange={setOverrideWalletHealBlock}
                    />
                    <Label htmlFor="support-override-wallet-heal" className="text-xs leading-relaxed text-muted-foreground">
                      Override: allow full wallet heal anyway (will close active nests in DB)
                    </Label>
                  </div>
                ) : null}
                {ghostActiveCount > 0 ? (
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-[44px] touch-manipulation border-primary/40"
                      disabled={ghostClearRunning || !supportWallet.trim()}
                      onClick={() => void runClearGhostActives()}
                    >
                      {ghostClearRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Clear ghost actives only ({ghostActiveCount})
                    </Button>
                    <p className="text-xs text-muted-foreground max-w-md">
                      Removes active ledger rows with no mint. Safe while the holder still has real nests and
                      claimable OWL — not the same as full heal.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Claim ledger audit (incident)"
          description="Find wallets with repeat Claim-all on-chain payouts while the UI still shows high claimable. Catch-up syncs claimed_rewards to accrued (no extra SPL) after you confirm they were already paid."
        />
        <Card className="rounded-xl border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="min-w-[200px] flex-1 space-y-1">
                <Label htmlFor="claim-audit-wallet">Holder wallet (optional)</Label>
                <Input
                  id="claim-audit-wallet"
                  value={claimAuditWallet}
                  onChange={(e) => setClaimAuditWallet(e.target.value)}
                  placeholder="Leave empty for flagged wallets"
                  className="min-h-[44px] font-mono text-sm"
                  autoComplete="off"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] touch-manipulation"
                disabled={claimAuditing || claimCatchupRunning}
                onClick={() => void runClaimLedgerAudit()}
              >
                {claimAuditing ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
                Run audit
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px] touch-manipulation"
                disabled={claimCatchupRunning || !claimAuditWallet.trim()}
                onClick={() => void runClaimLedgerCatchup(true)}
              >
                Dry-run catch-up
              </Button>
              <Button
                type="button"
                variant="default"
                className="min-h-[44px] touch-manipulation"
                disabled={
                  claimCatchupRunning ||
                  !claimAuditWallet.trim() ||
                  (supportPlaybook?.guards.block_apply_catch_up === true &&
                    !overrideCatchUpBlock &&
                    supportPlaybook.wallet === claimAuditWallet.trim())
                }
                onClick={() => void runClaimLedgerCatchup(false)}
              >
                {claimCatchupRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
                Apply catch-up
              </Button>
            </div>
            {claimCatchupMsg ? <p className="text-sm text-muted-foreground">{claimCatchupMsg}</p> : null}
            {claimAuditReport ? (
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  Generated {new Date(claimAuditReport.generated_at).toLocaleString()} —{' '}
                  {claimAuditReport.wallets.length} wallet(s)
                </p>
                <ul className="space-y-3 max-h-80 overflow-y-auto">
                  {claimAuditReport.wallets.map((row) => (
                    <li
                      key={row.wallet_address}
                      className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-1"
                    >
                      <p className="font-mono text-xs break-all">{row.wallet_address}</p>
                      <p>
                        Claimable (est.):{' '}
                        <span className="font-mono tabular-nums">{row.estimated_claimable_owl.toFixed(6)}</span> OWL
                        {' · '}
                        24h on-chain:{' '}
                        <span className="font-mono tabular-nums">{row.onchain_claim_owl_24h.toFixed(6)}</span> OWL (
                        {row.onchain_claim_tx_count_24h} tx)
                      </p>
                      {row.risk_flags.length > 0 ? (
                        <p className="text-amber-200/95 text-xs leading-relaxed">{row.risk_summary}</p>
                      ) : (
                        <p className="text-muted-foreground text-xs">{row.risk_summary}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Sparse reconcile (RPC)"
          description={`Runs up to ${NESTING_RECONCILE_MAX_BATCH} pending/stale positions — one getTransaction each. Trigger manually; do not wire to aggressive polling.`}
        />
        <Card className="rounded-xl border-border/60">
          <CardContent className="pt-6 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={reconciling}
              onClick={() => void runReconcile()}
            >
              {reconciling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Reconcile pending positions
            </Button>
            {reconcileMsg ? <p className="text-sm text-muted-foreground">{reconcileMsg}</p> : null}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Support: wallet nest diagnostics & heal"
          description="Run diagnostics on the holder wallet (current address in Phantom). Detects ledger/on-chain mismatch, orphaned rows, and nests still open under a prior wallet after NFT transfer. Heal clears DB rows only — no on-chain thaw."
        />
        <Card className="rounded-xl border-border/60">
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="support-wallet">Holder wallet</Label>
              <Input
                id="support-wallet"
                autoComplete="off"
                spellCheck={false}
                placeholder="Solana address"
                value={supportWallet}
                onChange={(e) => setSupportWallet(e.target.value)}
                className="font-mono text-xs min-h-[44px] touch-manipulation"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] touch-manipulation"
                disabled={
                  walletDiagRunning || walletHealRunning || ghostClearRunning || !supportWallet.trim()
                }
                onClick={() => void runWalletNestDiagnostics()}
              >
                {walletDiagRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Run diagnostics
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] touch-manipulation border-primary/40"
                disabled={
                  ghostClearRunning ||
                  walletDiagRunning ||
                  walletHealRunning ||
                  !supportWallet.trim()
                }
                onClick={() => void runClearGhostActives()}
              >
                {ghostClearRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Clear ghost actives only
                {ghostActiveCount > 0 ? ` (${ghostActiveCount})` : ''}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px] touch-manipulation"
                disabled={
                  walletHealRunning ||
                  walletDiagRunning ||
                  ghostClearRunning ||
                  !supportWallet.trim() ||
                  (supportPlaybook?.guards.block_wallet_heal === true &&
                    !overrideWalletHealBlock &&
                    supportPlaybook.wallet === supportWallet.trim())
                }
                onClick={() => void runWalletNestHeal()}
              >
                {walletHealRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Apply full heal
              </Button>
            </div>
            {walletSupportMsg ? (
              <p className="text-sm text-muted-foreground max-w-xl">{walletSupportMsg}</p>
            ) : null}
            {walletDiagReport ? (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3 text-sm">
                <p>
                  <span className="text-muted-foreground">Owl Nest coins in wallet:</span>{' '}
                  <span className="font-medium tabular-nums">{walletDiagReport.wallet_nest_mint_count}</span>
                  {' · '}
                  <span className="text-muted-foreground">DB rows:</span>{' '}
                  {walletDiagReport.positions_under_wallet.active} active,{' '}
                  {walletDiagReport.positions_under_wallet.pending} pending
                  {(walletDiagReport.positions_under_wallet.ghost_active ?? 0) > 0 ? (
                    <>
                      {' · '}
                      <span className="text-amber-200/95 font-medium tabular-nums">
                        {walletDiagReport.positions_under_wallet.ghost_active} ghost active
                      </span>
                    </>
                  ) : null}
                </p>
                {walletDiagReport.cross_wallet_rows.length > 0 ? (
                  <div>
                    <p className="text-amber-200/95 font-medium mb-1">
                      Cross-wallet blockers ({walletDiagReport.cross_wallet_rows.length})
                    </p>
                    <ul className="space-y-1 text-xs font-mono break-all text-muted-foreground">
                      {walletDiagReport.cross_wallet_rows.slice(0, 8).map((row) => (
                        <li key={row.position_id}>
                          {row.asset_identifier.slice(0, 12)}… → prior {row.prior_wallet.slice(0, 12)}… (
                          {row.status})
                        </li>
                      ))}
                      {walletDiagReport.cross_wallet_rows.length > 8 ? (
                        <li>…and {walletDiagReport.cross_wallet_rows.length - 8} more</li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
                {walletDiagReport.issues.length > 0 ? (
                  <ul className="space-y-2">
                    {walletDiagReport.issues
                      .filter(
                        (i) =>
                          i.severity !== 'low' ||
                          i.kind === 'cross_wallet_blocker' ||
                          i.kind === 'ghost_active_nest'
                      )
                      .slice(0, 12)
                      .map((issue, idx) => (
                        <li
                          key={`${issue.kind}-${idx}`}
                          className={
                            issue.severity === 'high'
                              ? 'text-amber-200/95'
                              : 'text-muted-foreground'
                          }
                        >
                          <span className="font-mono text-[10px] uppercase mr-2 opacity-70">
                            {issue.kind}
                          </span>
                          {issue.message}
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">No issues detected for this wallet.</p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Support: force leave nest"
          description="Runs the same on-chain / DB unstake as the holder’s Leave nest — bypasses lock timer, council vote lock, and global nesting pause. For NFTs, also skips Helius collection grouping when the pool collection_key does not match the asset (uses on-chain owner + asset collection). Use staking_positions.id."
        />
        <Card className="rounded-xl border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-200">
              <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
              Admin unstake override
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              For NFT perches with freeze locks, the server signs thaw with your configured freeze authority. For token
              vaults, tokens return to the holder wallet on record. Confirm the position id matches the user’s open nest
              before continuing.
            </p>
            <div className="space-y-2">
              <Label htmlFor="force-unstake-pos">Position id</Label>
              <Input
                id="force-unstake-pos"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. 8f3c2a1b-…"
                value={forceUnstakePositionId}
                onChange={(e) => setForceUnstakePositionId(e.target.value)}
                className="font-mono text-xs min-h-[44px] touch-manipulation"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="destructive"
                className="min-h-[44px] touch-manipulation"
                disabled={forceUnstaking || !forceUnstakePositionId.trim()}
                onClick={() => void runForceUnstake()}
              >
                {forceUnstaking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Force leave nest
              </Button>
              {forceUnstakeMsg ? (
                <p className="text-sm text-muted-foreground max-w-xl">{forceUnstakeMsg}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <SectionHeader
          title="All pools"
          description="Toggle public listing, admin preview (admins-only stake until you open it), adapter mode, and on-chain metadata per pool."
        />
        {loadingPools ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        ) : pools.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">No pools yet.</p>
        ) : (
          <ul className="grid gap-6">
            {pools.map((pool) => (
              <li key={pool.id} className="space-y-3">
                <StakingPoolCard pool={pool} compact />
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-muted-foreground">Public listing</span>
                    <Switch
                      id={`pool-active-${pool.id}`}
                      ariaLabel={`Toggle active: ${pool.name}`}
                      checked={pool.is_active}
                      onCheckedChange={(v) => void toggleActive(pool, v)}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-muted-foreground">Admin preview only</span>
                    <Switch
                      id={`pool-admin-only-${pool.id}`}
                      ariaLabel={`Toggle admin preview: ${pool.name}`}
                      checked={pool.admin_only === true}
                      onCheckedChange={(v) => void toggleAdminPreview(pool, v)}
                    />
                  </div>
                  <Button variant="outline" size="sm" className="min-h-[44px]" asChild>
                    <Link href={`/dashboard/nesting?pool=${encodeURIComponent(pool.id)}`}>Test stake UI</Link>
                  </Button>
                </div>
                {pool.admin_only ? (
                  <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
                    While on, only site admins can see and stake on this perch. Turn off when you are ready for all
                    holders (e.g. Gen 1 / Gen 2 launch).
                  </p>
                ) : null}
                <PoolOnChainSettingsForm
                  pool={pool}
                  isSaving={savingPoolId === pool.id}
                  onBusyChange={(busy) => setSavingPoolId(busy ? pool.id : null)}
                  onSaveSuccess={fetchPools}
                  onRemoteError={(msg) => setSaveError(msg)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
