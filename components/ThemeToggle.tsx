'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ThemeMode = 'dark' | 'light'

const STORAGE_KEY = 'owl-theme'

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
}

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false)
  const [theme, setTheme] = useState<ThemeMode>('dark')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    const nextTheme: ThemeMode = stored === 'light' ? 'light' : 'dark'
    applyTheme(nextTheme)
    setTheme(nextTheme)
    setMounted(true)
  }, [])

  const toggleTheme = () => {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark'
    applyTheme(nextTheme)
    localStorage.setItem(STORAGE_KEY, nextTheme)
    setTheme(nextTheme)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="h-10 w-10 min-h-[44px] min-w-[44px] touch-manipulation"
      aria-label={mounted && theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={mounted && theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {mounted && theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  )
}
