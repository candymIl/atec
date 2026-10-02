const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const http = require('node:http')
const express = require('../../backend/node_modules/express')
const { rateLimit } = require('../../backend/node_modules/express-rate-limit')
const { resolveProxyTrust } = require('../../backend/services/proxyTrust')

async function main() {
  assert.equal(resolveProxyTrust('1'), 1)
  assert.equal(resolveProxyTrust('true'), 1)
  assert.equal(resolveProxyTrust('false'), false)
  assert.equal(resolveProxyTrust('loopback'), 'loopback')
  const source = fs.readFileSync(require.resolve('../../backend/server'), 'utf8')
  const declaration = source.match(/const loginLimiter = rateLimit\(\{[\s\S]*?\n\}\)/)[0]
  const context = { rateLimit, parseRateLimitEnv: (_, fallback) => fallback, rateLimitMessage: () => ({ error: 'limited' }) }
  vm.runInNewContext(declaration + '\nthis.limiter = loginLimiter', context)
  const app = express()
  app.set('trust proxy', resolveProxyTrust('1'))
  app.post('/login', context.limiter, (req, res) => res.status(req.headers['x-fail'] ? 401 : 200).json({ ip: req.ip }))
  const server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/login`
  async function request(ip, fail = false) {
    const response = await fetch(url, { method: 'POST', headers: { 'x-forwarded-for': ip, ...(fail ? { 'x-fail': '1' } : {}) } })
    const body = await response.json()
    return { status: response.status, body }
  }
  try {
    for (let i = 0; i < 12; i++) assert.equal((await request('192.0.2.10')).status, 200)
    for (let i = 0; i < 10; i++) assert.equal((await request('192.0.2.10', true)).status, 401)
    assert.equal((await request('192.0.2.10', true)).status, 429)
    const other = await request('198.51.100.20')
    assert.equal(other.status, 200)
    assert.equal(other.body.ip, '198.51.100.20')
    console.log('Successful logins do not exhaust limits; failed limits and proxy client separation passed')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
