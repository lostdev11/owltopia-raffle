import 'server-only'

import {
  getAssetUploadJobById,
  getLatestAssetUploadJobForLaunch,
  updateAssetUploadJob,
} from '@/lib/db/owl-center-asset-upload-job'
import { ensureMarketplaceRow, syncLaunchMarketplaceFieldsFromRow, upsertMarketplaceReadinessForLaunch } from '@/lib/db/owl-center-marketplace'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import type { AssetUploadProgress } from '@/lib/owl-center/asset-upload-types'
import {
  buildSugarDeployPackageFromJob,
  parseOnchainDeployState,
} from '@/lib/owl-center/sugar-deploy-package'
import {
  deployPublicSimpleCandyMachineOnchain,
  isOwlCenterOnchainCmDeployEnabled,
  OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY,
} from '@/lib/owl-center/sugar-deploy-onchain'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type SugarDeployWorkerResult =
  | {
      ok: true
      candy_machine_id: string
      collection_mint: string
      candy_guard_id: string
      already_deployed?: boolean
    }
  | { ok: false; error: string; code?: string }

function withDeployState(
  progress: AssetUploadProgress,
  patch: NonNullable<ReturnType<typeof parseOnchainDeployState>>
): AssetUploadProgress {
  return { ...progress, onchain_deploy: patch } as AssetUploadProgress
}

export async function getSugarDeployStatusForLaunch(launchId: string) {
  const [launch, job, marketplace] = await Promise.all([
    getOwlCenterLaunchByIdAdmin(launchId),
    getLatestAssetUploadJobForLaunch(launchId),
    ensureMarketplaceRow(launchId),
  ])

  const deployState = job ? parseOnchainDeployState(job.upload_progress) : null
  const cmId = marketplace?.candy_machine_id?.trim() || deployState?.candy_machine_id || null
  const colMint = marketplace?.collection_mint?.trim() || deployState?.collection_mint || null

  return {
    launch,
    job,
    marketplace,
    deploy_state: deployState,
    candy_machine_id: cmId,
    collection_mint: colMint,
    onchain_deploy_enabled: isOwlCenterOnchainCmDeployEnabled(),
    server_deploy_max_supply: OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY,
    arweave_ready: job?.status === 'completed',
    can_deploy:
      Boolean(launch) &&
      launch!.mint_mode === 'public_simple' &&
      job?.status === 'completed' &&
      !cmId &&
      deployState?.status !== 'running' &&
      isOwlCenterOnchainCmDeployEnabled(),
  }
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
  if (existing?.status === 'completed' && existing.candy_machine_id && existing.collection_mint) {
    await persistDeployIds(launchId, job.id, existing.candy_machine_id, existing.collection_mint, existing.candy_guard_id)
    return {
      ok: true,
      candy_machine_id: existing.candy_machine_id,
      collection_mint: existing.collection_mint,
      candy_guard_id: existing.candy_guard_id ?? '',
      already_deployed: true,
    }
  }
  if (existing?.status === 'running') {
    return { ok: false, error: 'Deploy already in progress — wait and refresh.', code: 'in_progress' }
  }

  const pkg = buildSugarDeployPackageFromJob(job, launch)
  if (!pkg.collectionMetadataUri) {
    return { ok: false, error: 'Missing collection metadata on Arweave (assets/collection.json).', code: 'missing_collection_meta' }
  }

  await updateAssetUploadJob(job.id, {
    upload_progress: withDeployState(job.upload_progress, {
      status: 'running',
      candy_machine_id: null,
      collection_mint: null,
      candy_guard_id: null,
      error: null,
      completed_at: null,
    }),
  })

  const result = await deployPublicSimpleCandyMachineOnchain({
    launch,
    configLines: pkg.configLines,
    collectionMetadataUri: pkg.collectionMetadataUri,
    collectionName: launch.name,
  })

  if (!result.ok) {
    await updateAssetUploadJob(job.id, {
      upload_progress: withDeployState(job.upload_progress, {
        status: 'failed',
        candy_machine_id: existing?.candy_machine_id ?? null,
        collection_mint: existing?.collection_mint ?? null,
        candy_guard_id: existing?.candy_guard_id ?? null,
        error: result.error,
        completed_at: new Date().toISOString(),
      }),
    })
    return { ok: false, error: result.error, code: 'deploy_failed' }
  }

  const completedAt = new Date().toISOString()
  await updateAssetUploadJob(job.id, {
    upload_progress: withDeployState(job.upload_progress, {
      status: 'completed',
      candy_machine_id: result.candyMachineId,
      collection_mint: result.collectionMint,
      candy_guard_id: result.candyGuardId,
      error: null,
      completed_at: completedAt,
    }),
  })

  await persistDeployIds(launchId, job.id, result.candyMachineId, result.collectionMint, result.candyGuardId)

  return {
    ok: true,
    candy_machine_id: result.candyMachineId,
    collection_mint: result.collectionMint,
    candy_guard_id: result.candyGuardId,
  }
}

async function persistDeployIds(
  launchId: string,
  jobId: string,
  candyMachineId: string,
  collectionMint: string,
  candyGuardId: string | null | undefined
) {
  const row = await upsertMarketplaceReadinessForLaunch(launchId, {
    candy_machine_id: candyMachineId,
    collection_mint: collectionMint,
    notes: candyGuardId ? `Candy guard ${candyGuardId} (Phase B on-chain deploy)` : undefined,
  })
  if (row) await syncLaunchMarketplaceFieldsFromRow(launchId, row)

  await getSupabaseAdmin().from('owl_center_activity_logs').insert({
    launch_id: launchId,
    message: `Phase B on-chain CM deploy · CM ${candyMachineId.slice(0, 8)}… · job ${jobId.slice(0, 8)}`,
    event_type: 'system',
  })
}

export async function registerManualSugarDeployIds(
  launchId: string,
  candyMachineId: string,
  collectionMint: string,
  candyGuardId?: string | null
): Promise<SugarDeployWorkerResult> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, error: 'Launch not found', code: 'not_found' }

  const cm = candyMachineId.trim()
  const col = collectionMint.trim()
  if (!cm || !col) return { ok: false, error: 'Candy Machine ID and collection mint are required.', code: 'invalid_input' }

  const job = await getLatestAssetUploadJobForLaunch(launchId)
  if (job) {
    await updateAssetUploadJob(job.id, {
      upload_progress: withDeployState(job.upload_progress, {
        status: 'completed',
        candy_machine_id: cm,
        collection_mint: col,
        candy_guard_id: candyGuardId?.trim() || null,
        error: null,
        completed_at: new Date().toISOString(),
      }),
    })
    await persistDeployIds(launchId, job.id, cm, col, candyGuardId)
  } else {
    await persistDeployIds(launchId, 'manual', cm, col, candyGuardId)
  }

  return {
    ok: true,
    candy_machine_id: cm,
    collection_mint: col,
    candy_guard_id: candyGuardId?.trim() ?? '',
  }
}
