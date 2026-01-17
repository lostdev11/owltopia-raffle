'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

const externalLinks = [
  { name: 'Staking', url: 'https://www.nftstake.app/owltopia' },
  { name: 'X', url: 'https://x.com/Owltopia_sol' },
  { name: 'Whitepaper', url: 'https://tinyurl.com/owltopia' },
  { name: 'Mint', url: 'https://www.nftlaunch.app/mint/owltopia' },
  { name: 'ME', url: 'https://magiceden.io/marketplace/owltopia' },
  { name: 'Tensor', url: 'https://www.tensor.trade/trade/owltopia' },
  { name: 'Atlas3', url: 'https://atlas3.io/project/owltopia' },
  { name: 'Discord', url: 'https://discord.gg/nRD2wyg2vq' },
]

export function Footer() {
  return (
    <footer className="w-full bg-black border-t border-green-500/20 mt-auto">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col gap-6">
          {/* External Links Section */}
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            {externalLinks.map((link) => (
              <a
                key={link.name}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
              >
                {link.name}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
          
          {/* Copyright and Terms Section */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground border-t border-green-500/10 pt-4">
            <div className="flex items-center gap-4">
              <span>© {new Date().getFullYear()} Owl Raffle</span>
            </div>
            <div className="flex items-center gap-6">
              <Link 
                href="/terms" 
                className="hover:text-foreground transition-colors underline-offset-4 hover:underline"
              >
                Terms of Service
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
