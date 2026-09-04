const assert = require("assert")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..", "..")
const frontendSource = fs.readFileSync(path.join(root, "frontend", "src", "main.js"), "utf8")

assert(frontendSource.includes("await loadMyProfileSignaturePreview(currentUser.signature_image)"))
assert(frontendSource.includes("fetch(uploadUrl(signaturePath), { cache: 'no-store' })"))
assert(frontendSource.includes("URL.createObjectURL(await response.blob())"))
assert(frontendSource.includes("The saved signature file could not be found"))

console.log("Profile signature preview regression checks passed.")
