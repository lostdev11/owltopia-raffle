import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
const STATE = 'collections/owltopia-gen2/.irys-uploaded.json'
const CACHE = 'collections/owltopia-gen2/cache.json'

if (existsSync(CACHE)) {
  copyFileSync(CACHE, 'collections/owltopia-gen2/cache.gen2.bak.json')
  console.log('backed up cache.json -> cache.gen2.bak.json')
}

const state = JSON.parse(readFileSync(STATE, 'utf8'))
let removed = 0
let keptPng = 0
const next = {}
for (const [k, v] of Object.entries(state)) {
  if (k.toLowerCase().endsWith('.json')) { removed += 1; continue }
  next[k] = v
  if (k.toLowerCase().endsWith('.png')) keptPng += 1
}
writeFileSync(STATE, JSON.stringify(next, null, 2))
console.log(`removed ${removed} json entries · kept ${keptPng} png entries -> will re-upload JSON only`)
