import 'server-only'

import {
  getLatestAssetUploadJobForLaunch,
  updateAssetUploadJob,
} from '@/lib/db/owl-center-asset-upload-job'
import { ensureMarketplaceRow, syncLaunchMarketplaceFieldsFromRow, upsertMarketplaceReadinessForLaunch } from '@/lib/db/owl-center-marketplace'
import { getOwlCenterLaunchByIdAdmin, updateOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { promoteLaunchToLive, type PromoteLaunchResult } from '@/lib/owl-center/launch-go-live'
import type { AssetUploadProgress } from '@/lib/owl-center/asset-upload-types'
import {
  buildSugarDeployPackageFromJob,
} from '@/lib/owl-center/sugar-deploy-package'
import {
  parseOnchainDeployState,
  configLinesFullyLoaded,
  type OnchainDeployState,
} from '@/lib/owl-center/onchain-deploy-state'
import {
  deployPublicSimpleCandyMachineOnchain,
  isOwlCenterOnchainCmDeployEnabled,
  OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY,
} from '@/lib/owl-center/sugar-deploy-onchain'
import { owlCenterCoreServerCmDeployMaxSupply } from '@/lib/owl-center/cm-deploy-limits'
import {
  handOffCoreCollectionUpdateAuthority,
  isOwlCenterCreatorUaHandoffEnabled,
} from '@/lib/owl-center/core-collection-ua-handoff'
import {
  createIrysDeployerCoreUmi,
  createPublicSimpleCoreCandyMachineShell,
  finishCoreDeployAuthorityHandoff,
  loadCoreCandyMachineConfigLines,
} from '@/lib/owl-center/core-cm-deploy-onchain'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isValidSolanaPubkey, sanitizeLaunchMintPubkey, validateSolanaPubkeyInput } from '@/lib/solana/validate-pubkey'

export type SugarDeployGoLiveSummary = {
  ok: boolean
  already_live?: boolean
  blockers?: string[]
}

export type SugarDeployWorkerResult =
  | {
      ok: true
      candy_machine_id: string
      collection_mint: string
      candy_guard_id: string
      already_deployed?: boolean
      go_live?: SugarDeployGoLiveSummary
      /** True when Core config lines still need another server invoke. */
      continue_loading?: boolean
      config_lines_loaded?: number
      config_lines_total?: number
    }
  | {
      ok: false
      error: string
      code?: string
      continue_loading?: boolean
      config_lines_loaded?: number
      config_lines_total?: number
      candy_machine_id?: string
      collection_mint?: string
      candy_guard_id?: string
    }

function emptyDeployPatch(
  patch: Partial<OnchainDeployState> & Pick<OnchainDeployState, 'status'>
): OnchainDeployState {
  return {
    status: patch.status,
    candy_machine_id: patch.candy_machine_id ?? null,
    collection_mint: patch.collection_mint ?? null,
    candy_guard_id: patch.candy_guard_id ?? null,
    onchain_update_authority: patch.onchain_update_authority ?? null,
    platform_update_delegate: patch.platform_update_delegate ?? null,
    config_lines_loaded: patch.config_lines_loaded ?? null,
    config_lines_total: patch.config_lines_total ?? null,
    error: patch.error ?? null,
    completed_at: patch.completed_at ?? null,
  }
}

function withDeployState(progress: AssetUploadProgress, patch: OnchainDeployState): AssetUploadProgress {
  return { ...progress, onchain_deploy: patch } as AssetUploadProgress
}

