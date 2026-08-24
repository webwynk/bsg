import { useCallback, useMemo, useRef } from "react"

/**
 * Guards against out-of-order responses when a fetch function can be
 * triggered from more than one place at once (a live-push event, the
 * shared fallback timer, a manual refresh click, a filter change) --
 * without this, a slower/older request that happens to resolve after a
 * newer one would silently overwrite it. Signature-agnostic by design: it
 * doesn't own the fetch itself, just hands back a token generator and a
 * checker, so it drops into any existing fetch function with 2 added lines
 * regardless of that function's own arguments or shape.
 *
 * Usage:
 *   const { nextGeneration, isCurrent } = useRequestGeneration()
 *   const loadX = useCallback(() => {
 *     const token = nextGeneration()
 *     someAction().then((res) => {
 *       if (!isCurrent(token)) return // a newer call has since started
 *       setState(res)
 *     })
 *   }, [nextGeneration, isCurrent])
 */
export function useRequestGeneration() {
  const generationRef = useRef(0)

  const nextGeneration = useCallback(() => {
    generationRef.current += 1
    return generationRef.current
  }, [])

  const isCurrent = useCallback((token: number) => token === generationRef.current, [])

  // Memoized so the returned object itself is referentially stable across
  // renders -- nextGeneration/isCurrent are each already stable (empty-dep
  // useCallback), but without this, the wrapping object would be a fresh
  // literal every render, which would silently defeat any useCallback that
  // lists this hook's return value as a dependency (a new "stable" reference
  // every render is not actually stable).
  return useMemo(() => ({ nextGeneration, isCurrent }), [nextGeneration, isCurrent])
}
