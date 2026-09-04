const QRCode = require("qrcode")

const HPGL_UNITS_PER_MM = 40

function createQrHpgl(payload, options = {}) {
  const sizeMm = Number(options.sizeMm || 32)
  const quietZoneModules = Number(options.quietZoneModules ?? 4)

  if (!Number.isFinite(sizeMm) || sizeMm <= 0) throw new Error("QR PLT size must be positive")
  if (!Number.isInteger(quietZoneModules) || quietZoneModules < 4) {
    throw new Error("QR PLT quiet zone must be at least four modules")
  }

  const qr = QRCode.create(String(payload || ""), {
    errorCorrectionLevel: options.errorCorrectionLevel || "M"
  })
  const canvasUnits = Math.round(sizeMm * HPGL_UNITS_PER_MM)
  const totalModules = qr.modules.size + (quietZoneModules * 2)
  const moduleUnits = Math.floor(canvasUnits / totalModules)
  if (moduleUnits < 1) throw new Error("QR PLT size is too small for this payload")

  const usedUnits = moduleUnits * totalModules
  const origin = Math.floor((canvasUnits - usedUnits) / 2)
  const commands = [
    "IN",
    "DF",
    "SP1",
    `IP0,0,${canvasUnits},${canvasUnits}`,
    `PU;PA0,0;PA${canvasUnits},${canvasUnits}`
  ]

  for (let row = 0; row < qr.modules.size; row += 1) {
    let column = 0
    while (column < qr.modules.size) {
      if (!qr.modules.get(row, column)) {
        column += 1
        continue
      }

      const runStart = column
      while (column + 1 < qr.modules.size && qr.modules.get(row, column + 1)) column += 1
      const runEnd = column + 1
      const x1 = origin + ((quietZoneModules + runStart) * moduleUnits)
      const x2 = origin + ((quietZoneModules + runEnd) * moduleUnits)
      const y2 = origin + ((quietZoneModules + qr.modules.size - row) * moduleUnits)
      const y1 = y2 - moduleUnits

      commands.push(`PU;PA${x1},${y1};PM0;PD;PA${x2},${y1},${x2},${y2},${x1},${y2},${x1},${y1};PM2;FP`)
      column += 1
    }
  }

  commands.push("PU", "SP0", "IN")
  return `${commands.join("; ")};\n`
}

module.exports = {
  HPGL_UNITS_PER_MM,
  createQrHpgl
}