export async function getSugarDeployStatusForLaunch(launchId: string) {
  const [launch, job, marketplace] = await Promise.all([
    getOwlCenterLaunchByIdAdmin(launchId),
    getLatestAssetUploadJobForLaunch(launchId),
    ensureMarketplaceRow(launchId),
  ])

  const deployState = job ? parseOnchainDeployState(job.upload_progress) : null
  const marketplaceCm = sanitizeLaunchMintPubkey(marketplace?.candy_machine_id)
  const marketplaceCol = sanitizeLaunchMintPubkey(marketplace?.collection_mint)
  const deployCm = sanitizeLaunchMintPubkey(deployState?.candy_machine_id)
  const deployCol = sanitizeLaunchMintPubkey(deployState?.collection_mint)

  const fullyDeployed =
    Boolean(marketplaceCm && marketplaceCol) || deployState?.status === 'completed'

  const cmId = marketplaceCm || (fullyDeployed ? deployCm : null) || null
  const colMint = marketplaceCol || (fullyDeployed ? deployCol : null) || null

  const isCore = launch?.mint_standard === 'core'
  const serverMax = isCore ? owlCenterCoreServerCmDeployMaxSupply() : OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY

  let configLineCount: number | null = null
  if (job && launch && job.status === 'completed') {
    try {
      configLineCount = buildSugarDeployPackageFromJob(job, launch).configLines.length
    } catch {
      configLineCount = launch.total_supply ?? null
    }
  }

  const loadingInProgress =
    deployState?.status === 'loading_items' ||
    (deployState?.status === 'failed' &&
      Boolean(deployCm && deployCol) &&
      deployState.config_lines_total != null &&
      (deployState.config_lines_loaded ?? 0) < deployState.config_lines_total)

  const handoffPending =
    Boolean(launch) &&
    isCore &&
    isOwlCenterCreatorUaHandoffEnabled() &&
    job?.status === 'completed' &&
    Boolean(deployCm && deployCol) &&
    configLinesFullyLoaded(deployState) &&
    (deployState?.status === 'cm_ready' ||
      (deployState?.status === 'failed' && Boolean(deployState.candy_machine_id && deployState.collection_mint)))

  const canContinueLoading =
    Boolean(launch) &&
    launch!.mint_mode === 'public_simple' &&
    isCore &&
    job?.status === 'completed' &&
    loadingInProgress &&
    deployState?.status !== 'running' &&
    isOwlCenterOnchainCmDeployEnabled()

  const overTmCap =
    !isCore &&
    configLineCount != null &&
    configLineCount > OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY

  return {
    launch,
    job,
    marketplace,
    deploy_state: deployState,
    candy_machine_id: cmId,
    collection_mint: colMint,
    in_progress_candy_machine_id: !fullyDeployed ? deployCm : null,
    in_progress_collection_mint: !fullyDeployed ? deployCol : null,
    onchain_deploy_enabled: isOwlCenterOnchainCmDeployEnabled(),
    server_deploy_max_supply: serverMax,
    tm_server_deploy_max_supply: OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY,
    config_line_count: configLineCount,
    over_server_cap: overTmCap,
    arweave_ready: job?.status === 'completed',
    mint_standard: launch?.mint_standard ?? null,
    creator_wallet: launch?.creator_wallet ?? null,
    fully_deployed: fullyDeployed,
    can_deploy:
      Boolean(launch) &&
      launch!.mint_mode === 'public_simple' &&
      job?.status === 'completed' &&
      !fullyDeployed &&
      !loadingInProgress &&
      !handoffPending &&
      deployState?.status !== 'running' &&
      !overTmCap &&
      isOwlCenterOnchainCmDeployEnabled(),
    can_continue_loading: canContinueLoading,
    can_retry_handoff: handoffPending && deployState?.status !== 'running' && !loadingInProgress,
  }
}

