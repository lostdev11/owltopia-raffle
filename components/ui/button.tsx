'use client'

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 touch-manipulation cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const INVOKE_DEBOUNCE_MS = 400

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (props, ref) => {
    const { className, variant, size, asChild = false, onClick, children, ...rest } = props
    const lastInvokeRef = React.useRef<number>(0)
    const restProps = rest as Omit<typeof rest, 'asChild'>

    const invokeClick = React.useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        if (restProps.disabled) return
        const now = Date.now()
        if (now - lastInvokeRef.current < INVOKE_DEBOUNCE_MS) return
        lastInvokeRef.current = now
        e.stopPropagation()
        onClick?.(e)
      },
      [onClick, restProps.disabled]
    )

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      invokeClick(e)
    }

    const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 && e.button !== undefined) return
      if (restProps.disabled) return
      invokeClick(e as unknown as React.MouseEvent<HTMLButtonElement>)
    }

    const baseProps = {
      className: cn(buttonVariants({ variant, size, className })),
      onClick: handleClick,
      onPointerUp: handlePointerUp,
      ...restProps,
    }

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, { ...baseProps, ref } as Record<string, unknown>)
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...restProps}
        onClick={handleClick}
        onPointerUp={handlePointerUp}
      >
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
