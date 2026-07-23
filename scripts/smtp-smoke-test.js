const path = require("path")

const root = path.resolve(__dirname, "..")
const backendRoot = path.join(root, "backend")
const dotenv = require(path.join(backendRoot, "node_modules", "dotenv"))
const nodemailer = require(path.join(backendRoot, "node_modules", "nodemailer"))

dotenv.config({ path: path.join(backendRoot, ".env"), quiet: true })

const sendSelf = process.argv.includes("--send-self")
const provider = String(process.env.MAIL_PROVIDER || "smtp").trim().toLowerCase()

function required(name) {
  const value = String(process.env[name] || "").trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function verifyGraph() {
  const tenantId = required("GRAPH_TENANT_ID")
  const clientId = required("GRAPH_CLIENT_ID")
  const clientSecret = required("GRAPH_CLIENT_SECRET")
  const sender = required("GRAPH_SENDER")

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials"
      })
    }
  )
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.access_token) {
    const error = new Error(payload.error_description || payload.error || `Graph token request failed with HTTP ${response.status}`)
    error.code = "GRAPH_AUTH"
    error.responseCode = response.status
    throw error
  }

  console.log(JSON.stringify({
    success: true,
    provider: "graph",
    action: "verify",
    authenticated: true,
    expiresInSeconds: Number(payload.expires_in || 0)
  }, null, 2))

  if (!sendSelf) return

  const now = new Date()
  const sendResponse = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${payload.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          subject: `ATEC Graph self-test ${now.toISOString()}`,
          body: {
            contentType: "Text",
            content: [
              "ATEC Microsoft Graph integration test succeeded.",
              "",
              `Generated: ${now.toISOString()}`,
              "This message was sent to the configured Graph sender itself.",
              "No customer or business record was used."
            ].join("\n")
          },
          toRecipients: [{ emailAddress: { address: sender } }]
        },
        saveToSentItems: true
      })
    }
  )

  if (!sendResponse.ok) {
    const payload = await sendResponse.json().catch(() => ({}))
    const error = new Error(payload.error?.message || `Graph send failed with HTTP ${sendResponse.status}`)
    error.code = "GRAPH_SEND"
    error.responseCode = sendResponse.status
    throw error
  }

  console.log(JSON.stringify({
    success: true,
    provider: "graph",
    action: "send-self",
    accepted: true,
    responseCode: sendResponse.status
  }, null, 2))
}

async function verifySmtp() {
  const host = required("SMTP_HOST")
  const port = Number(required("SMTP_PORT"))
  const user = required("SMTP_USER")
  const pass = required("SMTP_PASS")
  const from = required("MAIL_FROM")
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true"

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
  })

  await transporter.verify()
  console.log(JSON.stringify({
    success: true,
    provider: "smtp",
    action: "verify",
    host,
    port,
    secure,
    authenticated: true
  }, null, 2))

  if (!sendSelf) return

  const now = new Date()
  const info = await transporter.sendMail({
    from,
    to: user,
    subject: `ATEC SMTP self-test ${now.toISOString()}`,
    text: [
      "ATEC SMTP integration test succeeded.",
      "",
      `Generated: ${now.toISOString()}`,
      `Host: ${host}`,
      "This message was sent to the configured SMTP account itself.",
      "No customer or business record was used."
    ].join("\n")
  })

  console.log(JSON.stringify({
    success: true,
    provider: "smtp",
    action: "send-self",
    acceptedCount: Array.isArray(info.accepted) ? info.accepted.length : 0,
    rejectedCount: Array.isArray(info.rejected) ? info.rejected.length : 0,
    messageId: info.messageId || null
  }, null, 2))
}

async function main() {
  if (provider === "graph") {
    return verifyGraph()
  }
  if (provider !== "smtp") {
    throw new Error(`Unsupported MAIL_PROVIDER: ${provider}`)
  }
  return verifySmtp()
}

main().catch(error => {
  console.error(JSON.stringify({
    success: false,
    provider,
    action: sendSelf ? "send-self" : "verify",
    code: error.code || null,
    responseCode: error.responseCode || null,
    error: error.message || String(error)
  }, null, 2))
  process.exitCode = 1
})