async function completeCoreDeployAfterLines(params: {
  launchId: string
  jobId: string
  launch: NonNullable<Awaited<ReturnType<typeof getOwlCenterLaunchByIdAdmin>>>
  progress: AssetUploadProgress
  candyMachineId: string
  collectionMint: string
  candyGuardId: string
  configLinesLoaded: number
  configLinesTotal: number
}): Promise<SugarDeployWorkerResult> {
  const {
    launchId,
    jobId,
    launch,
    progress,
    candyMachineId,
    collectionMint,
    candyGuardId,
    configLinesLoaded,
    configLinesTotal,
  } = params

  if (!isOwlCenterCreatorUaHandoffEnabled()) {
    const completedAt = new Date().toISOString()
    await updateAssetUploadJob(jobId, {
      upload_progress: withDeployState(
        progress,
        emptyDeployPatch({
          status: 'completed',
          candy_machine_id: candyMachineId,
          collection_mint: collectionMint,
          candy_guard_id: candyGuardId,
          config_lines_loaded: configLinesLoaded,
          config_lines_total: configLinesTotal,
          completed_at: completedAt,
        })
      ),
    })
    const go_live = await persistDeployIds(launchId, jobId, candyMachineId, collectionMint, candyGuardId)
    return {
      ok: true,
      candy_machine_id: candyMachineId,
      collection_mint: collectionMint,
      candy_guard_id: candyGuardId,
      go_live,
      config_lines_loaded: configLinesLoaded,
      config_lines_total: configLinesTotal,
    }
  }

  const creatorWallet = launch.creator_wallet?.trim()
  if (!creatorWallet) {
    await updateAssetUploadJob(jobId, {
      upload_progress: withDeployState(
        progress,
        emptyDeployPatch({
          status: 'cm_ready',
          candy_machine_id: candyMachineId,
          collection_mint: collectionMint,
          candy_guard_id: candyGuardId,
          config_lines_loaded: configLinesLoaded,
          config_lines_total: configLinesTotal,
          error: 'creator_wallet is required to finish Core update-authority handoff.',
          completed_at: new Date().toISOString(),
        })
      ),
    })
    return {
      ok: false,
      error: 'creator_wallet is required to finish Core update-authority handoff.',
      code: 'missing_creator',
      candy_machine_id: candyMachineId,
      collection_mint: collectionMint,
      candy_guard_id: candyGuardId,
      config_lines_loaded: configLinesLoaded,
      config_lines_total: configLinesTotal,
    }
  }

  await updateAssetUploadJob(jobId, {
    upload_progress: withDeployState(
      progress,
      emptyDeployPatch({
        status: 'cm_ready',
        candy_machine_id: candyMachineId,
        collection_mint: collectionMint,
        candy_guard_id: candyGuardId,
        config_lines_loaded: configLinesLoaded,
        config_lines_total: configLinesTotal,
      })
    ),
  })

  const network = resolveLaunchMintNetwork(launch)
  const handoff = await finishCoreDeployAuthorityHandoff({
    network,
    collectionMint,
    candyMachineId,
    candyGuardId,
    creatorWallet,
  })

  if (!handoff.ok) {
    await updateAssetUploadJob(jobId, {
      upload_progress: withDeployState(
        progress,
        emptyDeployPatch({
          status: 'cm_ready',
          candy_machine_id: candyMachineId,
          collection_mint: collectionMint,
          candy_guard_id: candyGuardId,
          config_lines_loaded: configLinesLoaded,
          config_lines_total: configLinesTotal,
          error: handoff.error,
          completed_at: new Date().toISOString(),
        })
      ),
    })
    return { ok: false, error: handoff.error, code: 'ua_handoff_pending' }
  }

  await updateOwlCenterLaunchByIdAdmin(launchId, {
    onchain_update_authority: handoff.onchainUpdateAuthority ?? null,
    platform_update_delegate: handoff.platformUpdateDelegate ?? null,
  })

  const completedAt = new Date().toISOString()
  await updateAssetUploadJob(jobId, {
    upload_progress: withDeployState(
      progress,
      emptyDeployPatch({
        status: 'completed',
        candy_machine_id: candyMachineId,
        collection_mint: collectionMint,
        candy_guard_id: candyGuardId,
        onchain_update_authority: handoff.onchainUpdateAuthority ?? null,
        platform_update_delegate: handoff.platformUpdateDelegate ?? null,
        config_lines_loaded: configLinesLoaded,
        config_lines_total: configLinesTotal,
        completed_at: completedAt,
      })
    ),
  })

  const go_live = await persistDeployIds(launchId, jobId, candyMachineId, collectionMint, candyGuardId)
  return {
    ok: true,
    candy_machine_id: candyMachineId,
    collection_mint: collectionMint,
    candy_guard_id: candyGuardId,
    go_live,
    config_lines_loaded: configLinesLoaded,
    config_lines_total: configLinesTotal,
  }
}

