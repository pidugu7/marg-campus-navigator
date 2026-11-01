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
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      // Engine + architecture specs run in plain node. Component specs opt into
      // jsdom per file with a `@vitest-environment jsdom` docblock (Phase 5).
      environment: 'node',
      restoreMocks: true,
      clearMocks: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json-summary', 'html'],
        include: ['src/engine/**'],
        exclude: ['src/engine/**/*.test.ts', 'src/engine/**/helpers.ts'],
      },
    },
  }
})
