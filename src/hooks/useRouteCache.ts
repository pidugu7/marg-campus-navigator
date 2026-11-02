/**
 * The hook that owns what the route cache reports: the counters on screen, and the one way to reset them.
 *
 * Two decisions in this file are worth stating because they are the ones a reviewer would ask about.
 *
 * **Why the epoch exists.** `LRUCache`'s counters are mutable state, and React does not let a component read
 * mutable state during render — it would be a different number in every child, and a value that changes while
 * the tree is rendering is the definition of a tearing UI. So the view is read inside a `useMemo`, and clearing
 * has to make that memo run again. Bumping a number is how you say "the thing you memoised on is different now"
 * when the thing that changed is not in the props; the alternative is `useSyncExternalStore`, which for two
 * counters and a `clear` button is more machinery than the machinery solves.
 *
 * **Why this is a hook and not a call in `App`.** `src/ui` may not import `@/engine` — the architecture test's
 * one hard boundary — so the cache's numbers have to arrive through `src/hooks`, the same door every other
 * engine fact comes through. That is the reason this file is four lines of logic and a paragraph about a door.
 */
import { useCallback, useMemo, useState } from 'react'
import { clearRouteCache, routeCacheView } from '@/engine'
import type { GraphIndex, RouteCacheView } from '@/engine'

export interface RouteCacheState {
  /** The counters, read once per dependency change rather than once per render. `null` with no graph. */
  readonly view: RouteCacheView | null
  /** Empty the entries and the counters, and let the badge see it happen. */
  readonly clear: () => void
}

/**
 * Reads the cache belonging to `index`, and clears it on request.
 *
 * `signature` is the query the card is currently answering — the pair, the algorithm, the preference and the
 * closure count, joined by the caller. It is not used to *look anything up*; it is the dependency that makes the
 * counters move, because a cache whose hit rate changed while nothing was re-memoised would show a stale rate
 * until the user happened to touch a picker. A second reason it is a string and not four arguments: four
 * arguments would be four chances to forget one in the list.
 */
export function useRouteCache(index: GraphIndex | null, signature: string): RouteCacheState {
  const [epoch, setEpoch] = useState(0)
  // React cannot see that this reads module state, so the linter's point stands and is answered in the open
  // rather than by removing the dependency that makes the value correct: `epoch` and `signature` are what the
  // memo depends on *in fact*, and the alternative it would prefer — `useSyncExternalStore` — needs the cache to
  // notify subscribers and to hand back a referentially stable snapshot, which for two counters is a second
  // data structure per read. The `docs/ARCHITECTURE.md` note on this hook says the same thing at the length it
  // deserves, and cp5's checkpoint log records the trade.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => routeCacheView(index), [index, epoch, signature])
  const clear = useCallback(() => {
    if (index !== null) clearRouteCache(index)
    // The bump is what re-reads the counters; the clear itself has no return value to trust, and re-reading is
    // what makes the badge show the truth instead of what `clear` claimed.
    setEpoch((previous) => previous + 1)
  }, [index])
  return { view, clear }
}

/** The type the route card prints, re-exported so `src/ui` names a hook rather than the engine. */
export type { RouteCacheView }
