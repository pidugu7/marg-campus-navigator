import { useMemo, useState } from 'react'
import { AlertTriangle, Boxes, CheckCircle2, Compass, Database, Route as RouteIcon, Table } from 'lucide-react'
import { useCampus } from '@/hooks/useCampus'
import { useEngineContract } from '@/hooks/useEngineContract'
import { useRoute } from '@/hooks/useRoute'
import { useRouteCache } from '@/hooks/useRouteCache'
import { ReplayPanel } from '@/ui/route/replay-panel'
import { RouteCard } from '@/ui/route/route-card'
import type { ReplaySource } from '@/ui/map/replay-plan'
import { RouteControls } from '@/ui/route/route-controls'
import type { RouteView } from '@/ui/route/route-card'
import { DEFAULT_PROFILE, algorithmChoice, placeOptions, profileChoices, swapEndpoints } from '@/ui/route/route-options'
import { profileDelta } from '@/ui/route/route-summary'
import { useReplay } from '@/hooks/useReplay'
import type { ProfileName } from '@/ui/route/route-options'
import type { RouteAlgorithmChoice } from '@/hooks/useRoute'
import { CompareLegend } from '@/ui/compare/compare-legend'
import { CompareTable } from '@/ui/compare/compare-table'
import { compareInsight, lanesOf } from '@/ui/compare/compare-plan'
import { useCompare } from '@/hooks/useCompare'
import { MapView } from '@/ui/map/map-view'
import '@/styles/app.css'
import '@/styles/map.css'

/**
 * The shell. Phases 0 and 1 proved the boundaries; Phase 2 puts a campus on the plate.
 *
 * Note what this file does *not* do: it never imports `@/engine`. Everything it draws and counts arrives
 * through `useCampus` (the one module allowed to call `buildGraph`) and `useRoute` (the one allowed to call a
 * search). That is the rule the architecture test enforces, and the reason a component can be rewritten — or the
 * map replaced by a canvas renderer, or a search swapped for a cached router — without touching an algorithm.
 */