async function runCoreResumableDeploy(
  launchId: string,
  launch: NonNullable<Awaited<ReturnType<typeof getOwlCenterLaunchByIdAdmin>>>,
  job: NonNullable<Awaited<ReturnType<typeof getLatestAssetUploadJobForLaunch>>>,
  existing: OnchainDeployState | null
): Promise<SugarDeployWorkerResult> {
  const pkg = buildSugarDeployPackageFromJob(job, launch)
  if (!pkg.collectionMetadataUri) {
    return { ok: false, error: 'Missing collection metadata on Arweave (assets/collection.json).', code: 'missing_collection_meta' }
  }

  const network = resolveLaunchMintNetwork(launch)
  let candyMachineId = existing?.candy_machine_id
  let collectionMint = existing?.collection_mint
  let candyGuardId = existing?.candy_guard_id
  let loadedSoFar = existing?.config_lines_loaded ?? 0

  const shouldResumeLoad =
    existing &&
    (existing.status === 'loading_items' ||
      (existing.status === 'failed' &&
        existing.config_lines_total != null &&
        (existing.config_lines_loaded ?? 0) < existing.config_lines_total)) &&
    candyMachineId &&
    collectionMint &&
    candyGuardId &&
    isValidSolanaPubkey(candyMachineId) &&
    isValidSolanaPubkey(collectionMint)

  if (!shouldResumeLoad) {
    await updateAssetUploadJob(job.id, {
      upload_progress: withDeployState(
        job.upload_progress,
        emptyDeployPatch({ status: 'running' })
      ),
    })

    const created = await createPublicSimpleCoreCandyMachineShell({
      launch,
      configLines: pkg.configLines,
      collectionMetadataUri: pkg.collectionMetadataUri,
      collectionName: launch.name,
    })

    if (!created.ok) {
      await updateAssetUploadJob(job.id, {
        upload_progress: withDeployState(
          job.upload_progress,
          emptyDeployPatch({
            status: 'failed',
            error: created.error,
            completed_at: new Date().toISOString(),
          })
        ),
      })
      return { ok: false, error: created.error, code: 'deploy_failed' }
    }

    candyMachineId = created.candyMachineId
    collectionMint = created.collectionMint
    candyGuardId = created.candyGuardId
    loadedSoFar = 0

    await updateAssetUploadJob(job.id, {
      upload_progress: withDeployState(
        job.upload_progress,
        emptyDeployPatch({
          status: 'loading_items',
          candy_machine_id: candyMachineId,
          collection_mint: collectionMint,
          candy_guard_id: candyGuardId,
          config_lines_loaded: 0,
          config_lines_total: created.configLinesTotal,
        })
      ),
    })
  } else {
    await updateAssetUploadJob(job.id, {
      upload_progress: withDeployState(
        job.upload_progress,
        emptyDeployPatch({
          status: 'loading_items',
          candy_machine_id: candyMachineId!,
          collection_mint: collectionMint!,
          candy_guard_id: candyGuardId!,
          config_lines_loaded: loadedSoFar,
          config_lines_total: pkg.configLines.length,
          error: null,
        })
      ),
    })
  }

  const load = await loadCoreCandyMachineConfigLines({
    network,
    candyMachineId: candyMachineId!,
    collectionMint: collectionMint!,
    candyGuardId: candyGuardId!,
    configLines: pkg.configLines,
    startIndex: loadedSoFar,
  })

  if (!load.ok) {
    await updateAssetUploadJob(job.id, {
      upload_progress: withDeployState(
        job.upload_progress,
        emptyDeployPatch({
          status: 'failed',
          candy_machine_id: candyMachineId!,
          collection_mint: collectionMint!,
          candy_guard_id: candyGuardId!,
          config_lines_loaded: loadedSoFar,
          config_lines_total: pkg.configLines.length,
          error: load.error,
          completed_at: new Date().toISOString(),
        })
      ),
    })
    return {
      ok: false,
      error: load.error,
      code: 'deploy_failed',
      candy_machine_id: candyMachineId!,
      collection_mint: collectionMint!,
      candy_guard_id: candyGuardId!,
      continue_loading: true,
      config_lines_loaded: loadedSoFar,
      config_lines_total: pkg.configLines.length,
    }
  }

  if (!load.complete) {
    await updateAssetUploadJob(job.id, {
      upload_progress: withDeployState(
        job.upload_progress,
        emptyDeployPatch({
          status: 'loading_items',
          candy_machine_id: load.candyMachineId,
          collection_mint: load.collectionMint,
          candy_guard_id: load.candyGuardId,
          config_lines_loaded: load.configLinesLoaded,
          config_lines_total: load.configLinesTotal,
        })
      ),
    })
    return {
      ok: true,
      candy_machine_id: load.candyMachineId,
      collection_mint: load.collectionMint,
      candy_guard_id: load.candyGuardId,
      continue_loading: true,
      config_lines_loaded: load.configLinesLoaded,
      config_lines_total: load.configLinesTotal,
    }
  }

  return completeCoreDeployAfterLines({
    launchId,
    jobId: job.id,
    launch,
    progress: job.upload_progress,
    candyMachineId: load.candyMachineId,
    collectionMint: load.collectionMint,
    candyGuardId: load.candyGuardId,
    configLinesLoaded: load.configLinesLoaded,
    configLinesTotal: load.configLinesTotal,
  })
}

