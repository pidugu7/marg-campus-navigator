import { Boxes, Compass, Database, Route as RouteIcon, ShieldCheck } from 'lucide-react'
import { useEngineContract } from '@/hooks/useEngineContract'
import { useCampus } from '@/hooks/useCampus'
import '@/styles/app.css'

/**
 * Phase 0 shell. It proves three things and nothing else:
 *  1. the dataset reaches the browser through a bundled import, not a request;
 *  2. React can read engine values only via a hook over the barrel;
 *  3. the SVG plate that Phases 2–7 draw on exists at the right size.
 *
 * No controls here yet: a search box that cannot search would be a lie with a
 * border around it.
 */
export default function App() {
  const campusInfo = useCampus()
  const engine = useEngineContract()
  const { canvas, gridStep } = campusInfo
  const majorStep = gridStep * 10

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
          <span className="chip">
            <ShieldCheck size={13} aria-hidden="true" />
            boundary tests green
          </span>
        </div>
      </header>

      <main className="work">
        <svg
          className="map"
          viewBox={`0 0 ${canvas.width} ${canvas.height}`}
          role="img"
          aria-label={`Empty map plate for ${campusInfo.meta.campus}. Buildings and walkways arrive in Phase 2.`}
        >
          <defs>
            <pattern id="grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
              <path
                d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`}
                style={{ fill: 'none', stroke: 'var(--map-grid)', strokeWidth: 0.5 }}
              />
            </pattern>
            <pattern id="grid-major" width={majorStep} height={majorStep} patternUnits="userSpaceOnUse">
              <path
                d={`M ${majorStep} 0 L 0 0 0 ${majorStep}`}
                style={{ fill: 'none', stroke: 'var(--map-grid-major)', strokeWidth: 1 }}
              />
            </pattern>
          </defs>

          <rect x={0} y={0} width={canvas.width} height={canvas.height} fill="url(#grid)" />
          <rect x={0} y={0} width={canvas.width} height={canvas.height} fill="url(#grid-major)" />

          <g className="map-note" textAnchor="middle">
            <text x={canvas.width / 2} y={canvas.height / 2 - 26} style={{ fontSize: 30, fontWeight: 600 }}>
              Map plate · {canvas.width} × {canvas.height}
            </text>
            <text x={canvas.width / 2} y={canvas.height / 2 + 6} style={{ fontSize: 17, opacity: 0.75 }}>
              grid {majorStep / canvas.pixelsPerMetre} m · {campusInfo.nodeCount} nodes · {campusInfo.edgeCount}{' '}
              walkway segments
            </text>
            <text x={canvas.width / 2} y={canvas.height / 2 + 34} style={{ fontSize: 15, opacity: 0.55 }}>
              Geometry is drawn in Phase 2; the algorithms that use it are written in Phases 1 and 3.
            </text>
          </g>
        </svg>

        <aside className="side">
          <section className="card">
            <h2>
              <RouteIcon size={13} aria-hidden="true" />
              What this phase proves
            </h2>
            <ul>
              <li>
                Vite + React + TypeScript build, Vitest, ESLint and the <code>@</code> alias all run green.
              </li>
              <li>
                <code>src/engine</code> is a pure TypeScript package: it exports a contract and imports no UI
                framework.
              </li>
              <li>
                An architecture test enforces that separation, the dependency allowlist, and the ban on
                off-the-shelf graph libraries.
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
              <dt>engine</dt>
              <dd>{engine.version}</dd>
              <dt>cost epsilon</dt>
              <dd>{engine.costEpsilon}</dd>
              <dt>min segment</dt>
              <dd>{engine.minSegmentMetres} m</dd>
            </dl>
          </section>

          <section className="card">
            <h2>Next</h2>
            <ul>
              <li>Phase 1: min-heap, trie, union-find, LRU cache — hand-written, unit-tested.</li>
              <li>Phase 2: the campus dataset and the map you can pan and zoom.</li>
            </ul>
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
