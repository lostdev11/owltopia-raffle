/**
 * Run: npx tsx scripts/test-vrf-timing-log.ts
 */
import assert from 'node:assert/strict'
import { logVrfPhase } from '../lib/raffles/draw/vrf-timing-log'

function main() {
  const lines: string[] = []
  const orig = console.log
  console.log = (msg: string) => {
    lines.push(msg)
  }
  try {
    logVrfPhase('pack', 'test.phase', 42, { foo: 'bar' })
  } finally {
    console.log = orig
  }
  assert.equal(lines.length, 1)
  const parsed = JSON.parse(lines[0]!) as {
    tag: string
    scope: string
    phase: string
    durationMs: number
    foo: string
  }
  assert.equal(parsed.tag, 'vrf_timing')
  assert.equal(parsed.scope, 'pack')
  assert.equal(parsed.phase, 'test.phase')
  assert.equal(parsed.durationMs, 42)
  assert.equal(parsed.foo, 'bar')
  console.log(JSON.stringify({ ok: true }))
}

main()
