import { SECURITY_CONTACT_EMAIL, getSiteBaseUrl } from '@/lib/site-config'

/** RFC 9116 security.txt — expires ~1 year from last update. */
const EXPIRES = '2027-09-27T23:59:59.000Z'

export function GET() {
  const canonical = `${getSiteBaseUrl()}/.well-known/security.txt`
  const body = [
    `Contact: mailto:${SECURITY_CONTACT_EMAIL}`,
    `Expires: ${EXPIRES}`,
    'Preferred-Languages: en',
    `Canonical: ${canonical}`,
    '',
    `# Owltopia (${getSiteBaseUrl()}) — community Solana raffles, packs, launchpad, nesting.`,
    `# Confirm the Contact mailbox with the site owner before relying on it for production reports.`,
  ].join('\n')

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
