import { defineConfig } from 'vite'
import { resolve } from 'path'

// Relative base so the build works from any GitHub Pages sub-path
// (https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
  server: { port: 3000 },
  preview: { port: 3000 },
  build: {
    rollupOptions: {
      input: {
        // headless entry loaded on board open
        index: resolve(__dirname, 'index.html'),
        // panel UI opened from the toolbar icon
        app: resolve(__dirname, 'app.html'),
      },
    },
  },
})
