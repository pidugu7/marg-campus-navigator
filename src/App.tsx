import { AlertTriangle, Boxes, CheckCircle2, Compass, Database, Route as RouteIcon } from 'lucide-react'
import { useCampus } from '@/hooks/useCampus'
import { useEngineContract } from '@/hooks/useEngineContract'
import { MapView } from '@/ui/map/map-view'
import '@/styles/app.css'
import '@/styles/map.css'

/**
 * The shell. Phases 0 and 1 proved the boundaries; Phase 2 puts a campus on the plate.
 *
 * Note what this file does *not* do: it never imports `@/engine`. Everything it draws and counts arrives
 * through `useCampus`, which is the one module allowed to call `buildGraph`. That is the rule the
 * architecture test enforces, and the reason a component can be rewritten — or the map replaced by a
 * canvas renderer — without touching a single algorithm.
 */
export default function App() {
  const campusInfo = useCampus()
  const engine = useEngineContract()
  const { canvas, gridStep, model } = campusInfo
  const issues = model.issues

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
        />

        <aside className="side">
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
