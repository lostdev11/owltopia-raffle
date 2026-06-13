'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { AssetStepForm, type AssetStepValues } from '@/components/owl-center/AssetStepForm'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import {
  clearGeneratorHandoffFromSession,
  clearLaunchDraftFromSession,
  readGeneratorProjectIdFromSession,
  readLaunchDraftFromSession,
} from '@/lib/owl-center/generator/launch-draft'

const STEPS = ['Collection info', 'Supply & mint', 'Assets & metadata', 'Review'] as const

const emptyAssets: AssetStepValues = {
  logo_url: '',
  banner_url: '',
  collection_image_url: '',
  assets_package_url: '',
  metadata_package_url: '',
  traits_csv_url: '',
  asset_notes: '',
  total_images: '',
  total_metadata: '',
}

export function LaunchSubmissionWizard() {
  const searchParams = useSearchParams()
  const fromGenerator = searchParams.get('from') === 'generator'
  const [generatorPrefill, setGeneratorPrefill] = useState(false)
  const [generatorProjectId, setGeneratorProjectId] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState<string | null>(null)

  const [collectionName, setCollectionName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [creatorWallet, setCreatorWallet] = useState('')
  const [treasuryWallet, setTreasuryWallet] = useState('')

  const [totalSupply, setTotalSupply] = useState('1000')
  const [mintPrice, setMintPrice] = useState('1')
  const [currency, setCurrency] = useState<'SOL' | 'USDC'>('SOL')
  const [walletMintLimit, setWalletMintLimit] = useState('5')
  const [launchDate, setLaunchDate] = useState('')
  const [presaleStart, setPresaleStart] = useState('')
  const [wlStart, setWlStart] = useState('')
  const [publicStart, setPublicStart] = useState('')
  const [presaleEnabled, setPresaleEnabled] = useState(false)
  const [wlEnabled, setWlEnabled] = useState(false)

  const [assets, setAssets] = useState<AssetStepValues>(emptyAssets)

  useEffect(() => {
    if (!fromGenerator) return
    const draft = readLaunchDraftFromSession()
    if (!draft) return
    setCollectionName(draft.collection_name)
    setSymbol(draft.symbol)
    setDescription(draft.description)
    setTotalSupply(draft.total_supply)
    setAssets((a) => ({
      ...a,
      asset_notes: draft.asset_notes,
      total_images: draft.total_images || draft.total_supply,
      total_metadata: draft.total_metadata || draft.total_supply,
    }))
    setGeneratorPrefill(true)
    setGeneratorProjectId(draft.project_id || readGeneratorProjectIdFromSession())
    clearLaunchDraftFromSession()
  }, [fromGenerator])

  function next() {
    setMsg(null)
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }
  function back() {
    setMsg(null)
    setStep((s) => Math.max(s - 1, 0))
  }

  async function submit() {
    setStatus('sending')
    setMsg(null)
    try {
      const payload: Record<string, unknown> = {
        collection_name: collectionName.trim(),
        symbol: symbol.trim(),
        description: description.trim() || null,
        creator_wallet: creatorWallet.trim(),
        treasury_wallet: treasuryWallet.trim() || null,
        total_supply: Number(totalSupply),
        mint_price: Number(mintPrice),
        currency,
        wallet_mint_limit: Number(walletMintLimit),
        launch_date: launchDate.trim() || null,
        phase_schedule: {
          ...(launchDate.trim() ? { AIRDROP: launchDate.trim() } : {}),
          ...(presaleEnabled && presaleStart.trim() ? { PRESALE: presaleStart.trim() } : {}),
          ...(wlEnabled && wlStart.trim() ? { WHITELIST: wlStart.trim() } : {}),
          ...(publicStart.trim() ? { PUBLIC: publicStart.trim() } : {}),
        },
        presale_enabled: presaleEnabled,
        wl_enabled: wlEnabled,
        logo_url: assets.logo_url.trim() || null,
        banner_url: assets.banner_url.trim() || null,
        collection_image_url: assets.collection_image_url.trim() || null,
        assets_package_url: assets.assets_package_url.trim() || null,
        metadata_package_url: assets.metadata_package_url.trim() || null,
        traits_csv_url: assets.traits_csv_url.trim() || null,
        asset_notes: assets.asset_notes.trim() || null,
      }
      if (assets.total_images.trim()) payload.total_images = Number(assets.total_images)
      if (assets.total_metadata.trim()) payload.total_metadata = Number(assets.total_metadata)
      if (generatorProjectId) payload.generator_project_id = generatorProjectId

      const res = await fetch('/api/owl-center/launch-submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const j = (await res.json()) as { ok?: boolean; error?: string; id?: string; slug?: string }
      if (!res.ok) throw new Error(j.error || 'submit_failed')
      setStatus('ok')
      clearGeneratorHandoffFromSession()
      setMsg(`Queued as PENDING_REVIEW — id ${j.id ?? ''} · slug ${j.slug ?? ''}`)
    } catch (e) {
      setStatus('err')
      setMsg(e instanceof Error ? e.message : 'submit_failed')
    }
  }

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // INTAKE"
      title="Submit Solana collection"
      subtitle="Internal review only — no deployment automation. Sign in optional; we bind your wallet when you use Sign-In with Solana."
    >
      {generatorPrefill ? (
        <p className="mb-6 rounded border border-[#00FF9C]/30 bg-[#00FF9C]/8 px-4 py-3 text-sm text-[#C5D0D8]">
          Prefilled from <strong className="font-normal text-[#EAFBF4]">Owl Generator</strong> — step 3 includes image/metadata
          counts. Stage your Sugar ZIP in the generator before submit; validation links automatically on launch intake.
          Package URLs are added after Phase B Arweave upload in admin.
        </p>
      ) : null}
      <nav className="mb-8 font-mono text-xs uppercase tracking-widest text-[#5C6773]">
        {STEPS.map((label, i) => (
          <span key={label}>
            {i > 0 ? <span className="mx-2 text-[#1A222B]">/</span> : null}
            <button
              type="button"
              onClick={() => setStep(i)}
              className={`touch-manipulation ${i === step ? 'text-[#00FF9C]' : 'text-[#7D8A93] hover:text-[#C5D0D8]'}`}
            >
              {i + 1}. {label}
            </button>
          </span>
        ))}
      </nav>

      <div className="grid max-w-xl gap-6 border border-[#1A222B] bg-[#10161C]/85 p-6">
        {step === 0 ? (
          <CommandCard label="STEP_01 · COLLECTION_INFO">
            <div className="grid gap-4">
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Collection name
                <input
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  required
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Symbol
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  required
                  maxLength={16}
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Creator wallet (Solana)
                <input
                  value={creatorWallet}
                  onChange={(e) => setCreatorWallet(e.target.value)}
                  required
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Treasury wallet
                <input
                  value={treasuryWallet}
                  onChange={(e) => setTreasuryWallet(e.target.value)}
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8]"
                />
              </label>
            </div>
          </CommandCard>
        ) : null}

        {step === 1 ? (
          <CommandCard label="STEP_02 · SUPPLY_MINT">
            <div className="grid gap-4">
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Total supply
                <input
                  type="number"
                  min={1}
                  value={totalSupply}
                  onChange={(e) => setTotalSupply(e.target.value)}
                  required
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Mint price
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={mintPrice}
                  onChange={(e) => setMintPrice(e.target.value)}
                  required
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Currency
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as 'SOL' | 'USDC')}
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm"
                >
                  <option value="SOL">SOL</option>
                  <option value="USDC">USDC</option>
                </select>
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Wallet mint limit
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={walletMintLimit}
                  onChange={(e) => setWalletMintLimit(e.target.value)}
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Mint opens (kickoff)
                <input
                  type="datetime-local"
                  value={launchDate}
                  onChange={(e) => setLaunchDate(e.target.value)}
                  className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              {presaleEnabled ? (
                <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Presale redemption starts (optional)
                  <input
                    type="datetime-local"
                    value={presaleStart}
                    onChange={(e) => setPresaleStart(e.target.value)}
                    className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                  />
                </label>
              ) : null}
              {wlEnabled ? (
                <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Whitelist phase starts (optional)
                  <input
                    type="datetime-local"
                    value={wlStart}
                    onChange={(e) => setWlStart(e.target.value)}
                    className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                  />
                </label>
              ) : null}
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Public phase starts (optional)
                <input
                  type="datetime-local"
                  value={publicStart}
                  onChange={(e) => setPublicStart(e.target.value)}
                  className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                <input
                  type="checkbox"
                  checked={presaleEnabled}
                  onChange={(e) => setPresaleEnabled(e.target.checked)}
                  className="h-4 w-4 accent-[#00FF9C]"
                />
                Presale enabled (intent)
              </label>
              <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                <input type="checkbox" checked={wlEnabled} onChange={(e) => setWlEnabled(e.target.checked)} className="h-4 w-4 accent-[#00FF9C]" />
                Whitelist enabled (intent)
              </label>
            </div>
          </CommandCard>
        ) : null}

        {step === 2 ? (
          <CommandCard label="STEP_03 · ASSETS_METADATA">
            <AssetStepForm
              values={assets}
              onChange={setAssets}
              fromGenerator={generatorPrefill}
              expectedSupply={Number(totalSupply) || undefined}
            />
          </CommandCard>
        ) : null}

        {step === 3 ? (
          <CommandCard label="STEP_04 · REVIEW">
            <ul className="space-y-2 font-mono text-xs text-[#9BA8B4]">
              <li>
                <span className="text-[#5C6773]">Name</span> {collectionName || '—'}
              </li>
              <li>
                <span className="text-[#5C6773]">Symbol</span> {symbol || '—'}
              </li>
              <li>
                <span className="text-[#5C6773]">Supply / price</span> {totalSupply} @ {mintPrice} {currency}
              </li>
              <li>
                <span className="text-[#5C6773]">Creator</span> {creatorWallet || '—'}
              </li>
              <li>
                <span className="text-[#5C6773]">Assets path</span> {assets.assets_package_url || '—'}
              </li>
              <li>
                <span className="text-[#5C6773]">Metadata path</span> {assets.metadata_package_url || '—'}
              </li>
              <li>
                <span className="text-[#5C6773]">Generator staging</span>{' '}
                {generatorProjectId ? `project ${generatorProjectId.slice(0, 8)}…` : '—'}
              </li>
            </ul>
            <p className="mt-4 text-xs text-[#5C6773]">Submission saves as PENDING_REVIEW — Owltopia operators approve before any mint infra goes live.</p>
          </CommandCard>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {step > 0 ? (
            <DeployButton type="button" variant="ghost" onClick={back}>
              Back
            </DeployButton>
          ) : null}
          {step < STEPS.length - 1 ? (
            <DeployButton type="button" onClick={next}>
              Continue
            </DeployButton>
          ) : (
            <DeployButton type="button" disabled={status === 'sending'} onClick={() => void submit()}>
              {status === 'sending' ? 'Submitting…' : 'Submit for review'}
            </DeployButton>
          )}
        </div>

        {msg ? (
          <p className={`font-mono text-xs ${status === 'ok' ? 'text-[#00FF9C]' : 'text-[#FF9C9C]'}`}>{msg}</p>
        ) : null}
      </div>
    </OwlCenterShell>
  )
}
