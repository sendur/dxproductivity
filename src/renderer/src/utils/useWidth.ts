import { useEffect, useRef, useState } from 'react'

/** Tracks an element's content width so SVGs draw at real pixels (text never scales). */
export function useWidth<T extends HTMLElement>(
  fallback: number,
  min: number,
  deps: unknown[] = []
): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(min, Math.floor(entry.contentRect.width)))
    )
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return [ref, width]
}
