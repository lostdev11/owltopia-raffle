/**
 * Download the pristine staged Sugar ZIP (original images + metadata) for the Gen2 launch from
 * the private Supabase `owl-center-asset-staging` bucket. This is the clean source for re-uploading
 * the collection to permanent Arweave (the on-chain irys links are temporary/devnet and unreadable).
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.local.
 *
 *   node --env-file=.env.local scripts/gen2-fetch-staged-zip.mjs
 *   node --env-file=.env.local scripts/gen2-fetch-staged-zip.mjs --path "<bucket/path>" --out "<file>"
 *
 * Default pulls the COMPLETED job (gen2.zip). Use --final for the older FINAL_GEN2.zip job.
 */
import { createClient } from '@supabase/supabase-js'
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'

const BUCKET = 'owl-center-asset-staging'
const COMPLETED = '2e496154-881f-4999-a8b0-d25944e7350a/0e3cba69-3587-45ae-8e8b-93f69618410f/gen2.zip'
const FINAL = '2e496154-881f-4999-a8b0-d25944e7350a/271b1627-ee4f-4f4e-8f5b-92110dc9bbc7/FINAL_GEN2.zip'

const args = process.argv.slice(2)
const getArg = (k) => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : null
}
const STORAGE_PATH = getArg('path') || (args.includes('--final') ? FINAL : COMPLETED)
const OUT = getArg('out') || path.resolve('collections/owltopia-gen2/source/gen2.zip')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supa = createClient(url, key, { auth: { persistSession: false } })

const { data, error } = await supa.storage.from(BUCKET).createSignedUrl(STORAGE_PATH, 900)
if (error || !data?.signedUrl) {
  console.error('createSignedUrl failed:', error?.message || 'no url')
  process.exit(1)
}

await mkdir(path.dirname(OUT), { recursive: true })
console.log(`downloading ${BUCKET}/${STORAGE_PATH}\n  -> ${OUT}`)
const res = await fetch(data.signedUrl)
if (!res.ok || !res.body) {
  console.error('download failed:', res.status, res.statusText)
  process.exit(1)
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(OUT))
const s = await stat(OUT)
console.log(`done. ${(s.size / 1024 / 1024).toFixed(1)} MB written. Unzip it to inspect the original assets.`)
