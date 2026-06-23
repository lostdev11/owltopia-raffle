#!/usr/bin/env node
/**
 * Normalize a Sugar assets/ folder for deploy:
 *   - Renumber token files to 0-based contiguous (Metaplex/Sugar requirement).
 *     Generator exports are 1..N; Sugar needs 0..N-1.
 *   - Rewrite each metadata JSON's symbol + name to match config.json
 *     (the on-chain identity), preserving the original display number.
 *   - Point image / properties.files at the new 0-based PNG filename.
 *
 * Usage:
 *   node scripts/renumber-sugar-assets-zero-based.mjs collections/owltopia-gen2
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function resolveCollectionDir(arg) {
  if (!arg) throw new Error('Usage: node scripts/renumber-sugar-assets-zero-based.mjs collections/<name>')
  const dir = path.isAbsolute(arg) ? arg : path.join(ROOT, arg.replace(/^collections[/\\]/, 'collections/'))
  return dir.includes(`${path.sep}collections${path.sep}`)
    ? dir
    : path.join(ROOT, 'collections', path.basename(dir))
}

function main() {
  const collectionDir = resolveCollectionDir(process.argv[2])
  const assetsDir = path.join(collectionDir, 'assets')
  const configPath = path.join(collectionDir, 'config.json')
  if (!fs.existsSync(assetsDir)) throw new Error(`Missing ${assetsDir}`)
  if (!fs.existsSync(configPath)) throw new Error(`Missing ${configPath}`)

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const symbol = config.symbol ?? ''
  const prefixName = config.configLineSettings?.prefixName ?? ''

  const indices = [
    ...new Set(
      fs
        .readdirSync(assetsDir)
        .map((f) => /^(\d+)\.(png|json)$/i.exec(f))
        .filter(Boolean)
        .map((m) => Number.parseInt(m[1], 10))
    ),
  ].sort((a, b) => a - b)

  if (!indices.length) throw new Error('No numbered token files found.')
  const min = indices[0]
  const max = indices[indices.length - 1]
  if (min === 0) {
    console.log('Already 0-based — nothing to renumber.')
    return
  }

  const shift = min // 1-based -> shift down to 0
  let renamed = 0

  // Ascending so each target index was already vacated by the previous step.
  for (const i of indices) {
    const ni = i - shift
    const srcJson = path.join(assetsDir, `${i}.json`)
    const dstJson = path.join(assetsDir, `${ni}.json`)
    if (fs.existsSync(srcJson)) {
      const meta = JSON.parse(fs.readFileSync(srcJson, 'utf8'))
      // Preserve the original display number (#i) per launch choice.
      meta.name = `${prefixName}${i}`
      meta.symbol = symbol
      meta.image = `${ni}.png`
      if (meta.properties && Array.isArray(meta.properties.files)) {
        meta.properties.files = meta.properties.files.map((f) =>
          typeof f.uri === 'string' && /\.png$/i.test(f.uri) ? { ...f, uri: `${ni}.png` } : f
        )
      }
      fs.writeFileSync(dstJson, `${JSON.stringify(meta, null, 2)}\n`)
      if (srcJson !== dstJson) fs.rmSync(srcJson)
    }

    const srcPng = path.join(assetsDir, `${i}.png`)
    const dstPng = path.join(assetsDir, `${ni}.png`)
    if (fs.existsSync(srcPng) && srcPng !== dstPng) fs.renameSync(srcPng, dstPng)
    renamed += 1
  }

  console.log(
    `Renumbered ${renamed} items ${min}..${max} -> ${min - shift}..${max - shift}; symbol="${symbol}", name prefix="${prefixName}".`
  )
}

main()
