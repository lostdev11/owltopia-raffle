'use client'

import Link from 'next/link'

export function Footer() {
  return (
    <footer className="w-full bg-black border-t border-green-500/20 mt-auto">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
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
    </footer>
  )
}
