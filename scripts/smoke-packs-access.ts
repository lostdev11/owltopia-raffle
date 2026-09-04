/**
 * Lightweight smoke checks for Packs access helpers (no DB).
 * Run: npx tsx scripts/smoke-packs-access.ts
 */
import {
  canAccessPacks,
  isPacksEnvKillSwitch,
  isPacksPublicClient,
} from '../lib/packs/access'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

assert(canAccessPacks({ isAdmin: true, isPublic: false }) === true, 'admin allowed')
assert(canAccessPacks({ isAdmin: false, isTester: true, isPublic: false }) === true, 'tester allowed')
assert(canAccessPacks({ isAdmin: false, isTester: false, isPublic: true }) === true, 'public allowed')
assert(
  canAccessPacks({ isAdmin: false, isTester: false, isPublic: false }) === false,
  'stranger denied when restricted'
)

const prev = process.env.PACKS_PUBLIC
process.env.PACKS_PUBLIC = 'false'
assert(isPacksEnvKillSwitch() === true, 'kill switch when PACKS_PUBLIC=false')
process.env.PACKS_PUBLIC = 'true'
assert(isPacksEnvKillSwitch() === false, 'no kill switch when PACKS_PUBLIC=true')
delete process.env.PACKS_PUBLIC
assert(isPacksEnvKillSwitch() === false, 'no kill switch when unset')
if (prev !== undefined) process.env.PACKS_PUBLIC = prev

assert(typeof isPacksPublicClient() === 'boolean', 'client helper returns boolean')

console.log('smoke-packs-access: ok')
