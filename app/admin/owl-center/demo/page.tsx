'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, Copy, ExternalLink, Loader2 } from 'lucide-react'

import { WalletConnectButton } from '@/components/WalletConnectButton'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { MarketplaceReadinessPanel } from '@/components/owl-center/MarketplaceReadinessPanel'
import { MetadataRefreshPanel } from '@/components/owl-center/MetadataRefreshPanel'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type HashListPayload = {
  mint_count: number
  hash_list_text: string
  suggested_magic_eden_url: string | null
  suggested_tensor_url: string | null
  me_submit_hint: string
  tensor_submit_hint: string
}

export default function AdminOwlCenterDemoPage() {
  const { connected } = useWallet()
  const { signIn, signingIn, error: signErr } = useSiwsSignIn()

  const [launch, setLaunch] = useState<OwlCenterLaunchPublic | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [hashList, setHashList] = useState<HashListPayload | null>(null)

  const [slug, setSlug] = useState('demo')
  const [name, setName] = useState('Owltopia Launchpad Demo')
  const [symbol, setSymbol] = useState('OWLD')
  const [supply, setSupply] = useState('5')
  const [walletLimit, setWalletLimit] = useState('3')
  const [mintNetwork, setMintNetwork] = useState<'mainnet' | 'devnet'>('mainnet')
  const [cm, setCm] = useState('')
  const [col, setCol] = useState('')
  const [devnetCm, setDevnetCm] = useState('')
  const [devnetCol, setDevnetCol] = useState('')
  const [paused, setPaused] = useState(false)

  const loadDemo = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/owl-center/launches', { credentials: 'include', cache: 'no-store' })
      const j = (await res.json()) as { launches?: Array<Record<string, unknown>>; error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      const rows = j.launches ?? []
      const publicSimple = rows.filter((r) => String(r.mint_mode) === 'public_simple')
      const demo =
        rows.find((r) => String(r.slug) === 'demo') ??
        [...publicSimple].sort((a, b) => Number(b.minted_count ?? 0) - Number(a.minted_count ?? 0))[0] ??
        publicSimple[0]
      if (demo) {
        setLaunch({
          id: String(demo.id),
          slug: String(demo.slug),
          name: String(demo.name),
          symbol: demo.symbol != null ? String(demo.symbol) : null,
          description: demo.description != null ? String(demo.description) : null,
          image_url: demo.image_url != null ? String(demo.image_url) : null,
          creator_wallet: demo.creator_wallet != null ? String(demo.creator_wallet) : null,
          candy_machine_id: demo.candy_machine_id != null ? String(demo.candy_machine_id) : null,
          collection_mint: demo.collection_mint != null ? String(demo.collection_mint) : null,
          devnet_candy_machine_id:
            demo.devnet_candy_machine_id != null ? String(demo.devnet_candy_machine_id) : null,
          devnet_collection_mint: demo.devnet_collection_mint != null ? String(demo.devnet_collection_mint) : null,
          mint_standard: String(demo.mint_standard ?? 'token_metadata'),
          total_supply: Number(demo.total_supply ?? 0),
          minted_count: Number(demo.minted_count ?? 0),
          active_phase: String(demo.active_phase) as OwlCenterLaunchPublic['active_phase'],
          status: String(demo.status) as OwlCenterLaunchPublic['status'],
          presale_supply: Number(demo.presale_supply ?? 0),
          wl_supply: Number(demo.wl_supply ?? 0),
          public_supply: Number(demo.public_supply ?? 0),
          airdrop_supply: Number(demo.airdrop_supply ?? 0),
          presale_overage_supply: Number(demo.presale_overage_supply ?? 0),
          presale_price_usdc: demo.presale_price_usdc != null ? Number(demo.presale_price_usdc) : null,
          wl_price_usdc: demo.wl_price_usdc != null ? Number(demo.wl_price_usdc) : null,
          public_price_usdc: demo.public_price_usdc != null ? Number(demo.public_price_usdc) : null,
          wallet_mint_limit: Number(demo.wallet_mint_limit ?? 5),
          magic_eden_url: demo.magic_eden_url != null ? String(demo.magic_eden_url) : null,
          tensor_url: demo.tensor_url != null ? String(demo.tensor_url) : null,
          is_featured: Boolean(demo.is_featured),
          is_paused: Boolean(demo.is_paused),
          launch_deadline_at: demo.launch_deadline_at != null ? String(demo.launch_deadline_at) : null,
          phase_schedule:
            demo.phase_schedule && typeof demo.phase_schedule === 'object' && !Array.isArray(demo.phase_schedule)
              ? (demo.phase_schedule as OwlCenterLaunchPublic['phase_schedule'])
              : {},
          updated_at: String(demo.updated_at ?? ''),
          metadata_ready: Boolean(demo.metadata_ready),
          assets_ready: Boolean(demo.assets_ready),
          marketplace_ready: Boolean(demo.marketplace_ready),
          treasury_wallet: demo.treasury_wallet != null ? String(demo.treasury_wallet) : null,
          creator_presale_enabled: Boolean(demo.creator_presale_enabled),
          creator_wl_enabled: Boolean(demo.creator_wl_enabled),
          creator_mint_price: demo.creator_mint_price != null ? Number(demo.creator_mint_price) : null,
          creator_mint_currency: demo.creator_mint_currency != null ? String(demo.creator_mint_currency) : null,
          creator_launch_date: demo.creator_launch_date != null ? String(demo.creator_launch_date) : null,
          mint_mode: String(demo.mint_mode) === 'public_simple' ? 'public_simple' : 'gen2_full',
          generator_project_id:
            demo.generator_project_id != null && String(demo.generator_project_id).trim()
              ? String(demo.generator_project_id).trim()
              : null,
          mint_network:
            demo.mint_network === 'devnet' || demo.mint_network === 'mainnet'
              ? demo.mint_network
              : null,
          seller_fee_basis_points: Number(demo.seller_fee_basis_points ?? 500),
        })
        setCm(demo.candy_machine_id != null ? String(demo.candy_machine_id) : '')
        setCol(demo.collection_mint != null ? String(demo.collection_mint) : '')
        setDevnetCm(demo.devnet_candy_machine_id != null ? String(demo.devnet_candy_machine_id) : '')
        setDevnetCol(demo.devnet_collection_mint != null ? String(demo.devnet_collection_mint) : '')
        setPaused(Boolean(demo.is_paused))
        setMintNetwork(
          demo.mint_network === 'devnet' || demo.mint_network === 'mainnet' ? demo.mint_network : 'mainnet'
        )
      } else {
        setLaunch(null)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (connected) void loadDemo()
  }, [connected, loadDemo])

  async function createDemo() {
    setMsg(null)
    const res = await fetch('/api/admin/owl-center/launches', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        name,
        symbol,
        total_supply: Number(supply),
        wallet_mint_limit: Number(walletLimit),
        mint_network: mintNetwork,
        candy_machine_id: cm.trim() || null,
        collection_mint: col.trim() || null,
        devnet_candy_machine_id: devnetCm.trim() || null,
        devnet_collection_mint: devnetCol.trim() || null,
        is_featured: true,
        description: 'Owl Center launchpad demo — 5 pre-rendered owls from collections/owl-center-demo (Sugar → mint → ME).',
      }),
    })
    const j = (await res.json()) as { ok?: boolean; error?: string; launch?: OwlCenterLaunchPublic }
    if (!res.ok) {
      setMsg(j.error || 'create_failed')
      return
    }
    setMsg(`Created demo launch · slug ${j.launch?.slug ?? slug}`)
    await loadDemo()
  }

  async function saveLaunch() {
    if (!launch) return
    setMsg(null)
    const res = await fetch(`/api/admin/owl-center/launches/${launch.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candy_machine_id: cm.trim() || null,
        collection_mint: col.trim() || null,
        devnet_candy_machine_id: devnetCm.trim() || null,
        devnet_collection_mint: devnetCol.trim() || null,
        mint_network: mintNetwork,
        is_paused: paused,
      }),
    })
    const j = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok) {
      setMsg(j.error || 'save_failed')
      return
    }
    setMsg('Saved')
    await loadDemo()
  }

  async function loadHashList() {
    if (!launch) return
    setMsg(null)
    const res = await fetch(`/api/admin/owl-center/collections/${launch.id}/hash-list`, {
      credentials: 'include',
      cache: 'no-store',
    })
    const j = (await res.json()) as HashListPayload & { error?: string }
    if (!res.ok) {
      setMsg(j.error || 'hash_list_failed')
      return
    }
    setHashList(j)
  }

  if (!connected) {
    return (
      <div className="mx-auto max-w-lg px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] text-center">
        <p className="text-[#9BA8B4]">Connect admin wallet to manage demo mint.</p>
        <div className="mt-6 flex justify-center">
          <WalletConnectButton />
        </div>
        {signErr ? <p className="mt-4 text-sm text-red-400">{signErr}</p> : null}
        <button
          type="button"
          onClick={() => void signIn()}
          disabled={signingIn}
          className="mt-4 text-sm text-[#00FF9C] underline"
        >
          {signingIn ? 'Signing in…' : 'Sign in with Solana'}
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] sm:py-10">
      <Link
        href="/admin/owl-center"
        className="mb-6 inline-flex min-h-[44px] w-full touch-manipulation items-center gap-2 text-sm text-[#9BA8B4] hover:text-[#00FF9C] sm:w-auto"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
        Launchpad hub
      </Link>

      <h1 className="font-display text-2xl text-[#F4FBF8] sm:text-3xl">Demo mint launchpad</h1>
      <p className="mt-2 text-sm text-[#9BA8B4]">
        Pre-rendered art lives in <code className="text-[#00FF9C]">collections/owl-center-demo/</code> (5 owls). Run{' '}
        <code className="text-[#00FF9C]">npm run prepare:owl-center-demo</code>, then Sugar upload/deploy. Mint here until
        sell-out — hash list + ME/Tensor prep runs automatically.
      </p>

      {loading ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-[#5C6773]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </p>
      ) : !launch ? (
        <CommandCard label="CREATE_DEMO" className="mt-8">
          <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">No public_simple launch found</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-xs uppercase tracking-widest text-[#5C6773]">
              Slug
              <input value={slug} onChange={(e) => setSlug(e.target.value)} className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm" />
            </label>
            <label className="grid gap-1 text-xs uppercase tracking-widest text-[#5C6773]">
              Symbol
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm" />
            </label>
            <label className="grid gap-1 text-xs uppercase tracking-widest text-[#5C6773] sm:col-span-2">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm" />
            </label>
            <label className="grid gap-1 text-xs uppercase tracking-widest text-[#5C6773]">
              Supply
              <input value={supply} onChange={(e) => setSupply(e.target.value)} className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm" />
            </label>
            <label className="grid gap-1 text-xs uppercase tracking-widest text-[#5C6773]">
              Network
              <select
                value={mintNetwork}
                onChange={(e) => setMintNetwork(e.target.value as 'mainnet' | 'devnet')}
                className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm"
              >
                <option value="mainnet">mainnet (ME + Tensor)</option>
                <option value="devnet">devnet (smoke test)</option>
              </select>
            </label>
          </div>
          <DeployButton className="mt-6 w-full sm:w-auto" onClick={() => void createDemo()}>
            Create demo launch
          </DeployButton>
        </CommandCard>
      ) : (
        <div className="mt-8 space-y-8">
          <CommandCard label={`${launch.slug.toUpperCase()} // ${launch.minted_count}/${launch.total_supply} · ${mintNetwork}`}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-xs uppercase tracking-widest text-[#5C6773]">
                Mainnet CM
                <input value={cm} onChange={(e) => setCm(e.target.value)} className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-xs" />
              </label>
              <label className="grid gap-1 text-xs uppercase tracking-widest text-[#5C6773]">
                Mainnet collection mint
                <input value={col} onChange={(e) => setCol(e.target.value)} className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-xs" />
              </label>
              <label className="grid gap-1 text-xs uppercase tracking-widest text-[#5C6773]">
                Devnet CM
                <input value={devnetCm} onChange={(e) => setDevnetCm(e.target.value)} className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-xs" />
              </label>
              <label className="grid gap-1 text-xs uppercase tracking-widest text-[#5C6773]">
                Devnet collection mint
                <input value={devnetCol} onChange={(e) => setDevnetCol(e.target.value)} className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-xs" />
              </label>
              <label className="flex items-center gap-2 text-sm text-[#C5D0D8]">
                <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} className="h-[18px] w-[18px] accent-[#00FF9C]" />
                Pause mint
              </label>
              <label className="grid gap-1 text-xs uppercase tracking-widest text-[#5C6773]">
                Mint network
                <select
                  value={mintNetwork}
                  onChange={(e) => setMintNetwork(e.target.value as 'mainnet' | 'devnet')}
                  className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm"
                >
                  <option value="mainnet">mainnet</option>
                  <option value="devnet">devnet</option>
                </select>
              </label>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <DeployButton className="w-full sm:w-auto" onClick={() => void saveLaunch()}>
                Save CM config
              </DeployButton>
              <a
                href={`/owl-center/collection/${launch.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-2 border border-[#1A222B] px-4 text-sm font-bold text-[#9BA8B4] hover:border-[#00FF9C]/35 sm:w-auto sm:justify-start"
              >
                Open mint page <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
              </a>
              <Link
                href={`/admin/owl-center/collections/${launch.id}/assets#metadata-refresh`}
                className="inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center border border-[#00FF9C]/35 px-4 text-center text-sm font-bold text-[#00FF9C] hover:bg-[#00FF9C]/10 sm:w-auto"
              >
                Fix wallet metadata
              </Link>
              <Link
                href={`/admin/owl-center/collections/${launch.id}/assets`}
                className="inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center border border-[#1A222B] px-4 text-sm text-[#9BA8B4] hover:text-[#00FF9C] sm:w-auto"
              >
                Assets admin
              </Link>
            </div>
          </CommandCard>

          <MetadataRefreshPanel launchId={launch.id} />

          <CommandCard label="HASH_LIST">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
              For Magic Eden + Tensor submission after mints
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <DeployButton variant="ghost" className="w-full sm:w-auto" onClick={() => void loadHashList()}>
                Generate from mint events
              </DeployButton>
              <DeployButton
                variant="ghost"
                className="w-full sm:w-auto"
              onClick={async () => {
                if (!launch) return
                setMsg(null)
                const res = await fetch(`/api/admin/owl-center/collections/${launch.id}/sellout-prep`, {
                  method: 'POST',
                  credentials: 'include',
                })
                const j = (await res.json()) as { ok?: boolean; error?: string; result?: { mint_count?: number } }
                if (!res.ok) setMsg(j.error || 'sellout_prep_failed')
                else setMsg(`Sell-out prep · ${j.result?.mint_count ?? 0} mint(s)`)
                void loadHashList()
                void loadDemo()
              }}
            >
              Run sell-out prep
              </DeployButton>
            </div>
            {hashList ? (
              <div className="mt-4 space-y-3 text-sm text-[#C5D0D8]">
                <p>
                  {hashList.mint_count} mint(s) recorded
                  {hashList.suggested_magic_eden_url ? (
                    <>
                      {' · '}
                      <a href={hashList.suggested_magic_eden_url} target="_blank" rel="noreferrer" className="text-[#00FF9C] underline">
                        ME preview
                      </a>
                    </>
                  ) : null}
                </p>
                <textarea
                  readOnly
                  value={hashList.hash_list_text}
                  rows={6}
                  className="w-full border border-[#1A222B] bg-[#0F1419] p-2 font-mono text-xs"
                />
                <button
                  type="button"
                  className="inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-2 text-xs text-[#00FF9C] sm:w-auto sm:justify-start"
                  onClick={() => void navigator.clipboard.writeText(hashList.hash_list_text)}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  Copy hash list
                </button>
                <p className="text-xs text-[#5C6773]">{hashList.me_submit_hint}</p>
                <p className="text-xs text-[#5C6773]">{hashList.tensor_submit_hint}</p>
              </div>
            ) : null}
          </CommandCard>

          <MarketplaceReadinessPanel launchId={launch.id} launch={launch} />
        </div>
      )}

      {msg ? <p className="mt-6 font-mono text-sm text-[#00FF9C]">{msg}</p> : null}
    </div>
  )
}
