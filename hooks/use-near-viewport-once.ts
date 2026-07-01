'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Becomes true once the observed element enters (or nears) the viewport.
 */
export function useNearViewportOnce(rootMargin = '240px 0px') {
  const [visible, setVisible] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    return () => observerRef.current?.disconnect()
  }, [])

  const ref = useCallback(
    (el: HTMLElement | null) => {
      observerRef.current?.disconnect()
      observerRef.current = null
      if (!el || visible) return

      if (typeof IntersectionObserver === 'undefined') {
        setVisible(true)
        return
      }

      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setVisible(true)
            io.disconnect()
            observerRef.current = null
          }
        },
        { rootMargin }
      )
      observerRef.current = io
      io.observe(el)
    },
    [visible, rootMargin]
  )

  return { ref, visible }
}