export default function App() {
  const campusInfo = useCampus()
  const engine = useEngineContract()
  const { canvas, gridStep, model } = campusInfo
  const issues = model.issues

  // The route state lives here, in the shell, and nowhere else: the map needs the line and the panel needs the
  // numbers, and a control that owns its own copy of `from` is how a UI ends up drawing a route for a pair of
  // places it is not showing. Both pickers are empty at first — the map shows the campus, and asking for a
  // route is a decision rather than a default.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [algorithm, setAlgorithm] = useState<RouteAlgorithmChoice>('a-star')
  // The preference is state like the other three, and for the same reason: it belongs to the *request*, so the
  // map line and the card must agree about which cost function drew them. `DEFAULT_PROFILE` is the engine's
  // baseline, which is the one profile whose numbers need no explanation.
  const [profile, setProfile] = useState<ProfileName>(DEFAULT_PROFILE)
  const { result, baseline } = useRoute(model.graph, from, to, algorithm, profile)
  // The cache's counters, read once per query rather than once per render (`useRouteCache` says why). The
  // signature is the query the card is answering, and it is a string for the same reason the hook's arguments
  // are: four separate dependencies is four chances to forget one, and a rate that updates only when someone
  // remembers to re-read it is a rate nobody believes.
  const cache = useRouteCache(model.graph, `${from}>${to} ${algorithm} ${profile}`)
  const labelOf = useMemo(() => new Map(model.nodes.map((node) => [node.id, node.label])), [model])
  // The picker's rows are the engine's own labels and blurbs, narrowed to the UI's union — which is where a
  // sixth profile in `routing/cost.ts` would stop compiling, in the file that has to give it a name.
  const profiles = useMemo(() => profileChoices(engine.profiles, engine.profileOrder), [engine])

  // The replay reads the *result*, not a second search: `exploredOrder` and `frontierSnapshots` are what the run
  // recorded while it ran, so the overlay cannot disagree with the numbers in the card. A refusal carries them
  // too — the empty region is the explanation, and it is the frame most worth replaying.
  const replaySource = useMemo<ReplaySource>(
    () => ({
      exploredOrder: result?.exploredOrder ?? [],
      frontierSnapshots: result?.frontierSnapshots ?? [],
      path: result !== null && result.ok ? result.nodeIds : [],
      seed: from === '' ? null : from,
    }),
    [result, from],
  )
  const replay = useReplay(replaySource, `${from}>${to} ${algorithm} ${profile}`)

  // Compare mode is the same request asked three ways, so it takes its arguments from the same four pieces of
  // state and nothing else: any difference in the table then has to come from the algorithm. The insight sentence
  // is generated from the rows below, never written here.
  const [compare, setCompare] = useState(false)
  const comparison = useCompare(model.graph, from, to, profile, compare)
  const labelOfAlgorithm = useMemo(() => (name: RouteAlgorithmChoice) => algorithmChoice(name).label, [])
  const insight = useMemo(
    () =>
      compareInsight(comparison.rows, {
        sameEndpoint: from !== '' && from === to,
        profile: engine.profiles[profile].label,
        labelOf: labelOfAlgorithm,
      }),
    [comparison.rows, from, to, profile, engine, labelOfAlgorithm],
  )
  const lanes = compare ? lanesOf(comparison.rows) : []

  // The engine's result, narrowed to what a card can draw. `direction` and `reason` keep their string values on
  // purpose: the view model declares the unions it needs, so this is where a new turn bucket or a new refusal
  // reason stops compiling and gets an answer written for it.
  const view = useMemo<RouteView | null>(() => {
    if (result === null) return null
    if (!result.ok) {
      return {
        state: 'missing',
        failure: { reason: result.reason, message: result.message, explored: result.exploredOrder.length },
      }
    }
    return {
      state: 'found',
      // Two facts about provenance, both from the same place the numbers come from: whether this answer was
      // remembered, and what the cache has been doing all session. A card with no `cache` says nothing about
      // where its numbers came from rather than guessing — which is what a test-built card does.
      cache: {
        cached: result.cached,
        hits: cache.view?.hits ?? 0,
        misses: cache.view?.misses ?? 0,
        lookups: cache.view?.lookups ?? 0,
        size: cache.view?.size ?? 0,
        capacity: cache.view?.capacity ?? 0,
        evictions: cache.view?.evictions ?? 0,
      },
      route: {
        algorithm: result.algorithm,
        metres: result.metres,
        minutes: result.minutes,
        hops: result.hops,
        expanded: result.expanded,
        ms: result.ms,
        nodeCount: result.nodeIds.length,
        steps: result.steps.map((step) => ({
          instruction: step.instruction,
          metres: step.metres,
          direction: step.direction,
        })),
      },
      paceMps: engine.walkingSpeedMps[result.profile],
      profile: {
        label: engine.profiles[result.profile].label,
        // A baseline that refused, or that was never run, is no comparison — and `profileDelta` answers with
        // `null` rather than with a zero, so the card prints no price rather than a misleading one.
        delta: profileDelta(
          { metres: result.metres, minutes: result.minutes },
          baseline === null || !baseline.ok
            ? null
            : { metres: baseline.metres, minutes: baseline.minutes },
        ),
      },
    }
  }, [result, baseline, engine, cache.view])
  const places = useMemo(() => placeOptions(model.nodes, model.edges), [model])

  // The map takes four strings and an id list; it never sees a `RouteResult`. Unwrapping the union is this
  // file's job, and it is the only place the two halves of the app are allowed to meet.
  const route =
    result !== null && result.ok
      ? {
          nodeIds: result.nodeIds,
          metres: result.metres,
          // The name of what was *asked*, not of what came back: the result echoes its own algorithm, and the
          // shared contract says that echo is the request, so reading the picker is both simpler and one less
          // union to narrow.
          algorithmLabel: algorithmChoice(algorithm).label,
          startLabel: labelOf.get(from) ?? from,
          destinationLabel: labelOf.get(to) ?? to,
        }
      : null

  return (
    <div className="shell">
      <header className="masthead card">
        <span className="mark" aria-hidden="true">
          <Compass size={22} strokeWidth={1.75} />
        </span>
        <div>
          <h1>{campusInfo.meta.app}</h1>
          <p className="campus">{campusInfo.title}</p>
        </div>
        <div className="chips">
          <span className="chip">
            <Boxes size={13} aria-hidden="true" />
            engine <code>{engine.version}</code>
          </span>
          <span className={model.ok ? 'chip chip--ok' : 'chip chip--warn'}>
            {model.ok ? <CheckCircle2 size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
            {model.errors} error{model.errors === 1 ? '' : 's'}, {model.warnings} warning
            {model.warnings === 1 ? '' : 's'}
          </span>
          {campusInfo.isPlaceholder ? (
            <span className="chip chip--warn" title={campusInfo.meta.notes}>
              <Database size={13} aria-hidden="true" />
              placeholder map data
            </span>
          ) : (
            <span className="chip chip--ok">
              <Database size={13} aria-hidden="true" />
              {campusInfo.status}
            </span>
          )}
        </div>
      </header>

      <main className="work">
        <MapView
          model={model}
          canvas={canvas}
          placeRows={campusInfo.nodes}
          buildings={campusInfo.buildings}
          surfaces={campusInfo.surfaces}
          zones={campusInfo.zones}
          gridStep={gridStep}
          route={route}
          replay={replay.available ? replay.frame : null}
          compare={lanes.length === 0 ? null : lanes}
        />

        <aside className="side">
          <section className="card">
            <h2>
              <RouteIcon size={13} aria-hidden="true" />
              Route
            </h2>
            <RouteControls
              options={places}
              from={from}
              to={to}
              algorithm={algorithm}
              profile={profile}
              profiles={profiles}
              onFrom={setFrom}
              onTo={setTo}
              onAlgorithm={setAlgorithm}
              onProfile={setProfile}
              compare={compare}
              onCompare={setCompare}
              // The same facts the card prints, so the button's label and the badge cannot drift into describing
              // two different caches. `cached` is not a cache fact — it is a fact about *this answer* — which is
              // why the two objects are built here rather than one being passed down twice.
              cache={cache.view === null ? null : { ...cache.view, cached: result?.cached ?? false }}
              onClearCache={cache.clear}
              onSwap={() => {
                // One pair of updates, both from the previous values: two `setState` calls that read the state
                // above them would swap `a → b` into `b → b`, because React hands each callback the value from
                // the same render.
                const [nextFrom, nextTo] = swapEndpoints(from, to)
                setFrom(nextFrom)
                setTo(nextTo)
              }}
            />
            {/* The answer under the question: the card reads the same state the map is drawing from, so the two
                can never disagree about which pair is being routed. */}
            <RouteCard fromLabel={labelOf.get(from) ?? from} toLabel={labelOf.get(to) ?? to} view={view} />

            {/* Under the answer, because it explains the answer rather than adding to it. A refusal still gets
                the panel: replaying a search that ran out of map is the most useful replay on this app. */}
            {result === null ? null : (
              <ReplayPanel
                frame={replay.frame}
                state={replay.state}
                algorithmLabel={algorithmChoice(algorithm).label}
                dispatch={replay.dispatch}
              />
            )}
          </section>

          {/* Its own card, and only when it was asked for: three searches that nobody wants are three searches
              that should not run, and a table of nothing is a hole in the column where the map report lives. */}
          {compare && comparison.active ? (
            <section className="card">
              <h2>
                <Table size={13} aria-hidden="true" />
                Compare
              </h2>
              <CompareLegend rows={comparison.rows} labelOf={labelOfAlgorithm} />
              <CompareTable
                rows={comparison.rows}
                labelOf={labelOfAlgorithm}
                profileLabel={engine.profiles[profile].label}
                insight={insight}
              />
            </section>
          ) : null}

          <section className="card">
            <h2>
              <RouteIcon size={13} aria-hidden="true" />
              Map data report
            </h2>
            <p className="lede">
              <code>npm run map:validate</code> reads <code>src/data/campus.json</code> against{' '}
              <code>docs/SCHEMA.md</code>. The same function ran on the way here, so what you can see and
              what the validator accepted are the same data.
            </p>
            <ul className="report">
              {issues.length === 0 ? (
                <li className="report-clear">no issues · {model.summary.componentCount} component</li>
              ) : (
                issues.map((issue) => (
                  <li key={`${issue.code}-${issue.subject}-${issue.message}`} className={`report-${issue.severity}`}>
                    <code>{issue.code}</code>
                    <span>{issue.message}</span>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="card">
            <h2>What this phase proves</h2>
            <ul>
              <li>
                A campus model in <code>src/data/campus.json</code>: {model.summary.placeCount} places and{' '}
                {model.summary.nodeCount - model.summary.placeCount} junctions,{' '}
                {model.summary.edgeCount} walkway segments in {model.summary.componentCount} connected
                component, with a loop so there is more than one way to get anywhere.
              </li>
              <li>
                The SVG map pans, zooms by wheel and pinch, and resets — camera arithmetic in{' '}
                <code>src/ui/map/view.ts</code>, tested without a DOM.
              </li>
              <li>
                Every structure and algorithm is hand-written in <code>src/engine</code>, which imports no
                UI framework and is reached only through <code>src/hooks</code>.
              </li>
            </ul>
          </section>

          <section className="card">
            <h2>Contract values</h2>
            <dl>
              <dt>campus</dt>
              <dd>{campusInfo.meta.campus}</dd>
              <dt>data status</dt>
              <dd>{campusInfo.meta.dataStatus}</dd>
              <dt>scale</dt>
              <dd>{canvas.pixelsPerMetre} px/m</dd>
              <dt>walkway</dt>
              <dd>
                {model.summary.totalMetres} m · longest {model.summary.longestEdgeMetres} m
              </dd>
              <dt>engine</dt>
              <dd>{engine.version}</dd>
              <dt>cost epsilon</dt>
              <dd>{engine.costEpsilon}</dd>
              <dt>min segment</dt>
              <dd>{engine.minSegmentMetres} m</dd>
            </dl>
          </section>
        </aside>
      </main>

      <footer className="footnote card">
        <span>Course project · Data Structures &amp; Algorithms</span>
        <span>No backend · no graph libraries · all algorithms hand-written</span>
        <span>Serve a build with npm run preview (module scripts will not load over file://)</span>
      </footer>
    </div>
  )
}
