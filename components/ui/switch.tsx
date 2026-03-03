'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SwitchProps
  extends Omit<React.ComponentPropsWithoutRef<'input'>, 'type' | 'role'> {
  /** Accessible description for screen readers (required for the switch use) */
  ariaLabel: string
  id: string
  name?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  className?: string
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ ariaLabel, id, name, checked, onCheckedChange, className, ...props }, ref) => (
    <label htmlFor={id} className={cn('gg-c-switch', className)}>
      <span className="gg-u-screen-reader-only">{ariaLabel}</span>
      <input
        ref={ref}
        type="checkbox"
        role="switch"
        name={name ?? id}
        id={id}
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        aria-checked={checked}
        {...props}
      />
      <span className="gg-c-switch__slider gg-c-switch__slider--on-off" aria-hidden />
    </label>
  )
)
Switch.displayName = 'Switch'

export { Switch }
