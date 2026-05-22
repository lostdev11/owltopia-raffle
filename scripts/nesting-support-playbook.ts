/**
 * Support: combined playbook (audit + diagnostics + do-not-harm guards).
 * Usage: npx --yes tsx scripts/nesting-support-playbook.ts <wallet>
 */
import { loadEnvConfig } from '@next/env'
import { loadAdminSupportPlaybook } from '@/lib/nesting/admin-support-playbook'

loadEnvConfig(process.cwd())

const wallet = process.argv[2]?.trim()
if (!wallet) {
  console.error('Usage: npx --yes tsx scripts/nesting-support-playbook.ts <wallet>')
  process.exit(1)
}

loadAdminSupportPlaybook(wallet)
  .then((p) => console.log(JSON.stringify(p, null, 2)))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
