import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  clearScreen: false,
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
