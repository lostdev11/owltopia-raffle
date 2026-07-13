'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'

import { AssetStepForm } from '@/components/owl-center/AssetStepForm'
import { emptyAssetStepValues, type AssetStepValues } from '@/lib/owl-center/asset-step-values'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { FinishedArtZipUpload } from '@/components/owl-center/FinishedArtZipUpload'
import {
  defaultMintDetailsFormValues,
  MintDetailsConfigFields,
} from '@/components/owl-center/MintDetailsConfigFields'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { useOwlCenterView } from '@/components/owl-center/OwlCenterViewProvider'
import { useSiwsSession } from '@/hooks/use-siws-session'
import {
  clearGeneratorHandoffFromSession,
  clearLaunchDraftFromSession,
  readGeneratorProjectIdFromSession,
  readLaunchDraftFromSession,
} from '@/lib/owl-center/generator/launch-draft'
import { clearStagedAssetsHandoffFromSession } from '@/lib/owl-center/generator/staged-assets-handoff'
import { useStagedAssetsPrefill } from '@/lib/owl-center/generator/use-staged-assets-prefill'
import { OWL_CENTER_MAX_LAUNCH_SUPPLY } from '@/lib/owl-center/launch-limits'
import { mintDetailsPayloadFromForm } from '@/lib/owl-center/launch-mint-config'
import {
  formatOwlCenterPlatformMintFeeLabel,
  formatTotalMintCostHint,
} from '@/lib/owl-center/platform-mint-fee'
import { formatRoyaltyPercentLabel, percentToBasisPoints } from '@/lib/owl-center/royalty'
import {
  formatWalletSplitsSummary,
  walletSplitPayloadFromForm,
  walletSplitsValid,
} from '@/lib/owl-center/wallet-splits'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

const STEPS = ['Collection info', 'Supply & pricing', 'Art & images', 'Review & submit'] as const

const emptyAssets = emptyAssetStepValues()

function randomUploadProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function LaunchSubmissionWizard() {
  const searchParams = useSearchParams()
  const fromGenerator = searchParams.get('from') === 'generator'
  const { isLaunchpadPartner, showAdminFeatures } = useOwlCenterView()
  const { sessionWallet } = useSiwsSession()
  // Partners get plain-language copy; admins keep the operator view.
  const plainMode = !showAdminFeatures

  const [generatorPrefill, setGeneratorPrefill] = useState(false)
  const [generatorProjectId, setGeneratorProjectId] = useState<string | null>(null)
  const [uploadProjectId] = useState(randomUploadProjectId)
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

  // Partners always submit with their signed-in wallet.
  useEffect(() => {
    if (!sessionWallet) return
    if (isLaunchpadPartner || !creatorWallet.trim()) {
      setCreatorWallet(sessionWallet)
    }
  }, [sessionWallet, isLaunchpadPartner]) // eslint-disable-line react-hooks/exhaustive-deps -- prefill only when session appears

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

  const stepError = useMemo<string | null>(() => {
    if (step === 0) {
      if (!collectionName.trim()) return 'Give your collection a name.'
      if (collectionName.trim().length > 120) return 'Collection name must be 120 characters or fewer.'
      if (!symbol.trim()) return 'Add a short symbol (ticker) for your collection — e.g. OWL.'
      if (symbol.trim().length > 16) return 'Symbol must be 16 characters or fewer.'
      if (!creatorWallet.trim()) return 'Add your Solana creator wallet address.'
      if (!normalizeSolanaWalletAddress(creatorWallet)) {
        return 'That does not look like a valid Solana wallet address — double-check and paste it again.'
      }
      return null
    }
    if (step === 1) {
      const supply = Number(totalSupply)
      if (!Number.isInteger(supply) || supply < 1) return 'Total supply must be a whole number of at least 1.'
      if (supply > OWL_CENTER_MAX_LAUNCH_SUPPLY) {
        return `Collections are capped at ${OWL_CENTER_MAX_LAUNCH_SUPPLY.toLocaleString('en-US')} NFTs.`
      }
      const price = Number(mintDetails.public_price)
      if (!Number.isFinite(price) || price < 0) return 'Public mint price cannot be negative.'
      if (!walletSplitsValid(mintDetails.royalty_splits)) {
        return 'Royalty split needs valid wallet addresses with shares that total 100%.'
      }
      if (!walletSplitsValid(mintDetails.mint_fund_splits)) {
        return 'Mint funds split needs valid wallet addresses with shares that total 100%.'
      }
      return null
    }
    return null
  }, [step, collectionName, symbol, creatorWallet, totalSupply, mintDetails])

  function next() {
    if (stepError) {
      setMsg(stepError)
      return
    }
    setMsg(null)
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }
  function back() {
    setMsg(null)
    setStep((s) => Math.max(s - 1, 0))
  }
  function goToStep(i: number) {
    // Moving forward requires the current step to be valid; going back is always fine.
    if (i > step && stepError) {
      setMsg(stepError)
      return
    }
    setMsg(null)
    setStep(i)
  }

  async function submit() {
    if (stepError) {
      setMsg(stepError)
      return
    }
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
      if (!res.ok) throw new Error(j.error || 'Submission failed — try again.')
      setStatus('ok')
      clearGeneratorHandoffFromSession()
      clearStagedAssetsHandoffFromSession()
    } catch (e) {
      setStatus('err')
      setMsg(e instanceof Error ? e.message : 'Submission failed — try again.')
    }
  }

  if (status === 'ok') {
    return (
      <OwlCenterShell
        eyebrow="OWL_CENTER // SUBMITTED"
        title="Collection submitted"
        subtitle="Your launch is in the review queue."
      >
        <div className="grid max-w-xl gap-6 border border-[#1A222B] bg-[#10161C]/85 p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[#00FF9C]" aria-hidden />
            <div>
              <p className="text-base text-[#F4FBF8]">
                <strong className="font-bold">{collectionName.trim() || 'Your collection'}</strong> is submitted for
                review.
              </p>
              <p className="mt-1 text-sm text-[#9BA8B4]">Here is what happens next:</p>
            </div>
          </div>
          <ol className="grid gap-3 border border-[#1A222B] bg-[#0F1419]/60 p-4 text-sm text-[#C5D0D8]">
            <li>
              <span className="font-bold text-[#00FF9C]">1.</span> The Owltopia team reviews your collection details
              and art.
            </li>
            <li>
              <span className="font-bold text-[#00FF9C]">2.</span> We prepare permanent storage and set up the
              on-chain mint for you — nothing else for you to configure.
            </li>
            <li>
              <span className="font-bold text-[#00FF9C]">3.</span> Once approved, your mint page goes live and appears
              in <strong className="font-normal text-[#EAFBF4]">My Launches</strong>, where you can track mints and
              manage details.
            </li>
          </ol>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/owl-center/my-launches"
              className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-6 font-bold uppercase tracking-wide text-[#E8FDF4] hover:bg-[#00FF9C]/18"
            >
              Go to My Launches
            </Link>
            <Link
              href="/owl-center"
              className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#1A222B] px-6 text-sm text-[#9BA8B4] hover:border-[#00FF9C]/35 hover:text-[#00FF9C]"
            >
              Back to Owl Center
            </Link>
          </div>
        </div>
      </OwlCenterShell>
    )
  }

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // INTAKE"
      title="Submit your collection"
      subtitle={
        plainMode
          ? 'Four quick steps. Our team reviews every submission before anything goes live — we handle storage and on-chain setup for you.'
          : 'Review queue intake. Sign in with your admin or partner wallet — the session wallet is bound as creator for partners.'
      }
    >
      {generatorPrefill ? (
        <p className="mb-6 rounded border border-[#00FF9C]/30 bg-[#00FF9C]/8 px-4 py-3 text-sm text-[#C5D0D8]">
          Prefilled from <strong className="font-normal text-[#EAFBF4]">Owl Generator</strong> — your export carries
          over, including image and metadata counts. Add your logo and banner in step 3.
        </p>
      ) : null}
      <nav className="mb-8 font-mono text-xs uppercase tracking-widest text-[#5C6773]">
        {STEPS.map((label, i) => (
          <span key={label}>
            {i > 0 ? <span className="mx-2 text-[#1A222B]">/</span> : null}
            <button
              type="button"
              onClick={() => goToStep(i)}
              className={`touch-manipulation ${i === step ? 'text-[#00FF9C]' : 'text-[#7D8A93] hover:text-[#C5D0D8]'}`}
            >
              {i + 1}. {label}
            </button>
          </span>
        ))}
      </nav>

      <div className="grid max-w-xl gap-6 border border-[#1A222B] bg-[#10161C]/85 p-6">
        {step === 0 ? (
          <CommandCard label="STEP 1 · COLLECTION INFO">
            <div className="grid gap-4">
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Collection name
                <input
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  required
                  maxLength={120}
                  placeholder="e.g. Night Owls"
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Symbol (short ticker)
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  required
                  maxLength={16}
                  placeholder="e.g. NOWL"
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Tell collectors what your project is about."
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Creator wallet (Solana)
                <input
                  value={creatorWallet}
                  onChange={(e) => setCreatorWallet(e.target.value)}
                  required
                  readOnly={isLaunchpadPartner && !!sessionWallet}
                  className={`border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8] ${
                    isLaunchpadPartner && sessionWallet ? 'opacity-70' : ''
                  }`}
                />
              </label>
              <p className="font-mono text-[10px] leading-relaxed text-[#5C6773]">
                {isLaunchpadPartner && sessionWallet
                  ? 'This is the wallet you signed in with — your collection is tied to it.'
                  : 'Royalty and mint fund splits are configured in the next step. Default is 100% to this wallet.'}
              </p>
            </div>
          </CommandCard>
        ) : null}

        {step === 1 ? (
          <CommandCard label="STEP 2 · SUPPLY & PRICING">
            <div className="grid gap-4">
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Total supply (how many NFTs)
                <input
                  type="number"
                  min={1}
                  max={OWL_CENTER_MAX_LAUNCH_SUPPLY}
                  value={totalSupply}
                  onChange={(e) => {
                    setTotalSupply(e.target.value)
                    setMintDetails((m) => ({ ...m, total_supply: e.target.value }))
                  }}
                  required
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <p className="font-mono text-[10px] text-[#5C6773]">
                Up to {OWL_CENTER_MAX_LAUNCH_SUPPLY.toLocaleString('en-US')} NFTs per collection.
              </p>
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
          <CommandCard label="STEP 3 · ART & IMAGES">
            <div className="grid gap-4">
              {!generatorPrefill ? (
                <FinishedArtZipUpload
                  projectId={generatorProjectId ?? uploadProjectId}
                  onStaged={() => {
                    if (!generatorProjectId) setGeneratorProjectId(uploadProjectId)
                    void stagedPrefill.refresh()
                  }}
                />
              ) : null}
              <AssetStepForm
                values={assets}
                onChange={setAssets}
                fromGenerator={generatorPrefill}
                expectedSupply={Number(totalSupply) || undefined}
                generatorProjectId={generatorProjectId}
                stagedJob={stagedPrefill.job}
                stagedLoading={stagedPrefill.loading}
                onRefreshStaged={() => void stagedPrefill.refresh()}
                plainMode={plainMode}
              />
            </div>
          </CommandCard>
        ) : null}

        {step === 3 ? (
          <CommandCard label="STEP 4 · REVIEW & SUBMIT">
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
                <span className="text-[#5C6773]">Creator</span> {creatorWallet || '—'}
              </li>
              <li>
                <span className="text-[#5C6773]">Art</span>{' '}
                {stagedPrefill.job
                  ? `Uploaded — ${stagedPrefill.job.original_filename ?? 'ZIP staged'}`
                  : assets.assets_package_url
                    ? assets.assets_package_url
                    : generatorProjectId
                      ? `Generator project ${generatorProjectId.slice(0, 8)}…`
                      : 'Not uploaded yet — you can send it to us after submitting'}
              </li>
            </ul>

            <div className="mt-4 grid gap-2 border border-[#1A222B] bg-[#0F1419]/60 p-4">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">Fees</p>
              <p className="text-xs leading-relaxed text-[#9BA8B4]">
                Minters pay your mint price plus {formatOwlCenterPlatformMintFeeLabel().toLowerCase()} and standard
                Solana network fees. Mint proceeds go to your mint funds split above — there is no upfront cost to
                submit.
              </p>
            </div>

            <p className="mt-4 text-xs text-[#5C6773]">
              Submitting sends your collection to the Owltopia team for review. Nothing goes on-chain until we approve
              your launch.
            </p>
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

        {msg ? <p className="font-mono text-xs text-[#FF9C9C]">{msg}</p> : null}
      </div>
    </OwlCenterShell>
  )
}
