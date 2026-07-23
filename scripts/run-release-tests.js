const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..")
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const testScripts = Object.keys(packageJson.scripts)
  .filter(name => name.startsWith("test:") && name !== "test:all")

function run(command, args, label) {
  console.log(`\n=== ${label} ===`)
  const useWindowsCommandHost = process.platform === "win32" && command === npmCommand
  const executable = useWindowsCommandHost ? (process.env.ComSpec || "cmd.exe") : command
  const executableArgs = useWindowsCommandHost
    ? ["/d", "/s", "/c", command, ...args]
    : args
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    stdio: "inherit",
    shell: false
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

for (const script of testScripts) {
  run(npmCommand, ["run", script], script)
}

run(process.execPath, ["--check", "backend/server.js"], "backend syntax")
run(npmCommand, ["run", "build", "--prefix", "frontend"], "frontend build")

console.log("\nAll ATEC release checks passed.")
