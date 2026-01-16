'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface HootBoostMeterProps {
  quantity: number
  className?: string
}

export function HootBoostMeter({ quantity, className }: HootBoostMeterProps) {
  const [animatedValue, setAnimatedValue] = useState(0)

  useEffect(() => {
    // Animate the meter when quantity changes
    const target = Math.min(quantity * 10, 100) // 10% per ticket, max 100%
    const duration = 300
    const steps = 20
    const increment = target / steps
    let current = 0
    let step = 0

    const timer = setInterval(() => {
      step++
      current = Math.min(increment * step, target)
      setAnimatedValue(current)

      if (step >= steps) {
        clearInterval(timer)
      }
    }, duration / steps)

    return () => clearInterval(timer)
  }, [quantity])

  const percentage = Math.min(quantity * 10, 100)

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Hoot Boost</span>
        <span className="font-semibold text-primary">{Math.round(animatedValue)}%</span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full bg-gradient-to-r from-primary/50 to-primary transition-all duration-300 ease-out"
          style={{ width: `${animatedValue}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Boost is just for hype—each ticket = one entry.
      </p>
    </div>
  )
}
