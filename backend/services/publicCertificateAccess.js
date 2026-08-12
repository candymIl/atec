const crypto = require("crypto")

function publicCertificateSecret(env = process.env) {
  const secret = String(env.PUBLIC_CERTIFICATE_SECRET || env.JWT_SECRET || "")

  if (secret.length < 32) {
    throw new Error("PUBLIC_CERTIFICATE_SECRET or JWT_SECRET must be at least 32 characters long")
  }

  return secret
}

function createPublicCertificateToken(testid, env = process.env) {
  return crypto
    .createHmac("sha256", publicCertificateSecret(env))
    .update(`atec-public-certificate:${String(testid)}`)
    .digest("base64url")
}

function createPublicAssetToken(assetid, env = process.env) {
  return crypto
    .createHmac("sha256", publicCertificateSecret(env))
    .update(`atec-public-asset-certificates:${String(assetid)}`)
    .digest("base64url")
}

function isValidPublicCertificateToken(testid, token, env = process.env) {
  const supplied = Buffer.from(String(token || ""))
  const expected = Buffer.from(createPublicCertificateToken(testid, env))

  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
}

function isValidPublicAssetToken(assetid, token, env = process.env) {
  const supplied = Buffer.from(String(token || ""))
  const expected = Buffer.from(createPublicAssetToken(assetid, env))

  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
}

function publicCertificateUrl(appUrl, testid, env = process.env) {
  const baseUrl = String(appUrl || "").replace(/\/$/, "")
  const token = createPublicCertificateToken(testid, env)
  return `${baseUrl}/api/public/certificates/${encodeURIComponent(testid)}.pdf?token=${encodeURIComponent(token)}`
}

function publicAssetCertificatesUrl(appUrl, assetid, env = process.env) {
  const baseUrl = String(appUrl || "").replace(/\/$/, "")
  const token = createPublicAssetToken(assetid, env)
  return `${baseUrl}/api/public/assets/${encodeURIComponent(assetid)}/certificates?token=${encodeURIComponent(token)}`
}

module.exports = {
  createPublicAssetToken,
  createPublicCertificateToken,
  isValidPublicAssetToken,
  isValidPublicCertificateToken,
  publicAssetCertificatesUrl,
  publicCertificateUrl
}
