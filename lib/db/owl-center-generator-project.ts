import type { GeneratorProject } from '@/lib/owl-center/generator/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type GeneratorProjectRow = {
  wallet: string
  project_id: string
  name: string
  project_json: GeneratorProject
  updated_at: string
}

export async function getGeneratorProjectByWallet(wallet: string): Promise<GeneratorProjectRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_generator_projects')
    .select('wallet,project_id,name,project_json,updated_at')
    .eq('wallet', wallet)
    .maybeSingle()

  if (error) {
    console.error('getGeneratorProjectByWallet', error)
    return null
  }
  if (!data) return null

  const row = data as {
    wallet: string
    project_id: string
    name: string
    project_json: GeneratorProject
    updated_at: string
  }

  return {
    wallet: row.wallet,
    project_id: row.project_id,
    name: row.name,
    project_json: row.project_json,
    updated_at: row.updated_at,
  }
}

export async function upsertGeneratorProjectForWallet(
  wallet: string,
  project: GeneratorProject
): Promise<{ ok: true; updated_at: string } | { ok: false; error: string }> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_generator_projects')
    .upsert(
      {
        wallet,
        project_id: project.id,
        name: project.name,
        project_json: project,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wallet' }
    )
    .select('updated_at')
    .single()

  if (error) {
    console.error('upsertGeneratorProjectForWallet', error)
    return { ok: false, error: 'cloud_save_failed' }
  }

  return { ok: true, updated_at: String((data as { updated_at: string }).updated_at) }
}

export async function deleteGeneratorProjectForWallet(wallet: string): Promise<boolean> {
  const db = getSupabaseAdmin()
  const { error } = await db.from('owl_center_generator_projects').delete().eq('wallet', wallet)
  if (error) {
    console.error('deleteGeneratorProjectForWallet', error)
    return false
  }
  return true
}
