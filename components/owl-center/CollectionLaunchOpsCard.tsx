'use client'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { AdminCoreCollectionThawPanel } from '@/components/admin/AdminCoreCollectionThawPanel'
import { CreatorDeleteLaunchPanel } from '@/components/owl-center/CreatorDeleteLaunchPanel'
import { CreatorLaunchSetupChecklist } from '@/components/owl-center/CreatorLaunchSetupChecklist'
import { CreatorWlWalletsPanel } from '@/components/owl-center/CreatorWlWalletsPanel'
import { LaunchMintConfigPanel } from '@/components/owl-center/LaunchMintConfigPanel'
import { LaunchPresaleOveragePanel } from '@/components/owl-center/LaunchPresaleOveragePanel'
import { MarketplaceReadinessPanel } from '@/components/owl-center/MarketplaceReadinessPanel'
import { MetadataRefreshPanel } from '@/components/owl-center/MetadataRefreshPanel'
import { MintShareLinkPanel } from '@/components/owl-center/MintShareLinkPanel'
import { RevealDayPanel } from '@/components/owl-center/RevealDayPanel'
import {
  creatorCoreThawApiPath,
  creatorHashListApiPath,
  creatorMarketplaceApiPath,
  creatorMetadataRefreshApiPath,
  creatorMintConfigApiPath,
  creatorRevealDayApiPath,
} from '@/lib/owl-center/creator-api-paths'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type Props = {
  launchId: string
  launch: OwlCenterLaunchPublic
  /** Card header; defaults to status · phase. */
  label?: string
  onSaved?: () => void
  /** Creator mint-config PATCH path; omit for admin default. */
  saveApiPath?: string
  /** Creator metadata refresh GET/POST path; omit for admin default. */
  metadataApiPath?: string
  /** Creator reveal day GET/POST path; omit for admin default. */
  revealDayApiPath?: string
  /** Creator Core thaw path; omit for admin default thaw API. */
  coreThawApiPath?: string
  /** Guided launch checklist (Phase A). Default on. */
  showSetupChecklist?: boolean
  showMintConfig?: boolean
  /** Partner / creator whitelist wallet list (Manage collection). */
  showWlWallets?: boolean
  showCoreThaw?: boolean
  showMarketplace?: boolean
  showPresaleOverage?: boolean
  marketplaceCompact?: boolean
  marketplaceCreatorMode?: boolean
  marketplaceApiPath?: string
  hashListApiPath?: string
  /** Creator-only delete section at bottom of card. */
  deletable?: boolean
  redirectAfterDelete?: string
  className?: string
}

export function CollectionLaunchOpsCard({
  launchId,
  launch,
  label,
  onSaved,
  saveApiPath,
  metadataApiPath,
  revealDayApiPath,
  coreThawApiPath,
  showSetupChecklist = true,
  showMintConfig = true,
  showWlWallets = true,
  showCoreThaw = true,
  showMarketplace = true,
  showPresaleOverage = false,
  marketplaceCompact = false,
  marketplaceCreatorMode = false,
  marketplaceApiPath,
  hashListApiPath,
  deletable = false,
  redirectAfterDelete,
  className,
}: Props) {
  const cardLabel = label ?? `${launch.status} · ${launch.active_phase}`

  return (
    <CommandCard label={cardLabel} id="launch-ops" className={className}>
      {showSetupChecklist ? (
        <CreatorLaunchSetupChecklist launchId={launchId} launch={launch} />
      ) : null}

      {launch.slug ? (
        <MintShareLinkPanel
          embedded
          first={!showSetupChecklist}
          anchorId="mint-share-link"
          slug={launch.slug}
          collectionName={launch.name}
        />
      ) : null}

      {showMintConfig ? (
        <LaunchMintConfigPanel
          embedded
          launchId={launchId}
          launch={launch}
          saveApiPath={saveApiPath}
          onSaved={onSaved}
        />
      ) : null}

      {showWlWallets ? (
        <CreatorWlWalletsPanel embedded launchId={launchId} launch={launch} />
      ) : null}

      {showCoreThaw ? (
        <AdminCoreCollectionThawPanel
          embedded
          launch={launch}
          apiPath={coreThawApiPath}
          onChanged={onSaved}
        />
      ) : null}

      <RevealDayPanel
        embedded
        launchId={launchId}
        launch={launch}
        anchorId="reveal-day"
        apiPath={revealDayApiPath}
      />

      {launch.minted_count > 0 ? (
        <MetadataRefreshPanel
          embedded
          launchId={launchId}
          anchorId="metadata-refresh"
          apiPath={metadataApiPath}
        />
      ) : null}

      {showMarketplace ? (
        <MarketplaceReadinessPanel
          embedded
          compact={marketplaceCompact}
          creatorMode={marketplaceCreatorMode}
          marketplaceApiPath={marketplaceApiPath}
          hashListApiPath={hashListApiPath}
          launchId={launchId}
          launch={launch}
          onSaved={onSaved}
        />
      ) : null}

      {showPresaleOverage ? <LaunchPresaleOveragePanel embedded launchId={launchId} launch={launch} /> : null}

      {deletable ? (
        <CreatorDeleteLaunchPanel
          embedded
          launchId={launchId}
          launchName={launch.name}
          redirectAfterDelete={redirectAfterDelete}
        />
      ) : null}
    </CommandCard>
  )
}

/** Creator My Launches mint-details page paths. */
export function creatorLaunchOpsCardProps(launchId: string, launch: OwlCenterLaunchPublic) {
  return {
    launchId,
    launch,
    saveApiPath: creatorMintConfigApiPath(launchId),
    metadataApiPath: creatorMetadataRefreshApiPath(launchId),
    revealDayApiPath: creatorRevealDayApiPath(launchId),
    marketplaceApiPath: creatorMarketplaceApiPath(launchId),
    hashListApiPath: creatorHashListApiPath(launchId),
    coreThawApiPath: creatorCoreThawApiPath(launchId),
    marketplaceCreatorMode: true,
    showSetupChecklist: true,
  }
}
