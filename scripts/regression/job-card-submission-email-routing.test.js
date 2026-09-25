const assert = require("assert/strict")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

const server = fs.readFileSync(path.join(__dirname, "../../backend/server.js"), "utf8")
const start = server.indexOf("async function emailSubmittedJobCardToManager(card)")
const end = server.indexOf("async function saveJobCard(req, res)", start)
assert.ok(start >= 0 && end > start)
const messages = []
const pdf = Buffer.from("sample signed PDF")
const context = vm.createContext({
  process: { env: { MAIL_FROM: "certificates@example.invalid" } },
  JOB_CARD_CC: "jacques@fbcranes.co.za",
  isValidEmailAddress: value => Boolean(value && value.includes("@")),
  getMailConfigIssues: () => [],
  createJobCardPdfBuffer: async () => pdf,
  jobCardApplicationUrl: () => "https://example.invalid/atec/",
  sendApplicationEmail: async message => messages.push(message)
})
vm.runInContext(server.slice(start, end), context)

async function main() {
  const card = {
    jobcard_reference: "JC-TEST-001", customer_reference: "11996",
    managers: [{ manager_email: "manager@example.invalid", manager_name: "Manager" }],
    assigned_to_name: "Technician", clientname: "Customer", sitename: "Site"
  }
  await context.emailSubmittedJobCardToManager(card)
  await context.emailSubmittedJobCardToAccelo(card)
  assert.equal(messages.length, 2, "Managers and Accelo must still receive their deliveries")
  assert.equal(messages[0].to[0], "manager@example.invalid")
  assert.equal(messages[0].cc, "jacques@fbcranes.co.za")
  assert.equal(messages[1].to, "job+11996@fb-cranes.accelo.com")
  assert.equal(messages[1].cc, undefined, "Accelo submission must not copy Jacques a second time")
  assert.equal(messages[1].bcc, undefined)
  for (const message of messages) {
    assert.equal(message.attachments[0].content, pdf)
    assert.equal(message.attachments[0].filename, "JC-TEST-001.pdf")
  }
  console.log("Job-card submission email routing passed (no emails sent)")
}
main().catch(error => { console.error(error); process.exitCode = 1 })