export async function runOnchainSugarDeployForLaunch(launchId: string): Promise<SugarDeployWorkerResult> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, error: 'Launch not found', code: 'not_found' }
  if (launch.mint_mode !== 'public_simple') {
    return { ok: false, error: 'On-chain deploy is only for public_simple collections (use Sugar CLI for Gen2).', code: 'wrong_mode' }
  }
  if (!isOwlCenterOnchainCmDeployEnabled()) {
    return {
      ok: false,
      error: 'On-chain deploy disabled — set IRYS_PRIVATE_KEY (and do not set OWL_CENTER_ONCHAIN_CM_DEPLOY=false).',
      code: 'disabled',
    }
  }

  const job = await getLatestAssetUploadJobForLaunch(launchId)
  if (!job || job.status !== 'completed') {
    return { ok: false, error: 'Complete Phase B Arweave upload before deploying the Candy Machine.', code: 'arweave_incomplete' }
  }

  const existing = parseOnchainDeployState(job.upload_progress)

  // Fully complete — re-persist IDs only.
  if (
    existing?.status === 'completed' &&
    existing.candy_machine_id &&
    existing.collection_mint &&
    isValidSolanaPubkey(existing.candy_machine_id) &&
    isValidSolanaPubkey(existing.collection_mint)
  ) {
    const go_live = await persistDeployIds(
      launchId,
      job.id,
      existing.candy_machine_id,
      existing.collection_mint,
      existing.candy_guard_id
    )
    return {
      ok: true,
      candy_machine_id: existing.candy_machine_id,
      collection_mint: existing.collection_mint,
      candy_guard_id: existing.candy_guard_id ?? '',
      already_deployed: true,
      go_live,
    }
  }

  if (existing?.status === 'running') {
    return { ok: false, error: 'Deploy already in progress — wait and refresh.', code: 'in_progress' }
  }

  // Core: resumable create → load items → handoff
  if (launch.mint_standard === 'core') {
    const resumeLoad =
      existing &&
      (existing.status === 'loading_items' ||
        (existing.status === 'failed' &&
          existing.config_lines_total != null &&
          (existing.config_lines_loaded ?? 0) < existing.config_lines_total)) &&
      existing.candy_machine_id &&
      existing.collection_mint

    const resumeHandoff =
      !resumeLoad &&
      (existing?.status === 'cm_ready' || existing?.status === 'failed' || existing?.status === 'ua_handed_off') &&
      existing.candy_machine_id &&
      existing.collection_mint &&
      isValidSolanaPubkey(existing.candy_machine_id) &&
      isValidSolanaPubkey(existing.collection_mint) &&
      configLinesFullyLoaded(existing) &&
      isOwlCenterCreatorUaHandoffEnabled()

    if (resumeHandoff) {
      const creatorWallet = launch.creator_wallet?.trim()
      if (!creatorWallet) {
        return { ok: false, error: 'creator_wallet is required to finish Core update-authority handoff.', code: 'missing_creator' }
      }

      await updateAssetUploadJob(job.id, {
        upload_progress: withDeployState(
          job.upload_progress,
          emptyDeployPatch({
            status: 'cm_ready',
            candy_machine_id: existing.candy_machine_id,
            collection_mint: existing.collection_mint,
            candy_guard_id: existing.candy_guard_id ?? null,
            onchain_update_authority: existing.onchain_update_authority ?? null,
            platform_update_delegate: existing.platform_update_delegate ?? null,
            config_lines_loaded: existing.config_lines_loaded,
            config_lines_total: existing.config_lines_total,
            error: null,
          })
        ),
      })

      const network = resolveLaunchMintNetwork(launch)
      const umi = createIrysDeployerCoreUmi(network)
      const handoff = await handOffCoreCollectionUpdateAuthority({
        umi,
        collectionAddress: existing.collection_mint!,
        creatorWallet,
      })
      if (!handoff.ok) {
        await updateAssetUploadJob(job.id, {
          upload_progress: withDeployState(
            job.upload_progress,
            emptyDeployPatch({
              status: 'failed',
              candy_machine_id: existing.candy_machine_id,
              collection_mint: existing.collection_mint,
              candy_guard_id: existing.candy_guard_id ?? null,
              onchain_update_authority: existing.onchain_update_authority ?? null,
              platform_update_delegate: existing.platform_update_delegate ?? null,
              config_lines_loaded: existing.config_lines_loaded,
              config_lines_total: existing.config_lines_total,
              error: handoff.error,
              completed_at: new Date().toISOString(),
            })
          ),
        })
        return { ok: false, error: handoff.error, code: 'ua_handoff_failed' }
      }

      await updateOwlCenterLaunchByIdAdmin(launchId, {
        onchain_update_authority: handoff.updateAuthority,
        platform_update_delegate: handoff.platformDelegate,
      })

      const completedAt = new Date().toISOString()
      await updateAssetUploadJob(job.id, {
        upload_progress: withDeployState(
          job.upload_progress,
          emptyDeployPatch({
            status: 'completed',
            candy_machine_id: existing.candy_machine_id,
            collection_mint: existing.collection_mint,
            candy_guard_id: existing.candy_guard_id ?? null,
            onchain_update_authority: handoff.updateAuthority,
            platform_update_delegate: handoff.platformDelegate,
            config_lines_loaded: existing.config_lines_loaded,
            config_lines_total: existing.config_lines_total,
            completed_at: completedAt,
          })
        ),
      })

      const go_live = await persistDeployIds(
        launchId,
        job.id,
        existing.candy_machine_id!,
        existing.collection_mint!,
        existing.candy_guard_id
      )
      return {
        ok: true,
        candy_machine_id: existing.candy_machine_id!,
        collection_mint: existing.collection_mint!,
        candy_guard_id: existing.candy_guard_id ?? '',
        go_live,
      }
    }

    return runCoreResumableDeploy(launchId, launch, job, existing)
  }

  // Token Metadata — one-shot; large supplies use Sugar CLI.
  const pkg = buildSugarDeployPackageFromJob(job, launch)
  if (!pkg.collectionMetadataUri) {
    return { ok: false, error: 'Missing collection metadata on Arweave (assets/collection.json).', code: 'missing_collection_meta' }
  }
  if (pkg.configLines.length > OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY) {
    return {
      ok: false,
      error: `Supply ${pkg.configLines.length} exceeds server deploy cap (${OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY}). Use npm run sugar:deploy locally.`,
      code: 'over_cap',
    }
  }

  await updateAssetUploadJob(job.id, {
    upload_progress: withDeployState(
      job.upload_progress,
      emptyDeployPatch({ status: 'running' })
    ),
  })

  const result = await deployPublicSimpleCandyMachineOnchain({
    launch,
    configLines: pkg.configLines,
    collectionMetadataUri: pkg.collectionMetadataUri,
    collectionName: launch.name,
  })

  if (!result.ok) {
    const partial = result.partial
    await updateAssetUploadJob(job.id, {
      upload_progress: withDeployState(
        job.upload_progress,
        emptyDeployPatch({
          status: partial?.phase === 'cm_ready' ? 'cm_ready' : 'failed',
          candy_machine_id: partial?.candyMachineId ?? existing?.candy_machine_id ?? null,
          collection_mint: partial?.collectionMint ?? existing?.collection_mint ?? null,
          candy_guard_id: partial?.candyGuardId ?? existing?.candy_guard_id ?? null,
          error: result.error,
          completed_at: new Date().toISOString(),
        })
      ),
    })
    return {
      ok: false,
      error: result.error,
      code: partial?.phase === 'cm_ready' ? 'ua_handoff_pending' : 'deploy_failed',
    }
  }

  if (result.onchainUpdateAuthority) {
    await updateOwlCenterLaunchByIdAdmin(launchId, {
      onchain_update_authority: result.onchainUpdateAuthority,
      platform_update_delegate: result.platformUpdateDelegate ?? null,
    })
  }

  const completedAt = new Date().toISOString()
  await updateAssetUploadJob(job.id, {
    upload_progress: withDeployState(
      job.upload_progress,
      emptyDeployPatch({
        status: 'completed',
        candy_machine_id: result.candyMachineId,
        collection_mint: result.collectionMint,
        candy_guard_id: result.candyGuardId,
        onchain_update_authority: result.onchainUpdateAuthority ?? null,
        platform_update_delegate: result.platformUpdateDelegate ?? null,
        completed_at: completedAt,
      })
    ),
  })

  const go_live = await persistDeployIds(
    launchId,
    job.id,
    result.candyMachineId,
    result.collectionMint,
    result.candyGuardId
  )

  return {
    ok: true,
    candy_machine_id: result.candyMachineId,
    collection_mint: result.collectionMint,
    candy_guard_id: result.candyGuardId,
    go_live,
  }
}

