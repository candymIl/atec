import { defineConfig } from 'vite'

const buildId = process.env.VITE_BUILD_ID || new Date().toISOString().replace(/[:.]/g, '-')
const buildTimestamp = process.env.VITE_BUILD_TIMESTAMP || new Date().toISOString()

process.env.VITE_BUILD_ID = buildId
process.env.VITE_BUILD_TIMESTAMP = buildTimestamp

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    {
      name: 'atec-build-info',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: `${JSON.stringify({
            buildId,
            buildTimestamp
          }, null, 2)}\n`
        })
      }
    }
  ]
})
