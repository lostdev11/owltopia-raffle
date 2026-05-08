'use client'

import { usePathname } from 'next/navigation'

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div
      key={pathname}
      className="min-h-full max-md:animate-none md:animate-page-enter motion-reduce:animate-none"
    >
      {children}
    </div>
  )
}
