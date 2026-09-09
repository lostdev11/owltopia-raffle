/**
 * Switchboard depends on npm alias `@coral-xyz/anchor-31` (= anchor@0.31.1).
 * That package re-exports `@solana/web3.js` (`export * as web3`). With a single
 * hoisted web3.js (via overrides to 1.99.0-beta.0 for Transaction V1 reads),
 * TypeScript still assigns a distinct module identity under
 * `anchor-31/node_modules/@solana/web3.js`, which breaks Connection/Keypair
 * assignability in VRF draw code.
 *
 * Symlink the nested path to the hoisted install so both resolve to one copy.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const target = path.join(root, 'node_modules', '@solana', 'web3.js')
const nestedDir = path.join(
  root,
  'node_modules',
  '@coral-xyz',
  'anchor-31',
  'node_modules',
  '@solana'
)
const linkPath = path.join(nestedDir, 'web3.js')

function ensureSymlink() {
  if (!fs.existsSync(target)) return
  if (!fs.existsSync(path.join(root, 'node_modules', '@coral-xyz', 'anchor-31'))) return

  fs.mkdirSync(nestedDir, { recursive: true })

  let existing = null
  try {
    existing = fs.lstatSync(linkPath)
  } catch {
    // missing
  }

  if (existing) {
    if (existing.isSymbolicLink()) {
      const current = fs.readlinkSync(linkPath)
      const resolved = path.resolve(nestedDir, current)
      if (resolved === target) return
      fs.unlinkSync(linkPath)
    } else {
      // Unexpected real install — leave it alone.
      return
    }
  }

  // Relative link so it stays valid if the tree is moved within the project.
  const rel = path.relative(nestedDir, target)
  fs.symlinkSync(rel, linkPath)
}

try {
  ensureSymlink()
} catch (err) {
  console.warn(
    '[postinstall-solana-web3-dedupe] skipped:',
    err instanceof Error ? err.message : err
  )
}
