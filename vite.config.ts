import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  test: {
    environment: 'node',
  },
  clearScreen: false,
  /**
   * `quickjs-emscripten` loads `emscripten-module.wasm` via `new URL(..., import.meta.url)`.
   * Pre-bundling **only** those packages into `.vite/deps/` breaks that URL (404 → "both async
   * and sync fetching of the wasm failed"). Exclude the QuickJS chain so wasm stays next to the
   * real files under `node_modules`.
   *
   * Do **not** exclude `@arrow-js/sandbox` itself: the sandbox imports `typescript` as a default
   * CJS interop (`import ts from 'typescript'`). Serving raw `typescript.js` in the browser
   * throws "does not provide an export named 'default'". Let Vite pre-bundle the sandbox so
   * TypeScript is wrapped correctly; it will still `import` the excluded QuickJS packages from
   * `node_modules`.
   */
  optimizeDeps: {
    exclude: [
      'quickjs-emscripten',
      'quickjs-emscripten-core',
      '@jitl/quickjs-wasmfile-release-asyncify',
      '@jitl/quickjs-wasmfile-debug-asyncify',
      '@jitl/quickjs-wasmfile-release-sync',
      '@jitl/quickjs-wasmfile-debug-sync',
    ],
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  plugins: [
    devtools(),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart({
      spa: {
        prerender: {
          enabled: true,
          outputPath: '/index.html',
          autoSubfolderIndex: true,
          crawlLinks: false,
          retryCount: 2,
          retryDelay: 500,
        },
      },
    }),
    viteReact(),
  ],
})
