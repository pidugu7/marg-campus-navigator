import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { defineConfig } from 'vitest/config'

/**
 * MARG Campus Navigator — build + test config.
 *
 * Decisions worth knowing about:
 *  - `base: './'` so the built app works when GitHub Pages serves it from
 *    /marg-campus-navigator/ rather than the domain root.
 *    (This does NOT make the bundle openable over file:// — module scripts are
 *    blocked by CORS there. Serve the build: `npm run preview`.)
 *  - The campus dataset is a bundled `import` of src/data/campus.json, never a
 *    fetch(). No backend, no runtime network requests, works fully offline.
 *  - `--mode singlefile` inlines JS+CSS into one dist/index.html, which is a
 *    convenient submission artefact for a coursework hand-in.
 */
export default defineConfig(({ mode }) => {
  const singleFile = mode === 'singlefile'

  return {
    base: './',
    plugins: [react(), ...(singleFile ? [viteSingleFile()] : [])],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src/', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      // The sandboxed live preview reaches the dev server through a proxied
      // host name; without this Vite's host check would reject the request.
      allowedHosts: ['.e2b.app'],
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: ['.e2b.app'],
    },
    build: {
      target: 'es2023',
      // Maps stay off the single-file artefact: it is the file you hand in, and
      // a 1 MB sidecar next to it would be noise.
      sourcemap: singleFile ? false : true,
      // The single-file artefact lands in its own folder so a normal `dist/`
      // is never silently left half-inlined.
      ...(singleFile ? { outDir: 'dist-single', emptyOutDir: true } : {}),
      // The whole app is a few hundred KB of hand-written code; a single chunk
      // keeps the Pages/single-file submissions identical in behaviour.
      modulePreload: { polyfill: false },
    },
    test: {
      // `.spec.ts` is the convention for engine modules (they sit beside the file they test);
      // `.test.ts` stays valid so the Phase 0 guards never silently stop running.
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts', 'src/**/*.spec.tsx'],
      // Engine + architecture specs run in plain node. Component specs opt into
      // jsdom per file with a `@vitest-environment jsdom` docblock (Phase 5).
      environment: 'node',
      restoreMocks: true,
      clearMocks: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json-summary', 'html'],
        // The data layer's validator is in scope from Phase 2: it is decision logic with 66 specs
        // behind it, and leaving it out would make the report describe only half the tested code.
        include: [
          'src/engine/**',
          'src/data/**',
          // The map's pure modules — camera, decluttering, tip wording, icon table, route geometry — and the
          // route form's are arithmetic with specs and no React in them, so they belong in the same report as
          // the rest of the decision logic. The hooks and `.tsx` layers stay out *by name*: this project has no
          // DOM to measure them with, and adding one means adding `jsdom`, which the brief rules out. So the
          // list is exhaustive about what can be covered and the report says so, rather than carrying a figure
          // that quietly omits the untestable half.
          'src/ui/map/view.ts',
          'src/ui/map/marker-plan.ts',
          'src/ui/map/route-plan.ts',
          'src/ui/map/tip-content.ts',
          'src/ui/map/icons.ts',
          'src/ui/route/route-options.ts',
          // Phase 3 cp5: the three route components joined this list because they became *renderable* in Node —
          // `renderToStaticMarkup` needs no DOM and `react-dom/server` is already a dependency. That covers the
          // render half of a component, which is most of what they do; the gesture and effect code in the map's
          // own hooks still has no harness to measure, so it stays out by name.
          'src/ui/route/route-card.tsx',
          'src/ui/route/route-controls.tsx',
          'src/ui/route/route-summary.ts',
          'src/ui/map/layers/route-layer.tsx',
          // Phase 4 cp3: the replay's decision logic is arithmetic over two arrays and is tested exhaustively, and
          // its two components render in Node like the route's do. The clock that reads them — `src/hooks/useReplay.ts`
          // — is a `setInterval` and its cleanup, and belongs with the hook code above: no DOM, no measurement.
          'src/ui/map/replay-plan.ts',
          'src/ui/route/replay-panel.tsx',
          'src/ui/map/layers/replay-layer.tsx',
          // Phase 4 cp4: compare mode, same arrangement — the decisions in a pure module, the rendering in
          // components that `renderToStaticMarkup` can reach, and the searching in a hook that is excluded with
          // the other hooks because a `useMemo` over three calls has no assertions a Node harness can make.
          'src/ui/compare/compare-plan.ts',
          'src/ui/compare/compare-table.tsx',
          'src/ui/compare/compare-legend.tsx',
          'src/ui/compare/compare-swatch.tsx',
          'src/ui/map/layers/compare-layer.tsx',
        ],
        exclude: [
          'src/engine/**/*.test.ts',
          'src/engine/**/*.spec.ts',
          'src/engine/**/helpers.ts',
          'src/data/**/*.spec.ts',
          // Type-only surfaces: neither file contains a runtime statement, so v8 reports 0/0 and
          // renders it as 0%, which drags the aggregate down while saying nothing about tests.
          'src/engine/index.ts',
          'src/engine/types.ts',
          'src/data/campus.types.ts',
          'src/data/campus.json',
        ],
      },
    },
  }
})
