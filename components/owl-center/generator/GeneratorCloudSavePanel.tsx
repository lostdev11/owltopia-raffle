'use client'

import { Cloud, CloudOff, Loader2 } from 'lucide-react'
import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { Gen2PresaleSignInPrompt } from '@/components/gen2-presale/Gen2PresaleSignInPrompt'
import type { GeneratorProject } from '@/lib/owl-center/generator/types'
import { cn } from '@/lib/utils'

type Props = {
  project: GeneratorProject
  cloudUpdatedAt: string | null
  cloudBusy: boolean
  cloudError: string | null
  signedIn: boolean | null
  onSaveCloud: () => void
  onLoadCloud: () => void
  onCheckSession: () => void
}

export function GeneratorCloudSavePanel({
  project,
  cloudUpdatedAt,
  cloudBusy,
  cloudError,
  signedIn,
  onSaveCloud,
  onLoadCloud,
  onCheckSession,
}: Props) {
  const { connected } = useWallet()

  return (
    <CommandCard label="CLOUD // wallet save">
      <p className="text-sm text-[#9BA8B4]">
        Sync this project to your wallet in Supabase. Local browser copy still auto-saves.
      </p>

      {!connected ? (
        <p className="mt-3 text-sm text-amber-400/90">Connect wallet to enable cloud save.</p>
      ) : signedIn === false ? (
        <Gen2PresaleSignInPrompt
          className="mt-4"
          title="Sign in to save to cloud"
          message="One-time wallet signature — same as presale. Required for cloud sync on mobile."
          onSignedIn={onCheckSession}
        />
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 text-xs text-[#9BA8B4]">
            {signedIn ? (
              <Cloud className="h-4 w-4 text-[#00FF9C]" aria-hidden />
            ) : (
              <CloudOff className="h-4 w-4" aria-hidden />
            )}
            {cloudUpdatedAt ? (
              <span>Cloud saved {new Date(cloudUpdatedAt).toLocaleString()}</span>
            ) : (
              <span>No cloud copy yet</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <DeployButton
              className="gap-2"
              disabled={cloudBusy || signedIn !== true}
              onClick={onSaveCloud}
            >
              {cloudBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Save to cloud
            </DeployButton>
            <DeployButton variant="ghost" disabled={cloudBusy || signedIn !== true} onClick={onLoadCloud}>
              Load from cloud
            </DeployButton>
          </div>
        </div>
      )}

      {cloudError ? (
        <p className={cn('mt-3 text-sm', cloudError.includes('413') ? 'text-amber-400' : 'text-red-400')}>
          {cloudError}
        </p>
      ) : null}

      <p className="mt-3 font-mono text-[10px] leading-relaxed text-[#5C6773]">
        Project: {project.name} · {project.traits.length} layer(s) · updated{' '}
        {new Date(project.updatedAt).toLocaleString()}
      </p>
    </CommandCard>
  )
}