function summarizeGoLive(result: PromoteLaunchResult): SugarDeployGoLiveSummary {
  if (result.ok) {
    return { ok: true, already_live: result.already_live }
  }
  return { ok: false, blockers: result.blockers }
}

async function persistDeployIds(
  launchId: string,
  jobId: string,
  candyMachineId: string,
  collectionMint: string,
  candyGuardId: string | null | undefined
): Promise<SugarDeployGoLiveSummary> {
  const cmCheck = validateSolanaPubkeyInput(candyMachineId, 'Candy Machine ID')
  if (!cmCheck.ok) return { ok: false, blockers: [cmCheck.error] }
  const colCheck = validateSolanaPubkeyInput(collectionMint, 'Collection mint')
  if (!colCheck.ok) return { ok: false, blockers: [colCheck.error] }

  const row = await upsertMarketplaceReadinessForLaunch(launchId, {
    candy_machine_id: cmCheck.pubkey,
    collection_mint: colCheck.pubkey,
    notes: candyGuardId ? `Candy guard ${candyGuardId} (Phase B on-chain deploy)` : undefined,
  })
  if (row) await syncLaunchMarketplaceFieldsFromRow(launchId, row)

  await getSupabaseAdmin().from('owl_center_activity_logs').insert({
    launch_id: launchId,
    message: `Phase B on-chain CM deploy · CM ${cmCheck.pubkey.slice(0, 8)}… · job ${jobId.slice(0, 8)}`,
    event_type: 'system',
  })

  return summarizeGoLive(await promoteLaunchToLive(launchId, { auto: true }))
}

