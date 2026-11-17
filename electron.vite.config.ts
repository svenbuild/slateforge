import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

// The strict content security policy in index.html blocks the inline scripts
// that the dev server needs for hot reload, so it is only kept in real builds.
const relaxCspInDev: Plugin = {
  name: 'relax-csp-in-dev',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/, '')
}

export default defineConfig({
  // Two programs: the app itself and the command line tool for AI agents.
  main: {
    build: { rollupOptions: { input: { index: 'src/main/index.ts', cli: 'src/main/cli.ts' } } }
  },
  preload: {},
  renderer: {
    plugins: [react(), relaxCspInDev]
  }
})
