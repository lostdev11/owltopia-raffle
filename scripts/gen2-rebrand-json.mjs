/**
 * Re-edit the on-disk Gen2 asset JSONs in place for the FINAL branding + a metadata cleanup,
 * ahead of a JSON-only re-upload (scripts/upload-gen2-irys.mjs) + repoint.
 *
 * Changes per item JSON (collections/owltopia-gen2/assets/<n>.json) and collection.json:
 *   - name   "Owltopia Gen2 ..."  -> "Owltopia G2 ..."   (e.g. "Owltopia Gen2 #772" -> "Owltopia G2 #772")
 *   - symbol "OWLGEN2"            -> "OWL2"
 *   - properties.files[].uri      := image   (fix the stale/dead devnet uri left in files[0])
 * Images (the `image` field + the actual PNGs) are NOT touched.
 *
 * Safe by default (prints a summary). Pass --confirm to write the files.
 *   node scripts/gen2-rebrand-json.mjs
 *   node scripts/gen2-rebrand-json.mjs --confirm
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'collections/owltopia-gen2/assets'
const CONFIRM = process.argv.includes('--confirm')

const OLD_NAME = 'Owltopia Gen2'
const NEW_NAME = 'Owltopia G2'
const OLD_SYMBOL = 'OWLGEN2'
const NEW_SYMBOL = 'OWL2'

function rebrand(json) {
  let nameChanged = false
  let symbolChanged = false
  let uriFixed = 0
  if (typeof json.name === 'string' && json.name.includes(OLD_NAME)) {
    json.name = json.name.split(OLD_NAME).join(NEW_NAME)
    nameChanged = true
  }
  if (json.symbol === OLD_SYMBOL) {
    json.symbol = NEW_SYMBOL
    symbolChanged = true
  }
  if (json.properties && Array.isArray(json.properties.files)) {
    json.properties.files = json.properties.files.map((f) => {
      if (f && typeof f === 'object' && (f.type === 'image/png' || (typeof f.uri === 'string')) && f.uri !== json.image) {
        uriFixed += 1
        return { ...f, uri: json.image }
      }
      return f
    })
  }
  return { nameChanged, symbolChanged, uriFixed }
}

const files = readdirSync(DIR).filter((f) => /^\d+\.json$/.test(f))
if (existsSync(join(DIR, 'collection.json'))) files.push('collection.json')

let names = 0
let symbols = 0
let uris = 0
const samples = []
for (const f of files) {
  const path = join(DIR, f)
  const json = JSON.parse(readFileSync(path, 'utf8'))
  const before = JSON.stringify(json)
  const r = rebrand(json)
  if (r.nameChanged) names += 1
  if (r.symbolChanged) symbols += 1
  uris += r.uriFixed
  const after = `${JSON.stringify(json, null, 2)}\n`
  if (samples.length < 3) samples.push(`${f}: name="${json.name}" symbol="${json.symbol}" files0=${json.properties?.files?.[0]?.uri?.slice(-12)} (img ${json.image?.slice(-12)})`)
  if (CONFIRM && before !== JSON.stringify(JSON.parse(after))) writeFileSync(path, after)
}

console.log(`files processed     : ${files.length}`)
console.log(`name -> "${NEW_NAME}"   : ${names}`)
console.log(`symbol -> "${NEW_SYMBOL}"      : ${symbols}`)
console.log(`files[].uri fixed   : ${uris}`)
console.log('samples:')
for (const s of samples) console.log('  ' + s)
console.log(CONFIRM ? '\nWROTE changes to disk.' : '\n(dry-run) re-run with --confirm to write.')