export async function registerManualSugarDeployIds(
  launchId: string,
  candyMachineId: string,
  collectionMint: string,
  candyGuardId?: string | null
): Promise<SugarDeployWorkerResult> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, error: 'Launch not found', code: 'not_found' }

  const cmCheck = validateSolanaPubkeyInput(candyMachineId, 'Candy Machine ID')
  if (!cmCheck.ok) return { ok: false, error: cmCheck.error, code: 'invalid_input' }
  const colCheck = validateSolanaPubkeyInput(collectionMint, 'Collection mint')
  if (!colCheck.ok) return { ok: false, error: colCheck.error, code: 'invalid_input' }

  const cm = cmCheck.pubkey
  const col = colCheck.pubkey
  let go_live: SugarDeployGoLiveSummary | undefined

  const job = await getLatestAssetUploadJobForLaunch(launchId)
  if (job) {
    await updateAssetUploadJob(job.id, {
      upload_progress: withDeployState(
        job.upload_progress,
        emptyDeployPatch({
          status: 'completed',
          candy_machine_id: cm,
          collection_mint: col,
          candy_guard_id: candyGuardId?.trim() || null,
          completed_at: new Date().toISOString(),
        })
      ),
    })
    go_live = await persistDeployIds(launchId, job.id, cm, col, candyGuardId)
  } else {
    go_live = await persistDeployIds(launchId, 'manual', cm, col, candyGuardId)
  }

  return {
    ok: true,
    candy_machine_id: cm,
    collection_mint: col,
    candy_guard_id: candyGuardId?.trim() ?? '',
    go_live,
  }
}
