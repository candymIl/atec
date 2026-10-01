const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

async function main() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atec-profile-test-'))
  const filename = path.resolve(__dirname, '../../backend/services/certificateRenderer.js')
  const nativeRequire = createRequire(filename)
  const context = {
    module: { exports: {} }, __dirname: path.dirname(filename), console,
    process: { platform: 'linux', env: {} },
    require(name) {
      if (name === 'os') return { ...os, homedir: () => fixture }
      if (name === 'fs') return { ...fs, existsSync: p => p === '/snap/bin/chromium' || fs.existsSync(p) }
      return nativeRequire(name)
    }
  }
  try {
    vm.runInNewContext(fs.readFileSync(filename, 'utf8') +
      '\nmodule.exports.lifecycle = { createPdfProfileDirectory, closePdfBrowserResources, chromiumPdfLaunchOptions };', context)
    const lifecycle = context.module.exports.lifecycle
    for (const executable of ['/snap/bin/chromium', '/usr/bin/chromium-browser']) {
      const profile = lifecycle.createPdfProfileDirectory(executable)
      assert.ok(profile.startsWith(path.join(fixture, 'snap', 'chromium', 'common', 'atec-pdf')))
      fs.writeFileSync(path.join(profile, 'cache'), 'temporary browser data')
      assert.equal(lifecycle.chromiumPdfLaunchOptions(executable, profile).env.TMPDIR, profile)
      // Cleanup must still remove profiles if browser/page closing fails.
      const failedClose = { close: async () => { throw new Error('already closed') } }
      await lifecycle.closePdfBrowserResources(failedClose, failedClose, profile)
      assert.equal(fs.existsSync(profile), false)
    }
    console.log('Snap PDF profile placement and failure cleanup passed')
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
