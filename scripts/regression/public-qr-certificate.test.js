const assert = require("assert")
const fs = require("fs")
const path = require("path")
const {
  createPublicAssetToken,
  createPublicCertificateToken,
  isValidPublicAssetToken,
  isValidPublicCertificateToken,
  publicAssetCertificatesUrl,
  publicCertificateUrl
} = require("../../backend/services/publicCertificateAccess")

const env = { PUBLIC_CERTIFICATE_SECRET: "test-secret-that-is-definitely-longer-than-32-characters" }
const token = createPublicCertificateToken(123, env)

assert.strictEqual(isValidPublicCertificateToken(123, token, env), true)
assert.strictEqual(isValidPublicCertificateToken(124, token, env), false)
assert.match(publicCertificateUrl("https://example.test/atec/", 123, env), /^https:\/\/example\.test\/atec\/api\/public\/certificates\/123\.pdf\?token=/)
const assetToken = createPublicAssetToken(32793, env)
assert.strictEqual(isValidPublicAssetToken(32793, assetToken, env), true)
assert.strictEqual(isValidPublicAssetToken(32794, assetToken, env), false)
assert.match(publicAssetCertificatesUrl("https://example.test/", 32793, env), /^https:\/\/example\.test\/api\/public\/assets\/32793\/certificates\?token=/)

const server = fs.readFileSync(path.join(__dirname, "../../backend/server.js"), "utf8")
const frontend = fs.readFileSync(path.join(__dirname, "../../frontend/src/main.js"), "utf8")
const publicRoute = server.indexOf('app.get("/public/certificates/:testid.pdf"')
const authGate = server.indexOf("app.use(requireAuth)")
const protectedCertificateRoute = server.indexOf('app.get("/inspections/:testid/certificate.pdf"')

assert(publicRoute >= 0 && publicRoute < authGate, "Signed public certificate route must be registered before authentication")
assert(protectedCertificateRoute > authGate, "Existing staff certificate route must remain authenticated")
assert(server.includes('app.get("/public/assets/:assetid/certificates"'), "Public asset certificate selection page must exist")
assert(server.includes("publicAssetCertificatesUrl(appUrl, asset.assetid)"), "QR must open the asset certificate selection page")
assert(frontend.includes("publicAssetCertificatesMatch[1]"), "ATEC scanner must extract the asset ID from public certificate QR URLs")
assert(server.includes("const labelWidth = mm(95)"), "QR label width must be 95 mm")
assert(server.includes("const labelHeight = mm(60)"), "QR label height must be 60 mm")
assert(server.includes('size: [labelWidth, labelHeight]'), "QR label PDF page must use the physical label dimensions")
assert(server.includes('process.env.PUBLIC_APP_URL || "https://www.atecinspections.co.za"'), "QR label fallback URL must use the ATEC production domain")
assert(server.includes("www.atecinspections.co.za | 011 902 3271"), "QR label footer must show the ATEC production domain")
assert(server.includes("certificateIsEligible(certificate)"), "Public route must reject ineligible certificates")

console.log("Public QR certificate regression checks passed")
