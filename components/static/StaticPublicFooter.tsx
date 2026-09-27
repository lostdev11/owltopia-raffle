import Link from 'next/link'
import {
  COMMUNITY_DISCORD_INVITE_URL,
  OFFICIAL_X_URL,
  PLATFORM_NAME,
  PUBLIC_GITHUB_REPO_URL,
  SECURITY_CONTACT_EMAIL,
  getSiteBaseUrl,
} from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()

/**
 * Server-rendered trust footer for crawlers and no-JS clients.
 * Visible on info pages; complements the interactive client Footer.
 */
export function StaticPublicFooter() {
  return (
    <footer
      className="border-t border-green-500/30 bg-zinc-950/90 text-sm text-zinc-300"
      aria-label="Site information and official links"
    >
      <div className="container mx-auto max-w-4xl px-4 py-8 space-y-4">
        <p>
          <strong className="text-white">{PLATFORM_NAME}</strong> ({SITE_URL}) is a community-built Solana site for
          NFT raffles, Owl Packs, the Owl Center launchpad, and OWL nesting (staking). This project is{' '}
          <strong className="text-white">not affiliated with Owlto Finance</strong> or the unrelated &quot;owlto&quot;
          bridge brand.
        </p>
        <p>
          Official community:{' '}
          <a href={OFFICIAL_X_URL} className="text-green-400 underline underline-offset-2">
            X (@Owltopia_sol)
          </a>
          {' · '}
          <a href={COMMUNITY_DISCORD_INVITE_URL} className="text-green-400 underline underline-offset-2">
            Discord
          </a>
          {' · '}
          <a href={PUBLIC_GITHUB_REPO_URL} className="text-green-400 underline underline-offset-2">
            Public GitHub repository
          </a>
        </p>
        <p>
          Security contact:{' '}
          <a href={`mailto:${SECURITY_CONTACT_EMAIL}`} className="text-green-400 underline underline-offset-2">
            {SECURITY_CONTACT_EMAIL}
          </a>{' '}
          · Policy:{' '}
          <Link href="/.well-known/security.txt" className="text-green-400 underline underline-offset-2">
            security.txt
          </Link>
        </p>
        <nav className="flex flex-wrap gap-x-4 gap-y-2 text-zinc-400" aria-label="Legal and help">
          <Link href="/how-it-works" className="hover:text-white underline-offset-4 hover:underline">
            How it works
          </Link>
          <Link href="/terms" className="hover:text-white underline-offset-4 hover:underline">
            Terms of Service
          </Link>
          <Link href="/raffles" className="hover:text-white underline-offset-4 hover:underline">
            Browse raffles
          </Link>
        </nav>
      </div>
    </footer>
  )
}
