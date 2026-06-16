'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { AssetStepForm } from '@/components/owl-center/AssetStepForm'
import { emptyAssetStepValues, type AssetStepValues } from '@/lib/owl-center/asset-step-values'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import {
  defaultMintDetailsFormValues,
  MintDetailsConfigFields,
} from '@/components/owl-center/MintDetailsConfigFields'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import {
  clearGeneratorHandoffFromSession,
  clearLaunchDraftFromSession,
  readGeneratorProjectIdFromSession,
  readLaunchDraftFromSession,
} from '@/lib/owl-center/generator/launch-draft'
import { clearStagedAssetsHandoffFromSession } from '@/lib/owl-center/generator/staged-assets-handoff'
import { useStagedAssetsPrefill } from '@/lib/owl-center/generator/use-staged-assets-prefill'
import { mintDetailsPayloadFromForm } from '@/lib/owl-center/launch-mint-config'
import {
  formatOwlCenterPlatformMintFeeLabel,
  formatTotalMintCostHint,
} from '@/lib/owl-center/platform-mint-fee'
import { formatRoyaltyPercentLabel, percentToBasisPoints } from '@/lib/owl-center/royalty'
import { formatWalletSplitsSummary, walletSplitPayloadFromForm } from '@/lib/owl-center/wallet-splits'

const STEPS = ['Collection info', 'Supply & mint', 'Assets & metadata', 'Review'] as const

const emptyAssets = emptyAssetStepValues()

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

  const [totalSupply, setTotalSupply] = useState('1000')
  const [mintDetails, setMintDetails] = useState(() => defaultMintDetailsFormValues())

  const [assets, setAssets] = useState<AssetStepValues>(emptyAssets)

  const stagedPrefill = useStagedAssetsPrefill(generatorProjectId, assets, setAssets)

  useEffect(() => {
    if (!fromGenerator) {
      const sessionProjectId = readGeneratorProjectIdFromSession()
      if (sessionProjectId) setGeneratorProjectId(sessionProjectId)
      return
    }
    const draft = readLaunchDraftFromSession()
    if (!draft) return
    setCollectionName(draft.collection_name)
    setSymbol(draft.symbol)
    setDescription(draft.description)
    setTotalSupply(draft.total_supply)
    setMintDetails((m) => ({ ...m, total_supply: draft.total_supply }))
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
        ...mintDetailsPayloadFromForm({ ...mintDetails, total_supply: totalSupply }),
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
      clearStagedAssetsHandoffFromSession()
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
          Prefilled from <strong className="font-normal text-[#EAFBF4]">Owl Generator</strong> — step 3 auto-fills image
          and metadata counts when you stage your Sugar ZIP in the generator. Upload logo and banner below (URLs are
          created automatically). Package paths are added after Phase B Arweave upload in admin.
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
              <p className="font-mono text-[10px] leading-relaxed text-[#5C6773]">
                Royalty and mint fund splits are configured in the next step. Default is 100% to this wallet.
              </p>
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
                  onChange={(e) => {
                    setTotalSupply(e.target.value)
                    setMintDetails((m) => ({ ...m, total_supply: e.target.value }))
                  }}
                  required
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <MintDetailsConfigFields
                values={{ ...mintDetails, total_supply: totalSupply }}
                defaultWallet={creatorWallet.trim()}
                onChange={(next) => {
                  setMintDetails(next)
                  setTotalSupply(next.total_supply)
                }}
              />
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
              generatorProjectId={generatorProjectId}
              stagedJob={stagedPrefill.job}
              stagedLoading={stagedPrefill.loading}
              onRefreshStaged={() => void stagedPrefill.refresh()}
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
                <span className="text-[#5C6773]">Supply / price</span> {totalSupply} @{' '}
                {formatTotalMintCostHint(Number(mintDetails.public_price) || 0, mintDetails.currency)}
              </li>
              <li>
                <span className="text-[#5C6773]">Secondary royalty</span>{' '}
                {formatRoyaltyPercentLabel(percentToBasisPoints(Number(mintDetails.royalty_percent) || 5))}
              </li>
              <li>
                <span className="text-[#5C6773]">Royalty split</span>{' '}
                {formatWalletSplitsSummary(walletSplitPayloadFromForm(mintDetails.royalty_splits) ?? null)}
              </li>
              <li>
                <span className="text-[#5C6773]">Mint funds split</span>{' '}
                {formatWalletSplitsSummary(walletSplitPayloadFromForm(mintDetails.mint_fund_splits) ?? null)}
              </li>
              <li>
                <span className="text-[#5C6773]">Platform fee</span> {formatOwlCenterPlatformMintFeeLabel()}
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
