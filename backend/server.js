const fs = require("fs")
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const bcrypt = require("bcryptjs")
const pool = require("./db");
require("dotenv").config();
const app = express();
const multer = require("multer");
const path = require("path");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const {
  asyncRoute,
  auditLogger,
  authCookieOptions,
  errorHandler,
  isSafeUpload,
  publicUser,
  requireAuth,
  sanitizeFilename,
  signAuthToken
} = require("./middleware/security")

const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:5174,http://localhost:5173")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean)

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }

    return callback(new Error("Origin not allowed by CORS"))
  },
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const logAudit = auditLogger(pool)

app.use((req, res, next) => {
  req.logAudit = (...args) => logAudit(req, ...args)
  next()
})

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const folder = file.fieldname === "signature" ? "uploads/signatures" : "uploads/assets"
    fs.mkdirSync(folder, { recursive: true })
    cb(null, folder);
  },
  filename: function (req, file, cb) {
    cb(null, sanitizeFilename(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    if (!isSafeUpload(file)) {
      return cb(new Error("Only JPG, PNG and WebP images are allowed"))
    }

    return cb(null, true)
  }
});

app.get("/", (req, res) => {
  res.send("ATEC backend is running");
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
})

function roleToUserLevel(role) {
  return {
    ADMIN: 1,
    MANAGER: 2,
    INSPECTOR: 3,
    VIEWER: 4,
    CUSTOMER: 5
  }[role] || 5
}

function validRoles() {
  return ["ADMIN", "MANAGER", "INSPECTOR", "VIEWER", "CUSTOMER"]
}

async function ensureTblUsersHaveIds() {
  await pool.query(`
    WITH numbered AS (
      SELECT
        ctid,
        ROW_NUMBER() OVER (
          ORDER BY COALESCE(NULLIF(fullname, ''), username, email, ctid::text)
        ) AS row_number
      FROM atec.tblusers
      WHERE userid IS NULL
    ),
    base AS (
      SELECT COALESCE(MAX(userid), 0) AS max_userid
      FROM atec.tblusers
    )
    UPDATE atec.tblusers users
    SET userid = base.max_userid + numbered.row_number,
        updated_at = now()
    FROM numbered, base
    WHERE users.ctid = numbered.ctid
  `)
}

app.post("/auth/login", loginLimiter, asyncRoute(async (req, res) => {
  const username = String(req.body.username || "").trim()
  const password = String(req.body.password || "")

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" })
  }

  const result = await pool.query(
    `
    SELECT
      userid AS user_id,
      username,
      email,
      password AS password_hash,
      COALESCE(NULLIF(fullname, ''), username) AS full_name,
      COALESCE(
        role,
        CASE
          WHEN userlevel = 1 THEN 'ADMIN'
          WHEN userlevel = 2 THEN 'MANAGER'
          WHEN userlevel = 3 THEN 'INSPECTOR'
          WHEN userlevel = 4 THEN 'VIEWER'
          WHEN userlevel = 5 THEN 'CUSTOMER'
          ELSE 'VIEWER'
        END
      ) AS role,
      lmi_no AS lmi_number,
      usersignature AS signature_image,
      clientid,
      siteid,
      sectionid,
      is_active
    FROM atec.tblusers
    WHERE LOWER(username) = LOWER($1)
       OR LOWER(COALESCE(email, '')) = LOWER($1)
    LIMIT 1
    `,
    [username]
  )

  const user = result.rows[0]
  const isValid = user
    ? await bcrypt.compare(password, user.password_hash)
    : false

  if (!user || !isValid || !user.is_active) {
    return res.status(401).json({ error: "Invalid username or password" })
  }

  await pool.query(
    "UPDATE atec.tblusers SET last_login_at = now() WHERE userid = $1",
    [user.user_id]
  )

  req.user = publicUser(user)
  await req.logAudit("LOGIN", "auth", user.user_id)

  res.cookie("atec_session", signAuthToken(user), authCookieOptions())
  res.json({ user: publicUser(user) })
}))

app.post("/auth/logout", requireAuth, asyncRoute(async (req, res) => {
  await req.logAudit("LOGOUT", "auth", req.user.user_id)
  res.clearCookie("atec_session", authCookieOptions())
  res.json({ success: true })
}))

app.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user })
})

function authorizeRequest(req, res, next) {
  const role = req.user?.role
  const method = req.method
  const routePath = req.path

  if (role === "ADMIN") return next()

  const isRead = method === "GET"
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method)

  if (role === "MANAGER") {
    if (
      isRead &&
      (
        routePath.startsWith("/customers") ||
        routePath.startsWith("/sites") ||
        routePath.startsWith("/sections") ||
        routePath.startsWith("/responsible-persons") ||
        routePath.startsWith("/assets") ||
        routePath.startsWith("/inspections") ||
        routePath.startsWith("/inspection-results") ||
        routePath.startsWith("/certificates") ||
        routePath.includes("/certificate") ||
        routePath.startsWith("/reports") ||
        routePath.startsWith("/dashboard") ||
        routePath.startsWith("/equipment-types")
      )
    ) {
      return next()
    }

    return res.status(403).json({ error: "Access denied" })
  }

  if (role === "VIEWER") {
    if (
      isRead &&
      (
        routePath.startsWith("/assets") ||
        routePath.startsWith("/certificates") ||
        routePath.includes("/certificate") ||
        routePath.startsWith("/dashboard") ||
        routePath === "/equipment-types"
      )
    ) {
      return next()
    }

    return res.status(403).json({ error: "Access denied" })
  }

  if (role === "CUSTOMER") {
    if (
      isRead &&
      (
        routePath.startsWith("/certificates") ||
        routePath.includes("/certificate") ||
        routePath.startsWith("/reports/customer-detailed")
      )
    ) {
      return next()
    }

    return res.status(403).json({ error: "Access denied" })
  }

  if (role === "INSPECTOR") {
    if (
      isRead &&
      (
        routePath.startsWith("/assets") ||
        routePath.startsWith("/equipment-types") ||
        routePath.startsWith("/equipment-type-criteria") ||
        routePath.startsWith("/inspections") ||
        routePath.startsWith("/inspection-results") ||
        routePath.startsWith("/certificates") ||
        routePath.includes("/certificate") ||
        routePath.startsWith("/dashboard") ||
        routePath === "/auth/me"
      )
    ) {
      return next()
    }

    if (
      method === "POST" &&
      (
        routePath === "/inspections" ||
        /^\/inspections\/[^/]+\/results$/.test(routePath)
      )
    ) {
      return next()
    }

    if (
      method === "PUT" &&
      (
        /^\/assets\/[^/]+$/.test(routePath) ||
        /^\/assets\/[^/]+\/photos$/.test(routePath)
      )
    ) {
      return next()
    }

    if (routePath.startsWith("/users/me/signature")) return next()

    return res.status(403).json({ error: "Access denied" })
  }

  return res.status(403).json({ error: "Access denied" })
}

app.use("/uploads", requireAuth, express.static("uploads"));
app.use(requireAuth)
app.use(authorizeRequest)
app.use((req, res, next) => {
  const methodAction = {
    POST: "CREATE",
    PUT: "UPDATE",
    PATCH: "UPDATE",
    DELETE: "DELETE"
  }[req.method]

  if (!methodAction) return next()

  res.on("finish", () => {
    if (res.statusCode >= 400) return

    const module = req.path.split("/").filter(Boolean)[0] || "api"
    const recordId =
      req.params.id ||
      req.params.testid ||
      req.params.assetid ||
      req.body?.assetid ||
      null

    logAudit(req, methodAction, module, recordId, {
      method: req.method,
      path: req.path
    })
  })

  next()
})

app.get("/users", asyncRoute(async (req, res) => {
  await ensureTblUsersHaveIds()

  const result = await pool.query(
    `
    SELECT
      userid AS user_id,
      username,
      email,
      COALESCE(NULLIF(fullname, ''), username) AS full_name,
      COALESCE(
        role,
        CASE
          WHEN userlevel = 1 THEN 'ADMIN'
          WHEN userlevel = 2 THEN 'MANAGER'
          WHEN userlevel = 3 THEN 'INSPECTOR'
          WHEN userlevel = 4 THEN 'VIEWER'
          WHEN userlevel = 5 THEN 'CUSTOMER'
          ELSE 'VIEWER'
        END
      ) AS role,
      lmi_no AS lmi_number,
      usersignature AS signature_image,
      clientid,
      siteid,
      sectionid,
      is_active,
      created_at,
      last_login_at
    FROM atec.tblusers
    ORDER BY COALESCE(NULLIF(fullname, ''), username), username
    `
  )

  res.json(result.rows)
}))

app.post("/users", asyncRoute(async (req, res) => {
  const {
    username,
    email,
    password,
    full_name,
    role,
    lmi_number,
    clientid,
    siteid,
    sectionid,
    is_active
  } = req.body

  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: "Username, password, full name and role are required" })
  }

  if (!validRoles().includes(role)) {
    return res.status(400).json({ error: "Invalid role" })
  }

  const passwordHash = await bcrypt.hash(String(password), 12)

  const result = await pool.query(
    `
    INSERT INTO atec.tblusers
      (userid, username, email, password, fullname, userlevel, role, lmi_no, clientid, siteid, sectionid, is_active)
    VALUES
      ((SELECT COALESCE(MAX(userid), 0) + 1 FROM atec.tblusers), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, true))
    RETURNING
      userid AS user_id,
      username,
      email,
      COALESCE(NULLIF(fullname, ''), username) AS full_name,
      role,
      lmi_no AS lmi_number,
      usersignature AS signature_image,
      clientid,
      siteid,
      sectionid,
      is_active
    `,
    [
      String(username).trim(),
      email ? String(email).trim() : null,
      passwordHash,
      String(full_name).trim(),
      roleToUserLevel(role),
      role,
      lmi_number ? String(lmi_number).trim() : null,
      clientid || null,
      siteid || null,
      sectionid || null,
      is_active
    ]
  )

  await req.logAudit("CREATE", "users", result.rows[0].user_id)
  res.status(201).json(result.rows[0])
}))

app.put("/users/:id", asyncRoute(async (req, res) => {
  const {
    email,
    password,
    full_name,
    role,
    lmi_number,
    clientid,
    siteid,
    sectionid,
    is_active
  } = req.body

  if (!full_name || !role) {
    return res.status(400).json({ error: "Full name and role are required" })
  }

  if (!validRoles().includes(role)) {
    return res.status(400).json({ error: "Invalid role" })
  }

  const params = [
    email ? String(email).trim() : null,
    String(full_name).trim(),
    roleToUserLevel(role),
    role,
    lmi_number ? String(lmi_number).trim() : null,
    clientid || null,
    siteid || null,
    sectionid || null,
    is_active === false ? false : true,
    req.params.id
  ]

  let passwordSql = ""
  if (password) {
    params.push(await bcrypt.hash(String(password), 12))
    passwordSql = `, password = $${params.length}`
  }

  const result = await pool.query(
    `
    UPDATE atec.tblusers
    SET
      email = $1,
      fullname = $2,
      userlevel = $3,
      role = $4,
      lmi_no = $5,
      clientid = $6,
      siteid = $7,
      sectionid = $8,
      is_active = $9,
      updated_at = now()
      ${passwordSql}
    WHERE userid = $10
    RETURNING
      userid AS user_id,
      username,
      email,
      COALESCE(NULLIF(fullname, ''), username) AS full_name,
      role,
      lmi_no AS lmi_number,
      usersignature AS signature_image,
      clientid,
      siteid,
      sectionid,
      is_active
    `,
    params
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "User not found" })
  }

  await req.logAudit("UPDATE", "users", req.params.id)
  res.json(result.rows[0])
}))

app.delete("/users/:id", asyncRoute(async (req, res) => {
  if (String(req.params.id) === String(req.user.user_id)) {
    return res.status(400).json({ error: "You cannot delete your own logged-in user" })
  }

  const result = await pool.query(
    `
    UPDATE atec.tblusers
    SET is_active = false,
        updated_at = now()
    WHERE userid = $1
    RETURNING
      userid AS user_id,
      username,
      email,
      COALESCE(NULLIF(fullname, ''), username) AS full_name,
      role,
      lmi_no AS lmi_number,
      usersignature AS signature_image,
      clientid,
      siteid,
      sectionid,
      is_active
    `,
    [req.params.id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "User not found" })
  }

  await req.logAudit("DELETE", "users", req.params.id)
  res.json({ success: true, user: result.rows[0] })
}))

app.post("/users/me/signature",
  upload.single("signature"),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Signature image is required" })
    }

    const signatureImage = `/uploads/signatures/${req.file.filename}`
    const result = await pool.query(
      `
      UPDATE atec.tblusers
      SET usersignature = $1, updated_at = now()
      WHERE userid = $2
      RETURNING
        userid AS user_id,
        username,
        email,
        COALESCE(NULLIF(fullname, ''), username) AS full_name,
        role,
        lmi_no AS lmi_number,
        usersignature AS signature_image,
        clientid,
        siteid,
        sectionid,
        is_active
      `,
      [signatureImage, req.user.user_id]
    )

    await req.logAudit("SIGNATURE_CHANGE", "users", req.user.user_id)
    res.json({ user: result.rows[0] })
  })
)

app.post("/users/:id/signature",
  upload.single("signature"),
  asyncRoute(async (req, res) => {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ error: "Only admins can change user signatures" })
    }

    if (!req.file) {
      return res.status(400).json({ error: "Signature image is required" })
    }

    const signatureImage = `/uploads/signatures/${req.file.filename}`
    const result = await pool.query(
      `
      UPDATE atec.tblusers
      SET usersignature = $1, updated_at = now()
      WHERE userid = $2
      RETURNING
        userid AS user_id,
        username,
        email,
        COALESCE(NULLIF(fullname, ''), username) AS full_name,
        role,
        lmi_no AS lmi_number,
        usersignature AS signature_image,
        clientid,
        siteid,
        sectionid,
        is_active
      `,
      [signatureImage, req.params.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" })
    }

    await req.logAudit("SIGNATURE_CHANGE", "users", req.params.id)
    res.json({ user: result.rows[0] })
  })
)

app.post("/users/:id/reset-password", asyncRoute(async (req, res) => {
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Only admins can reset passwords" })
  }

  const password = String(req.body.password || "")
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" })
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const result = await pool.query(
    `
    UPDATE atec.tblusers
    SET password = $1,
        updated_at = now()
    WHERE userid = $2
    RETURNING userid AS user_id
    `,
    [passwordHash, req.params.id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "User not found" })
  }

  await req.logAudit("PASSWORD_RESET", "users", req.params.id)
  res.json({ success: true })
}))

app.get("/customers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM atec.tblclients
      ORDER BY clientname
    `)

    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.post("/customers", async (req, res) => {
  try {
    const { clientname, clientaddr } = req.body;

    const result = await pool.query(
      `INSERT INTO atec.tblclients (clientname, clientaddr)
       VALUES ($1, $2)
       RETURNING *`,
      [clientname, clientaddr || null]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/customers/:id/archive", async (req, res) => {
  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    const { id } = req.params

    await client.query(
      `UPDATE atec.tblclients SET archived = true WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblsites SET archived = true WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblsection SET archived = true WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblpeople SET archived = true WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblasset SET archived = true WHERE clientid = $1`,
      [id]
    )

    await client.query("COMMIT")

    res.json({ success: true })
  } catch (err) {
    await client.query("ROLLBACK")
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  } finally {
    client.release()
  }
})

app.put("/customers/:id/unarchive", async (req, res) => {
  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    const { id } = req.params

    await client.query(
      `UPDATE atec.tblclients SET archived = false WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblsites SET archived = false WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblsection SET archived = false WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblpeople SET archived = false WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblasset SET archived = false WHERE clientid = $1`,
      [id]
    )

    await client.query("COMMIT")

    res.json({ success: true })
  } catch (err) {
    await client.query("ROLLBACK")
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  } finally {
    client.release()
  }
})

app.put("/customers/:id", async (req, res) => {

  try {

    const { id } = req.params

    const {
      clientname,
      clientaddr
    } = req.body

    const result = await pool.query(
      `
      UPDATE atec.tblclients
      SET
        clientname = $1,
        clientaddr = $2
      WHERE clientid = $3
      RETURNING *
      `,
      [
        clientname,
        clientaddr,
        id
      ]
    )

    res.json(result.rows[0])

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }

})

app.get("/sites", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        s.siteid,
        s.clientid,
        s.sitename,
        c.clientname
      FROM atec.tblsites s
      LEFT JOIN atec.tblclients c
        ON s.clientid = c.clientid
      ORDER BY c.clientname, s.sitename
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.post("/sites", async (req, res) => {
  try {
    const { clientid, sitename } = req.body;

    const result = await pool.query(
      `INSERT INTO atec.tblsites (clientid, sitename)
       VALUES ($1, $2)
       RETURNING *`,
      [clientid, sitename]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/sites/:id", async (req, res) => {
  try {

    const { id } = req.params
    const { sitename } = req.body

    const result = await pool.query(
      `
      UPDATE atec.tblsites
      SET sitename = $1
      WHERE siteid = $2
      RETURNING *
      `,
      [
        sitename,
        id
      ]
    )

    res.json(result.rows[0])

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }
})

app.get("/assets", async (req, res) => {
  try {
    const result = await pool.query(`
SELECT 
        a.assetid,
        a.clientid,
        a.siteid,
        a.equiptypeid,
        a.serialno,
        a.assettagno,
        a.manufacturer,
        a.description,
        a.media1,
        a.media2,
        a.qrcode,
        a.manufactdate,
        a.wll,
        a.heightoflift,
        a.numberofchainfalls,
        a.oemtophooksize,
        a.oembottomhooksize,
        a.loadchaindiameter,
        a.effectivelength,
        a.span,
        a.permissibledeflection,
        a.hooksize,
        a.steelwireropemm,
        a.hoistdescription,
        a.hoistserialno,
        c.clientname,
        s.sitename,
        sec.sectionname,
        et.description AS equipmenttype,
        et.equipgroupid
      FROM atec.tblasset a
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
      LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
      WHERE COALESCE(a.archived, false) = false
      ORDER BY a.assetid DESC
      LIMIT 500
    `)

    res.json(result.rows)

  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/assets/:id/quick-details", async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(`
      SELECT 
        a.assetid,
        a.equiptypeid,
        a.serialno,
        a.assettagno,
        a.manufacturer,
        a.description,
        a.media1,
        a.media2,
        a.qrcode,
        a.manufactdate,

        (
          SELECT i.testdate
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'VISUAL'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastvisualdate,

        (
          SELECT i.status
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'VISUAL'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastvisualstatus,

        (
          SELECT i.tagnumber
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'VISUAL'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastvisualtag,

        (
          SELECT i.testdate
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'LOADTEST'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastloadtestdate,

        (
          SELECT i.status
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'LOADTEST'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastloadteststatus,

        (
          SELECT i.tagnumber
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'LOADTEST'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastloadtesttag,

        (
          SELECT i.testdate
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastinspectiondate,

        (
          SELECT i.status
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastinspectionstatus,

        (
          SELECT i.inspectiontype
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastinspectiontype,

        (
          SELECT i.tagnumber
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastinspectiontag,

        (
          SELECT i.inspector
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastinspector,

        c.clientname,
        s.sitename,
        sec.sectionname,
        et.description AS equipmenttype

      FROM atec.tblasset a
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
      LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
      WHERE a.assetid = $1
      LIMIT 1
    `, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Asset not found" })
    }

    res.json(result.rows[0])

  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/assets/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        a.*,
        c.clientname,
        s.sitename,
        sec.sectionname,
        et.description AS equipmenttype
      FROM atec.tblasset a
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
      LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
      WHERE a.assetid = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Asset not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});


app.post("/assets", async (req, res) => {
  try {
    const {
      serialno,
      clientid,
      siteid,
      sectionid,
      responsibleid,
      equiptypeid,
      manufacturer,
      description,
      assettagno,
      manufactdate,
      wll,
      heightoflift,
      numberofchainfalls,
      oemtophooksize,
      oembottomhooksize,
      loadchaindiameter,
      effectivelength,
      span,
      permissibledeflection,
      hooksize,
      steelwireropemm,
      hoistdescription,
      hoistserialno
    } = req.body;

    const duplicateCheck = await pool.query(
        `
        SELECT assetid, serialno, assettagno
        FROM atec.tblasset
        WHERE clientid = $1
          AND COALESCE(archived, false) = false
          AND (
            LOWER(serialno) = LOWER($2)
            OR LOWER(assettagno) = LOWER($3)
          )
        LIMIT 1
        `,
        [
          clientid,
          serialno || '',
          assettagno || ''
        ]
      )

      if (duplicateCheck.rows.length > 0) {
        return res.status(400).json({
          error: "Duplicate asset found for this client. Serial No or Asset Tag No already exists."
        })
      }

    const result = await pool.query(
      `INSERT INTO atec.tblasset
       (
        serialno,
        clientid,
        siteid,
        sectionid,
        responsibleid,
        equiptypeid,
        manufacturer,
        description,
        assettagno,
        manufactdate,
        wll,
        heightoflift,
        numberofchainfalls,
        oemtophooksize,
        oembottomhooksize,
        loadchaindiameter,
        effectivelength,
        span,
        permissibledeflection,
        hooksize,
        steelwireropemm,
        hoistdescription,
        hoistserialno
       )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      RETURNING *`,
        [
        serialno,
        clientid,
        siteid,
        sectionid,
        responsibleid,
        equiptypeid,
        manufacturer,
        description,
        assettagno,
        manufactdate || null,
        wll,
        heightoflift,
        numberofchainfalls,
        oemtophooksize,
        oembottomhooksize,
        loadchaindiameter,
        effectivelength,
        span,
        permissibledeflection,
        hooksize,
        steelwireropemm,
        hoistdescription,
        hoistserialno
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/assets/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      serialno,
      assettagno,
      manufacturer,
      description,
      wll,
      heightoflift,
      numberofchainfalls,
      oemtophooksize,
      oembottomhooksize,
      loadchaindiameter,
      effectivelength,
      span,
      permissibledeflection,
      hooksize,
      steelwireropemm,
      hoistdescription,
      hoistserialno
    } = req.body;

    const duplicateCheck = await pool.query(
      `
      SELECT assetid
      FROM atec.tblasset
      WHERE clientid = (
        SELECT clientid
        FROM atec.tblasset
        WHERE assetid = $1
      )
        AND assetid <> $1
        AND COALESCE(archived, false) = false
        AND (
          LOWER(serialno) = LOWER($2)
          OR LOWER(assettagno) = LOWER($3)
        )
      LIMIT 1
      `,
      [
        id,
        serialno || '',
        assettagno || ''
      ]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        error: "Duplicate asset found for this client. Serial No or Asset Tag No already exists."
      });
    }

    const result = await pool.query(
      `UPDATE atec.tblasset
       SET
        serialno = $1,
        manufacturer = $2,
        description = $3,
        wll = $4,
        heightoflift = $5,
        numberofchainfalls = $6,
        oemtophooksize = $7,
        oembottomhooksize = $8,
        loadchaindiameter = $9,
        effectivelength = $10,
        span = $11,
        permissibledeflection = $12,
        hooksize = $13,
        steelwireropemm = $14,
        hoistdescription = $15,
        hoistserialno = $16,
        assettagno = $17
       WHERE assetid = $18
       RETURNING *`,
      [
        serialno,
        manufacturer,
        description,
        wll,
        heightoflift,
        numberofchainfalls,
        oemtophooksize,
        oembottomhooksize,
        loadchaindiameter,
        effectivelength,
        span,
        permissibledeflection,
        hooksize,
        steelwireropemm,
        hoistdescription,
        hoistserialno,
        assettagno,
        id
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/assets/:id/archive", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE atec.tblasset
       SET archived = true
       WHERE assetid = $1
       RETURNING *`,
      [id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/assets/:id/unarchive", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE atec.tblasset
       SET archived = false
       WHERE assetid = $1
       RETURNING *`,
      [id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.post("/assets/:id/photos",
  upload.fields([
    { name: "photo1", maxCount: 1 },
    { name: "photo2", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const photo1 = req.files.photo1
        ? `/uploads/assets/${req.files.photo1[0].filename}`
        : null;

      const photo2 = req.files.photo2
        ? `/uploads/assets/${req.files.photo2[0].filename}`
        : null;

      const result = await pool.query(
        `UPDATE atec.tblasset
         SET
          media1 = COALESCE($1, media1),
          media2 = COALESCE($2, media2)
         WHERE assetid = $3
         RETURNING *`,
        [photo1, photo2, id]
      );

      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "An unexpected server error occurred" });
    }
  }
);

app.get("/assets/:id/inspection-history", async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `
      SELECT
        testid,
        testdate,
        inspectiontype,
        tagnumber,
        status,
        inspector
      FROM atec.tblinspection
      WHERE assetid = $1
      ORDER BY testdate DESC, testid DESC
      `,
      [id]
    )

    res.json(result.rows)

  } catch (err) {
    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/equipment-types", async (req, res) => {
  try {
    const result = await pool.query(`
     SELECT
      equiptypeid,
      description,
      equipgroupid
      FROM atec.tblequiptype
      ORDER BY description
    `)

    res.json(result.rows)

  } catch (err) {
    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

const PORT = process.env.PORT || 5000;

app.get("/equipment-type-criteria", async (req, res) => {
  try {
    const { category } = req.query

    let query = `
      SELECT
        c.criteriaid,
        c.equiptypeid,
        c.criterianame,
        c.fieldtype,
        c.required,
        c.sortorder,
        c.inspectioncategory,
        t.description AS equipmenttype
      FROM atec.tblequiptypecriteria c
      LEFT JOIN atec.tblequiptype t
        ON c.equiptypeid = t.equiptypeid
    `

    const values = []

    if (category) {
      query += `
        WHERE c.inspectioncategory = $1
      `
      values.push(category)
    }

    query += `
      ORDER BY
        t.description,
        c.inspectioncategory,
        c.sortorder
    `

    const result = await pool.query(query, values)

    res.json(result.rows)

  } catch (err) {
    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.post("/equipment-type-criteria", async (req, res) => {

  try {

    const {
      equiptypeid,
      criterianame,
      fieldtype,
      required,
      sortorder,
      inspectioncategory
    } = req.body

    const result = await pool.query(
      `
      INSERT INTO atec.tblequiptypecriteria
      (
        equiptypeid,
        criterianame,
        fieldtype,
        required,
        sortorder,
        inspectioncategory
      )
      VALUES
      ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [
        equiptypeid,
        criterianame,
        fieldtype,
        required,
        sortorder,
        inspectioncategory
      ]
    )

    res.json(result.rows[0])

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }

})

app.put("/equipment-type-criteria/:id", async (req, res) => {
  try {
    const { id } = req.params

    const {
      equiptypeid,
      criterianame,
      fieldtype,
      required,
      sortorder,
      inspectioncategory
    } = req.body

    const result = await pool.query(
      `
      UPDATE atec.tblequiptypecriteria
      SET
        equiptypeid = $1,
        criterianame = $2,
        fieldtype = $3,
        required = $4,
        sortorder = $5,
        inspectioncategory = $6
      WHERE criteriaid = $7
      RETURNING *
      `,
      [
        equiptypeid,
        criterianame,
        fieldtype,
        required,
        sortorder,
        inspectioncategory,
        id
      ]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Criteria not found" })
    }

    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.delete("/equipment-type-criteria/:id", async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `
      DELETE FROM atec.tblequiptypecriteria
      WHERE criteriaid = $1
      RETURNING *
      `,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Criteria not found" })
    }

    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/responsible-persons", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.personid,
        p.clientid,
        p.name,
        c.clientname
      FROM atec.tblpeople p
      LEFT JOIN atec.tblclients c
        ON p.clientid = c.clientid
      ORDER BY c.clientname, p.name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.post("/responsible-persons", async (req, res) => {
  try {
    const { clientid, name } = req.body;

    const result = await pool.query(
      `
      INSERT INTO atec.tblpeople
      (
        clientid,
        name
      )
      VALUES
      ($1,$2)
      RETURNING *
      `,
      [clientid, name]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "An unexpected server error occurred"
    });
  }
});

app.put("/responsible-persons/:id", async (req, res) => {
  try {

    const { id } = req.params;
    const { clientid, name } = req.body;

    const result = await pool.query(
      `
      UPDATE atec.tblpeople
      SET
        clientid = $1,
        name = $2
      WHERE personid = $3
      RETURNING *
      `,
      [
        clientid,
        name,
        id
      ]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "An unexpected server error occurred"
    });
  }
});

app.get("/sections", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        sec.sectionid,
        sec.clientid,
        sec.siteid,
        sec.responsibleid,
        sec.sectionname,
        c.clientname,
        s.sitename,
        p.name AS responsiblename
      FROM atec.tblsection sec
      LEFT JOIN atec.tblclients c
        ON sec.clientid = c.clientid
      LEFT JOIN atec.tblsites s
        ON sec.siteid = s.siteid
      LEFT JOIN atec.tblpeople p
        ON sec.responsibleid = p.personid
        WHERE COALESCE(sec.archived, false) = false
        ORDER BY c.clientname, s.sitename, sec.sectionname
    `);

    res.json(result.rows);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "An unexpected server error occurred"
    });
  }
});

app.post("/sections", async (req, res) => {
  try {
    const { clientid, siteid, responsibleid, sectionname } = req.body;

    const result = await pool.query(
      `INSERT INTO atec.tblsection
       (clientid, siteid, responsibleid, sectionname)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [clientid, siteid, responsibleid, sectionname]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/sections/:id", async (req, res) => {
  try {

    const { id } = req.params

    const {
      responsibleid,
      sectionname
    } = req.body

    const result = await pool.query(
      `
      UPDATE atec.tblsection
      SET
        responsibleid = $1,
        sectionname = $2
      WHERE sectionid = $3
      RETURNING *
      `,
      [
        responsibleid,
        sectionname,
        id
      ]
    )

    res.json(result.rows[0])

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }
})

app.post("/inspections",
  upload.fields([
    { name: "photo1", maxCount: 1 },
    { name: "photo2", maxCount: 1 },
  ]),
  async (req, res) => {
    const client = await pool.connect()

    try {
      await client.query("BEGIN")

      const {
        assetid,
        testdate,
        validdate,
        comments,
        status,
        inspectiontype,
        tagnumber,
        results,
        updateassetphotos
      } = req.body

      const parsedResults = JSON.parse(results || "[]")

      const inspectorProfileResult = await client.query(
        `
        SELECT
          userid AS user_id,
          COALESCE(NULLIF(fullname, ''), username) AS full_name,
          lmi_no AS lmi_number,
          usersignature AS signature_image
        FROM atec.tblusers
        WHERE userid = $1
          AND is_active = true
        `,
        [req.user.user_id]
      )

      const inspectorProfile = inspectorProfileResult.rows[0]

      if (!inspectorProfile) {
        await client.query("ROLLBACK")
        return res.status(403).json({ error: "Inspector profile is not active" })
      }

      const photo1 = req.files?.photo1
        ? `/uploads/assets/${req.files.photo1[0].filename}`
        : null

      const photo2 = req.files?.photo2
        ? `/uploads/assets/${req.files.photo2[0].filename}`
        : null

      const updatePhotos =
        updateassetphotos === "true" || updateassetphotos === true

      const inspectionTagNumber =
        typeof tagnumber === "string" && tagnumber.trim()
          ? tagnumber.trim()
          : null

      const inspection = await client.query(
        `
        INSERT INTO atec.tblinspection
        (
          assetid,
          testdate,
          validdate,
          comments,
          status,
          inspectiontype,
          inspector,
          inspector_user_id,
          inspector_name,
          inspector_lmi_number,
          inspector_signature_image,
          tagnumber,
          photo1,
          photo2,
          updateassetphotos
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING testid
        `,
        [
          assetid,
          testdate,
          validdate || null,
          comments || "",
          status,
          inspectiontype,
          inspectorProfile.full_name || req.user.full_name || "",
          inspectorProfile.user_id,
          inspectorProfile.full_name || req.user.full_name || "",
          inspectorProfile.lmi_number || "",
          inspectorProfile.signature_image || "",
          inspectionTagNumber,
          photo1,
          photo2,
          updatePhotos
        ]
      )

      const testid = inspection.rows[0].testid

      for (const row of parsedResults) {
        await client.query(
          `
          INSERT INTO atec.tblinspectionresult
          (
            testid,
            criteriaid,
            result,
            remarks,
            assetvalue,
            measuredvalue
          )
          VALUES
          ($1,$2,$3,$4,$5,$6)
          `,
          [
            testid,
            row.criteriaid || null,
            row.result || "",
            row.remarks || "",
            row.assetvalue || null,
            row.measuredvalue || null
          ]
        )
      }

      if (updatePhotos && (photo1 || photo2)) {
        await client.query(
          `
          UPDATE atec.tblasset
          SET
            media1 = COALESCE($1, media1),
            media2 = COALESCE($2, media2)
          WHERE assetid = $3
          `,
          [photo1, photo2, assetid]
        )
      }

      await client.query("COMMIT")
      await req.logAudit("CREATE", "inspections", testid, {
        assetid,
        inspectiontype,
        inspector_user_id: inspectorProfile.user_id
      })

      res.json({
        success: true,
        testid,
        resultcount: parsedResults.length
      })

    } catch (err) {
      await client.query("ROLLBACK")
      console.error(err)
      res.status(500).json({ error: "An unexpected server error occurred" })
    } finally {
      client.release()
    }
  }
)

app.get("/inspection-results/:testid", async (req, res) => {
  try {

    const { testid } = req.params

    const result = await pool.query(
      `
      SELECT
        r.resultid,
        r.testid,
        r.criteriaid,
        r.result,
        r.remarks,
        c.criterianame
      FROM atec.tblinspectionresult r
      LEFT JOIN atec.tblequiptypecriteria c
        ON r.criteriaid = c.criteriaid
      WHERE r.testid = $1
      ORDER BY c.sortorder
      `,
      [testid]
    )

    res.json(result.rows)

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }
})

// SAVE INSPECTION RESULTS
app.post('/inspections/:testid/results', async (req, res) => {
  const { testid } = req.params
  const { results } = req.body

  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'No inspection results received' })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // remove old rows if re-saving
    await client.query(
      `
      DELETE FROM atec.tblinspectionresult
      WHERE testid = $1
      `,
      [testid]
    )

    for (const row of results) {
      await client.query(
        `
        INSERT INTO atec.tblinspectionresult
        (
          testid,
          criteriaid,
          criteriadescription,
          result,
          comments
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          testid,
          row.criteriaid || null,
          row.criteriadescription || '',
          row.result || '',
          row.comments || ''
        ]
      )
    }

    await client.query('COMMIT')

    res.json({
      message: 'Inspection results saved successfully',
      count: results.length
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error(error)
    res.status(500).json({ error: 'Failed to save inspection results' })
  } finally {
    client.release()
  }
})

app.post("/inspection-results", async (req, res) => {

  try {

    const {
      testid,
      criteriaid,
      result,
      remarks
    } = req.body

    const dbResult = await pool.query(
      `
      INSERT INTO atec.tblinspectionresult
      (
        testid,
        criteriaid,
        result,
        remarks
      )
      VALUES
      ($1,$2,$3,$4)
      RETURNING *
      `,
      [
        testid,
        criteriaid,
        result,
        remarks
      ]
    )

    res.json(dbResult.rows[0])

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }

})

app.get("/inspections/assets/search", async (req, res) => {
  try {
    const q = req.query.q || ""

    const result = await pool.query(`
      SELECT 
        assetid,
        assettagno,
        serialno,
        description,
        manufacturer
      FROM atec.tblasset
      WHERE
        assettagno ILIKE $1 OR
        serialno ILIKE $1 OR
        description ILIKE $1 OR
        CAST(assetid AS TEXT) ILIKE $1 OR
        qrcode ILIKE $1
      ORDER BY assetid DESC
      LIMIT 50
    `, [`%${q}%`])

    res.json(result.rows)
  } catch (err) {
    console.error("Asset search error:", err)
    res.status(500).json({ error: "Failed to search assets" })
  }
})

app.get("/certificates/search", async (req, res) => {
  try {
    const {
      search = "",
      inspectiontype = "",
      status = "",
      clientid = "",
      siteid = "",
      sectionid = "",
      datefrom = "",
      dateto = ""
    } = req.query

    const values = []
    let where = `WHERE 1 = 1`

    if (search) {
      values.push(`%${search}%`)
      where += `
        AND (
          CAST(i.testid AS TEXT) ILIKE $${values.length}
          OR i.tagnumber ILIKE $${values.length}
          OR a.assettagno ILIKE $${values.length}
          OR a.serialno ILIKE $${values.length}
          OR a.description ILIKE $${values.length}
          OR c.clientname ILIKE $${values.length}
          OR s.sitename ILIKE $${values.length}
          OR sec.sectionname ILIKE $${values.length}
          OR et.description ILIKE $${values.length}
        )
      `
    }

    if (inspectiontype) {
      values.push(inspectiontype)
      where += ` AND i.inspectiontype = $${values.length}`
    }

    if (status) {
      values.push(status)
      where += ` AND i.status = $${values.length}`
    }

    const effectiveClientId =
      req.user.role === "CUSTOMER"
        ? req.user.clientid
        : clientid

    if (req.user.role === "CUSTOMER" && !effectiveClientId) {
      return res.json([])
    }

    if (effectiveClientId) {
      values.push(effectiveClientId)
      where += ` AND a.clientid = $${values.length}`
    }

    if (siteid) {
      values.push(siteid)
      where += ` AND a.siteid = $${values.length}`
    }

    if (sectionid) {
      values.push(sectionid)
      where += ` AND a.sectionid = $${values.length}`
    }

    if (datefrom) {
      values.push(datefrom)
      where += ` AND i.testdate >= $${values.length}`
    }

    if (dateto) {
      values.push(dateto)
      where += ` AND i.testdate <= $${values.length}`
    }

    const result = await pool.query(
      `
      SELECT
        i.testid,
        i.testdate,
        i.validdate,
        i.inspectiontype,
        i.status,
        COALESCE(i.inspector_name, i.inspector) AS inspector,
        i.inspector_lmi_number,
        i.tagnumber,
        a.assetid,
        a.assettagno,
        a.serialno,
        a.description,
        c.clientname,
        s.sitename,
        sec.sectionname,
        et.description AS equipmenttype
      FROM atec.tblinspection i
      LEFT JOIN atec.tblasset a ON i.assetid = a.assetid
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
      LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
      ${where}
      ORDER BY i.testdate DESC, i.testid DESC
      LIMIT 200
      `,
      values
    )

    res.json(result.rows)

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/certificates/count", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) AS total
      FROM atec.tblinspection
    `)

    res.json(result.rows[0])

  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

async function getCertificateData(testid) {
  const inspectionResult = await pool.query(
    `
    SELECT
      i.*,
      COALESCE(i.inspector_name, i.inspector) AS inspector,
      a.assetid,
      a.equiptypeid,
      a.serialno,
      a.assettagno,
      a.manufacturer,
      a.description,
      a.media1,
      a.media2,
      a.manufactdate,
      a.wll,
      a.heightoflift,
      a.numberofchainfalls,
      a.oemtophooksize,
      a.oembottomhooksize,
      a.loadchaindiameter,
      a.effectivelength,
      a.span,
      a.permissibledeflection,
      a.hooksize,
      a.steelwireropemm,
      a.hoistdescription,
      a.hoistserialno,
      c.clientid,
      c.clientname,
      s.sitename,
      sec.sectionname,
      et.description AS equipmenttype,
      et.equipgroupid
    FROM atec.tblinspection i
    LEFT JOIN atec.tblasset a
      ON i.assetid = a.assetid
    LEFT JOIN atec.tblclients c
      ON a.clientid = c.clientid
    LEFT JOIN atec.tblsites s
      ON a.siteid = s.siteid
    LEFT JOIN atec.tblsection sec
      ON a.sectionid = sec.sectionid
    LEFT JOIN atec.tblequiptype et
      ON a.equiptypeid = et.equiptypeid
    WHERE i.testid = $1
    `,
    [testid]
  )

  if (inspectionResult.rows.length === 0) {
    return null
  }

  const resultsResult = await pool.query(
    `
    SELECT
      r.resultid,
      r.criteriaid,
      COALESCE(c.criterianame, 'Criteria ' || r.criteriaid) AS criterianame,
      c.fieldtype,
      r.assetvalue,
      r.measuredvalue,
      r.result,
      r.remarks
    FROM atec.tblinspectionresult r
    LEFT JOIN atec.tblequiptypecriteria c
      ON r.criteriaid = c.criteriaid
    WHERE r.testid = $1
    ORDER BY
      CASE
        WHEN LOWER(COALESCE(c.criterianame, '')) = 'safe for service' THEN 1
        ELSE 0
      END,
      c.sortorder,
      c.criteriaid
    `,
    [testid]
  )

  return {
    inspection: inspectionResult.rows[0],
    results: resultsResult.rows
  }
}

function formatPdfDate(value) {
  if (!value) return "-"

  if (value instanceof Date) {
    return value.toISOString().split("T")[0]
  }

  return String(value).split("T")[0]
}

function valueOrDash(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value)
}

function certificateImagePath(imagePath) {
  if (!imagePath) return null

  const normalizedPath = imagePath.replace(/^\/+/, "")
  const fullPath = path.join(__dirname, normalizedPath)

  return fs.existsSync(fullPath) ? fullPath : null
}

function getCertificateTitle(inspection) {
  return inspection.inspectiontype === "LOADTEST"
    ? "CERTIFICATE OF EXAMINATION AND TEST"
    : "CERTIFICATE OF INSPECTION"
}

function shouldShowDrivenMachineryNote(inspection) {
  return ["400", "500"].includes(String(inspection.equipgroupid || ""))
}

function canViewCertificate(user, certificate) {
  if (!user || !certificate) return false
  if (user.role !== "CUSTOMER") return true

  return String(certificate.inspection?.clientid || "") === String(user.clientid || "")
}

const DRIVEN_MACHINERY_CERTIFICATE_NOTE =
  "Certification that the item has been inspected in accordance with the requirements of Driven Machinery and SANS Regulations and the responsible person has been informed of all defects."

const SANS_500_CERTIFICATE_NOTE =
  "EXAMINED IN ACCORDANCE WITH SANS 500"

function shouldShowSans500Note(inspection) {
  return ["101", "102"].includes(String(inspection.equiptypeid || ""))
}

function addPdfKeyValues(doc, items, x, y, width, options = {}) {
  const columnCount = options.columns || 2
  const columnGap = 18
  const labelWidth = options.labelWidth || 106
  const fontSize = options.fontSize || 7.5
  const minRowHeight = options.rowHeight || 12
  const columnWidth = (width - (columnGap * (columnCount - 1))) / columnCount
  const rows = []

  for (let index = 0; index < items.length; index += columnCount) {
    rows.push(items.slice(index, index + columnCount))
  }

  rows.forEach(rowItems => {
    const rowHeight = Math.max(
      minRowHeight,
      ...rowItems.map(item => {
        const valueHeight = doc
          .font("Helvetica")
          .fontSize(fontSize)
          .heightOfString(valueOrDash(item[1]), {
            width: columnWidth - labelWidth - 4
          })

        return valueHeight + 3
      })
    )

    rowItems.forEach((item, column) => {
      const itemX = x + (column * (columnWidth + columnGap))
      const valueX = itemX + labelWidth

      doc
        .font("Helvetica-Bold")
        .fontSize(fontSize)
        .fillColor("#111827")
        .text(`${item[0]}:`, itemX, y, {
          width: labelWidth - 4,
          lineBreak: false
        })

      doc
        .font("Helvetica")
        .fontSize(fontSize)
        .text(valueOrDash(item[1]), valueX, y, {
          width: columnWidth - labelWidth,
          lineGap: 0
        })
    })

    y += rowHeight
  })

  return y
}

function addPdfMetaValues(doc, items, x, y, width) {
  const columnWidth = width / items.length

  items.forEach((item, index) => {
    const column = index
    const itemX = x + (column * columnWidth)
    const value = valueOrDash(item[1])
    const isStatus = String(item[0]).toLowerCase() === "status"
    const isSafe = value.toUpperCase() === "SAFE"
    const statusColor = isSafe ? "#00843d" : "#d00000"

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#111827")
      .text(`${item[0]}:`, itemX, y, {
        width: columnWidth,
        continued: false
      })

    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(isStatus ? statusColor : "#111827")
      .text(value, itemX + 78, y, {
        width: columnWidth - 82
      })
  })

  doc.fillColor("#111827")

  return y + 13
}

function addPdfSectionTitle(doc, title, x, y, width) {
  doc
    .moveTo(x, y + 12)
    .lineTo(x + width, y + 12)
    .strokeColor("#d9e1ec")
    .stroke()

  doc
    .fillColor("#1f3b5c")
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text(title, x, y)
    .fillColor("#111827")

  return y + 18
}

function drawCertificatePdf(doc, inspection, results) {
  const pageWidth = doc.page.width
  const marginX = 28.35
  const width = pageWidth - (marginX * 2)
  let y = 14

  const headerPath = path.join(__dirname, "..", "frontend", "public", "header.jpg")
  const footerPath = path.join(__dirname, "..", "frontend", "public", "footer.jpg")

  if (fs.existsSync(headerPath)) {
    doc.image(headerPath, marginX, y, { width, height: 82 })
  }

  y += 86

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#1f2937")
    .text(getCertificateTitle(inspection), marginX, y, {
      width,
      align: "center"
    })

  y += 18
  doc.moveTo(marginX, y).lineTo(marginX + width, y).strokeColor("#9ca3af").stroke()
  y += 6

  y = addPdfMetaValues(doc, [
    ["Certificate No", inspection.testid],
    ["Tag Number", inspection.tagnumber],
    ["Status", inspection.status]
  ], marginX, y, width)

  y += 8
  doc.moveTo(marginX, y).lineTo(marginX + width, y).strokeColor("#9ca3af").stroke()
  y += 10

  y = addPdfSectionTitle(doc, "Customer Details", marginX, y, width)
  y = addPdfKeyValues(doc, [
    ["Client", inspection.clientname],
    ["Site", inspection.sitename],
    ["Section", inspection.sectionname]
  ], marginX, y, width)

  y += 8
  y = addPdfSectionTitle(doc, "Asset Details", marginX, y, width)
  y = addPdfKeyValues(doc, [
    ["Asset ID", inspection.assetid],
    ["Asset Tag No", inspection.assettagno],
    ["Equipment Type", inspection.equipmenttype],
    ["Description", inspection.description],
    ["Serial No", inspection.serialno],
    ["Manufacturer", inspection.manufacturer]
  ], marginX, y, width)

  const assetSpecs = [
    ["WLL", inspection.wll ? `${inspection.wll} kg` : ""],
    ["Height of Lift", inspection.heightoflift ? `${inspection.heightoflift} mm` : ""],
    ["Span/Jib", inspection.span ? `${inspection.span} mm` : ""],
    ["Permissible Deflection", inspection.permissibledeflection ? `${inspection.permissibledeflection} mm` : ""],
    ["Hook Size", inspection.hooksize ? `${inspection.hooksize} mm` : ""],
    ["Steel Wire Rope", inspection.steelwireropemm ? `${inspection.steelwireropemm} mm` : ""],
    ["Manufacture Date", formatPdfDate(inspection.manufactdate)]
  ].filter(([, value]) => value && value !== "-")

  if (assetSpecs.length) {
    y += 8
    y = addPdfSectionTitle(doc, "Asset Specifications", marginX, y, width)
    y = addPdfKeyValues(doc, assetSpecs, marginX, y, width)
  }

  y += 8
  y = addPdfSectionTitle(doc, "Inspection Details", marginX, y, width)
  y = addPdfKeyValues(doc, [
    ["Inspection Type", inspection.inspectiontype],
    ["Inspection Date", formatPdfDate(inspection.testdate)],
    ["Certificate Expiry Date", formatPdfDate(inspection.validdate)],
    ["Inspector", inspection.inspector],
    ["LMI Number", inspection.inspector_lmi_number]
  ], marginX, y, width)

  y += 8
  y = addPdfSectionTitle(doc, "Inspection Photos", marginX, y, width)

  const photo1Path = certificateImagePath(inspection.photo1 || inspection.media1)
  const photo2Path = certificateImagePath(inspection.photo2 || inspection.media2)
  const photoBoxWidth = (width - 12) / 2
  const photoBoxHeight = 110

  ;[photo1Path, photo2Path].forEach((photoPath, index) => {
    const boxX = marginX + (index * (photoBoxWidth + 12))
    doc.rect(boxX, y, photoBoxWidth, photoBoxHeight).strokeColor("#d9e1ec").stroke()

    if (photoPath) {
      doc.image(photoPath, boxX + 5, y + 5, {
        fit: [photoBoxWidth - 10, photoBoxHeight - 18],
        align: "center",
        valign: "center"
      })
      doc.font("Helvetica").fontSize(6.5).text(`Photo ${index + 1}`, boxX, y + photoBoxHeight - 10, {
        width: photoBoxWidth,
        align: "center"
      })
    } else {
      doc.font("Helvetica").fontSize(7).fillColor("#6b7280").text(`No Photo ${index + 1}`, boxX, y + 30, {
        width: photoBoxWidth,
        align: "center"
      }).fillColor("#111827")
    }
  })

  y += photoBoxHeight + 10
  y = addPdfSectionTitle(doc, "Inspection Results", marginX, y, width)

  const tableColumns = [
    { title: "Criteria", width: 160 },
    { title: "Asset Value", width: 70 },
    { title: "Measured Value", width: 80 },
    { title: "Result", width: 65 },
    { title: "Remarks", width: width - 375 }
  ]

  let x = marginX
  doc.font("Helvetica-Bold").fontSize(7)
  tableColumns.forEach(column => {
    doc.rect(x, y, column.width, 14).fillAndStroke("#1f3b5c", "#1f3b5c")
    doc.fillColor("#ffffff")
    doc.text(column.title, x + 3, y + 4, { width: column.width - 6 })
    x += column.width
  })

  y += 14
  doc.fillColor("#111827").font("Helvetica").fontSize(7)

  results.forEach(row => {
    const values = [
      valueOrDash(row.criterianame),
      row.assetvalue || "",
      row.measuredvalue || "",
      row.result || "",
      row.remarks || ""
    ]

    const rowHeight = Math.max(
      14,
      doc.heightOfString(values[0], { width: tableColumns[0].width - 6 }) + 6,
      doc.heightOfString(values[4], { width: tableColumns[4].width - 6 }) + 6
    )

    x = marginX
    tableColumns.forEach((column, index) => {
      doc.rect(x, y, column.width, rowHeight).strokeColor("#d9e1ec").stroke()
      doc
        .font(index === 3 ? "Helvetica-Bold" : "Helvetica")
        .text(values[index], x + 3, y + 4, { width: column.width - 6 })
      x += column.width
    })

    y += rowHeight
  })

  if (shouldShowDrivenMachineryNote(inspection)) {
    y += 10
    doc
      .font("Helvetica-Oblique")
      .fontSize(7.5)
      .fillColor("#d00000")
      .text(DRIVEN_MACHINERY_CERTIFICATE_NOTE, marginX, y, {
        width,
        align: "center"
      })
      .fillColor("#111827")

    y += doc.heightOfString(DRIVEN_MACHINERY_CERTIFICATE_NOTE, {
      width,
      align: "center"
    }) + 4
  }

  if (shouldShowSans500Note(inspection)) {
    y += 6
    doc
      .font("Helvetica-Oblique")
      .fontSize(8)
      .fillColor("#d00000")
      .text(SANS_500_CERTIFICATE_NOTE, marginX, y, {
        width,
        align: "center"
      })
      .fillColor("#111827")

    y += doc.heightOfString(SANS_500_CERTIFICATE_NOTE, {
      width,
      align: "center"
    }) + 4
  }

  y += 14
  doc.font("Helvetica-Bold").fontSize(8).text("Inspector Signature", marginX, y)
  const signaturePath = certificateImagePath(inspection.inspector_signature_image)
  if (signaturePath) {
    doc.image(signaturePath, marginX, y + 8, {
      fit: [180, 28],
      align: "left",
      valign: "center"
    })
  }
  doc.moveTo(marginX, y + 36).lineTo(marginX + 180, y + 36).strokeColor("#111827").stroke()

  if (fs.existsSync(footerPath)) {
    doc.image(footerPath, marginX + (width * 0.38), y - 12, { fit: [width * 0.62, 70] })
  }
}

app.get("/inspections/:testid/certificate", async (req, res) => {
  try {
    const { testid } = req.params
    const certificate = await getCertificateData(testid)

    if (!certificate) {
      return res.status(404).json({
        error: "Certificate not found"
      })
    }

    if (!canViewCertificate(req.user, certificate)) {
      return res.status(403).json({ error: "Access denied" })
    }

    await req.logAudit("VIEW", "certificates", testid)
    res.json(certificate)

  } catch (err) {
    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/inspections/:testid/certificate.pdf", async (req, res) => {
  try {
    const { testid } = req.params
    const certificate = await getCertificateData(testid)

    if (!certificate) {
      return res.status(404).json({
        error: "Certificate not found"
      })
    }

    if (!canViewCertificate(req.user, certificate)) {
      return res.status(403).json({ error: "Access denied" })
    }

    await req.logAudit("GENERATE_PDF", "certificates", testid)

    res.setHeader("Content-Type", "application/pdf")
    const disposition =
      req.query.inline === "1" ? "inline" : "attachment"

    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="certificate-${testid}.pdf"`
    )

    const doc = new PDFDocument({
      size: "A4",
      margin: 28,
      bufferPages: false
    })

    doc.pipe(res)
    drawCertificatePdf(doc, certificate.inspection, certificate.results)
    doc.end()

  } catch (err) {
    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/dashboard/visual-due", async (req, res) => {
  try {
    res.json({ total: 0 })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

function reportDate(value) {
  if (!value) return "-"

  if (value instanceof Date) {
    return value.toISOString().split("T")[0]
  }

  return String(value).split("T")[0]
}

function reportValue(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value)
}

function reportFileName(report, extension) {
  const customerName =
    report.customers.length === 1
      ? report.customers[0].clientname
      : "all-customers"

  const cleanName = String(customerName || "customer-report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

  return `customer-detailed-report-${cleanName || "customers"}.${extension}`
}

function customerReportFilters(query = {}) {
  return {
    clientid: query.clientid || "",
    equiptypeid: query.equiptypeid || "",
    datefrom: query.datefrom || "",
    dateto: query.dateto || ""
  }
}

function customerScopedReportFilters(req) {
  const filters = customerReportFilters(req.query)

  if (req.user.role === "CUSTOMER") {
    filters.clientid = req.user.clientid || "-1"
  }

  return filters
}

async function getCustomerDetailedReport(filters = {}) {
  const {
    clientid = "",
    equiptypeid = "",
    datefrom = "",
    dateto = ""
  } = filters

  const customerValues = []
  const values = []
  let customerWhere = "WHERE 1 = 1"
  let assetWhere = "WHERE 1 = 1"
  const inspectionWhere = []

  if (clientid) {
    customerValues.push(clientid)
    customerWhere += ` AND c.clientid = $${customerValues.length}`

    values.push(clientid)
    assetWhere += ` AND a.clientid = $${values.length}`
  }

  if (equiptypeid) {
    values.push(equiptypeid)
    assetWhere += ` AND a.equiptypeid = $${values.length}`
  }

  if (datefrom) {
    values.push(datefrom)
    inspectionWhere.push(`testdate >= $${values.length}`)
  }

  if (dateto) {
    values.push(dateto)
    inspectionWhere.push(`testdate <= $${values.length}`)
  }

  const inspectionFilterSql = inspectionWhere.length
    ? ` AND ${inspectionWhere.join(" AND ")}`
    : ""

  if (datefrom || dateto) {
    assetWhere += `
      AND (
        lv.testdate IS NOT NULL
        OR ll.testdate IS NOT NULL
      )
    `
  }

  const customerResult = await pool.query(
    `
    SELECT
      c.clientid,
      c.clientname,
      c.clientaddr,
      c.archived,
      COUNT(DISTINCT s.siteid) AS sitecount,
      COUNT(DISTINCT sec.sectionid) AS sectioncount,
      COUNT(DISTINCT p.personid) AS responsiblecount
    FROM atec.tblclients c
    LEFT JOIN atec.tblsites s
      ON c.clientid = s.clientid
    LEFT JOIN atec.tblsection sec
      ON c.clientid = sec.clientid
    LEFT JOIN atec.tblpeople p
      ON c.clientid = p.clientid
    ${customerWhere}
    GROUP BY c.clientid, c.clientname, c.clientaddr, c.archived
    ORDER BY c.clientname
    `,
    customerValues
  )

  const assetResult = await pool.query(
    `
    WITH latest_visual AS (
      SELECT DISTINCT ON (assetid)
        assetid,
        testid,
        testdate,
        validdate,
        status,
        inspector
      FROM atec.tblinspection
      WHERE inspectiontype = 'VISUAL'
      ${inspectionFilterSql}
      ORDER BY assetid, testdate DESC NULLS LAST, testid DESC
    ),
    latest_load AS (
      SELECT DISTINCT ON (assetid)
        assetid,
        testid,
        testdate,
        validdate,
        status,
        inspector
      FROM atec.tblinspection
      WHERE inspectiontype = 'LOADTEST'
      ${inspectionFilterSql}
      ORDER BY assetid, testdate DESC NULLS LAST, testid DESC
    )
    SELECT
      c.clientid,
      c.clientname,
      c.clientaddr,
      a.assetid,
      a.assettagno,
      a.serialno,
      a.description,
      a.manufacturer,
      a.wll,
      a.archived,
      s.sitename,
      sec.sectionname,
      p.name AS responsiblename,
      et.description AS equipmenttype,
      lv.testid AS visualtestid,
      lv.testdate AS visualtestdate,
      lv.validdate AS visualvaliddate,
      lv.status AS visualstatus,
      lv.inspector AS visualinspector,
      ll.testid AS loadtestid,
      ll.testdate AS loadtestdate,
      ll.validdate AS loadvaliddate,
      ll.status AS loadstatus,
      ll.inspector AS loadinspector,
      GREATEST(lv.testdate, ll.testdate) AS latestinspectiondate,
      CASE
        WHEN lv.testdate IS NULL THEN NULL
        ELSE (lv.testdate + INTERVAL '3 months')::date
      END AS nextvisualdue,
      CASE
        WHEN ll.testdate IS NULL THEN NULL
        ELSE (ll.testdate + INTERVAL '12 months')::date
      END AS nextloaddue,
      CASE
        WHEN COALESCE(a.archived, false) = true THEN 'ARCHIVED'
        WHEN lv.status = 'NOT SAFE' OR ll.status = 'NOT SAFE' THEN 'NOT SAFE'
        WHEN lv.testdate IS NULL THEN 'NO VISUAL'
        WHEN ll.testdate IS NULL THEN 'NO LOAD TEST'
        WHEN (lv.testdate + INTERVAL '3 months')::date < CURRENT_DATE THEN 'VISUAL OVERDUE'
        WHEN (ll.testdate + INTERVAL '12 months')::date < CURRENT_DATE THEN 'LOAD TEST OVERDUE'
        ELSE 'OK'
      END AS reportstatus
    FROM atec.tblasset a
    LEFT JOIN atec.tblclients c
      ON a.clientid = c.clientid
    LEFT JOIN atec.tblsites s
      ON a.siteid = s.siteid
    LEFT JOIN atec.tblsection sec
      ON a.sectionid = sec.sectionid
    LEFT JOIN atec.tblpeople p
      ON a.responsibleid = p.personid
    LEFT JOIN atec.tblequiptype et
      ON a.equiptypeid = et.equiptypeid
    LEFT JOIN latest_visual lv
      ON a.assetid = lv.assetid
    LEFT JOIN latest_load ll
      ON a.assetid = ll.assetid
    ${assetWhere}
    ORDER BY latestinspectiondate DESC NULLS LAST, c.clientname, s.sitename, sec.sectionname, a.assetid
    `,
    values
  )

  const assets = assetResult.rows
  const activeAssets = assets.filter(row => row.archived !== true)
  const statusCounts = activeAssets.reduce((counts, row) => {
    counts[row.reportstatus] = (counts[row.reportstatus] || 0) + 1
    return counts
  }, {})

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      clientid: clientid || "",
      equiptypeid: equiptypeid || "",
      datefrom: datefrom || "",
      dateto: dateto || ""
    },
    customers: customerResult.rows,
    assets,
    summary: {
      customers: customerResult.rows.length,
      assets: assets.length,
      activeAssets: activeAssets.length,
      archivedAssets: assets.length - activeAssets.length,
      safeAssets: activeAssets.filter(row => row.reportstatus === "OK").length,
      notSafeAssets: activeAssets.filter(row => row.reportstatus === "NOT SAFE").length,
      visualOverdueAssets: activeAssets.filter(row => row.reportstatus === "VISUAL OVERDUE").length,
      loadOverdueAssets: activeAssets.filter(row => row.reportstatus === "LOAD TEST OVERDUE").length,
      noVisualAssets: activeAssets.filter(row => row.reportstatus === "NO VISUAL").length,
      noLoadAssets: activeAssets.filter(row => row.reportstatus === "NO LOAD TEST").length,
      statusCounts
    }
  }
}

function drawCustomerReportPdf(doc, report) {
  const marginX = 32
  const width = doc.page.width - (marginX * 2)
  let y = 28

  const title =
    report.customers.length === 1
      ? report.customers[0].clientname
      : "All Customers"

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor("#1f2937")
    .text("Customer Detailed Report", marginX, y, { width })

  y += 24

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#1f3b5c")
    .text(title, marginX, y, { width })

  y += 16

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#374151")
    .text(`Generated: ${reportDate(report.generatedAt)}`, marginX, y)

  y += 20

  const summaryItems = [
    ["Customers", report.summary.customers],
    ["Assets", report.summary.assets],
    ["Active", report.summary.activeAssets],
    ["OK", report.summary.safeAssets],
    ["Not Safe", report.summary.notSafeAssets],
    ["Visual Overdue", report.summary.visualOverdueAssets],
    ["Load Overdue", report.summary.loadOverdueAssets],
    ["No Visual", report.summary.noVisualAssets],
    ["No Load Test", report.summary.noLoadAssets]
  ]

  const summaryWidth = width / 3

  summaryItems.forEach((item, index) => {
    const col = index % 3
    const row = Math.floor(index / 3)
    const boxX = marginX + (col * summaryWidth)
    const boxY = y + (row * 24)

    doc.rect(boxX, boxY, summaryWidth - 8, 20).strokeColor("#d9e1ec").stroke()
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#1f3b5c").text(item[0], boxX + 5, boxY + 4, {
      width: summaryWidth - 50
    })
    doc.font("Helvetica").fontSize(9).fillColor("#111827").text(reportValue(item[1]), boxX + summaryWidth - 45, boxY + 4, {
      width: 36,
      align: "right"
    })
  })

  y += 84

  const columns = [
    ["Asset", 45],
    ["Tag", 56],
    ["Serial", 70],
    ["Site", 72],
    ["Section", 72],
    ["Equipment", 82],
    ["Description", 112],
    ["Last Visual", 58],
    ["Visual Status", 54],
    ["Last Load", 58],
    ["Load Status", 54],
    ["Report Status", width - 733]
  ]

  const drawHeader = () => {
    let x = marginX
    doc.font("Helvetica-Bold").fontSize(6.5)
    columns.forEach(([label, colWidth]) => {
      doc.rect(x, y, colWidth, 16).fillAndStroke("#1f3b5c", "#1f3b5c")
      doc.fillColor("#ffffff").text(label, x + 3, y + 5, { width: colWidth - 6 })
      x += colWidth
    })
    y += 16
    doc.fillColor("#111827").font("Helvetica").fontSize(6.4)
  }

  drawHeader()

  report.assets.forEach(row => {
    if (y > doc.page.height - 48) {
      doc.addPage()
      y = 28
      drawHeader()
    }

    const values = [
      row.assetid,
      row.assettagno,
      row.serialno,
      row.sitename,
      row.sectionname,
      row.equipmenttype,
      row.description,
      reportDate(row.visualtestdate),
      row.visualstatus,
      reportDate(row.loadtestdate),
      row.loadstatus,
      row.reportstatus
    ].map(reportValue)

    const rowHeight = Math.max(
      18,
      doc.heightOfString(values[6], { width: columns[6][1] - 6 }) + 8,
      doc.heightOfString(values[11], { width: columns[11][1] - 6 }) + 8
    )

    let x = marginX
    columns.forEach(([, colWidth], index) => {
      doc.rect(x, y, colWidth, rowHeight).strokeColor("#d9e1ec").stroke()
      doc
        .font(index === 11 ? "Helvetica-Bold" : "Helvetica")
        .fillColor(values[index] === "NOT SAFE" ? "#d00000" : "#111827")
        .text(values[index], x + 3, y + 4, { width: colWidth - 6 })
      x += colWidth
    })

    y += rowHeight
  })
}

async function buildCustomerReportWorkbook(report) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "ATEC"
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet("Summary")
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 28 },
    { header: "Value", key: "value", width: 18 }
  ]

  summarySheet.addRow(["Generated", reportDate(report.generatedAt)])
  summarySheet.addRow(["Customers", report.summary.customers])
  summarySheet.addRow(["Assets", report.summary.assets])
  summarySheet.addRow(["Active Assets", report.summary.activeAssets])
  summarySheet.addRow(["Archived Assets", report.summary.archivedAssets])
  summarySheet.addRow(["OK Assets", report.summary.safeAssets])
  summarySheet.addRow(["Not Safe Assets", report.summary.notSafeAssets])
  summarySheet.addRow(["Visual Overdue Assets", report.summary.visualOverdueAssets])
  summarySheet.addRow(["Load Overdue Assets", report.summary.loadOverdueAssets])
  summarySheet.addRow(["No Visual Assets", report.summary.noVisualAssets])
  summarySheet.addRow(["No Load Test Assets", report.summary.noLoadAssets])

  summarySheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  summarySheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F3B5C" }
  }

  const assetSheet = workbook.addWorksheet("Assets")
  assetSheet.columns = [
    { header: "Customer", key: "clientname", width: 28 },
    { header: "Address", key: "clientaddr", width: 32 },
    { header: "Site", key: "sitename", width: 22 },
    { header: "Section", key: "sectionname", width: 22 },
    { header: "Responsible Person", key: "responsiblename", width: 24 },
    { header: "Asset ID", key: "assetid", width: 12 },
    { header: "Asset Tag No", key: "assettagno", width: 18 },
    { header: "Serial No", key: "serialno", width: 20 },
    { header: "Equipment Type", key: "equipmenttype", width: 28 },
    { header: "Description", key: "description", width: 36 },
    { header: "Manufacturer", key: "manufacturer", width: 22 },
    { header: "WLL", key: "wll", width: 12 },
    { header: "Latest Inspection Date", key: "latestinspectiondate", width: 20 },
    { header: "Last Visual Test ID", key: "visualtestid", width: 16 },
    { header: "Last Visual Date", key: "visualtestdate", width: 16 },
    { header: "Visual Valid Until", key: "visualvaliddate", width: 18 },
    { header: "Visual Status", key: "visualstatus", width: 16 },
    { header: "Visual Inspector", key: "visualinspector", width: 20 },
    { header: "Next Visual Due", key: "nextvisualdue", width: 16 },
    { header: "Last Load Test ID", key: "loadtestid", width: 16 },
    { header: "Last Load Date", key: "loadtestdate", width: 16 },
    { header: "Load Valid Until", key: "loadvaliddate", width: 18 },
    { header: "Load Status", key: "loadstatus", width: 16 },
    { header: "Load Inspector", key: "loadinspector", width: 20 },
    { header: "Next Load Due", key: "nextloaddue", width: 16 },
    { header: "Report Status", key: "reportstatus", width: 22 },
    { header: "Archived", key: "archived", width: 12 }
  ]

  report.assets.forEach(row => {
    assetSheet.addRow({
      ...row,
      latestinspectiondate: reportDate(row.latestinspectiondate),
      visualtestdate: reportDate(row.visualtestdate),
      visualvaliddate: reportDate(row.visualvaliddate),
      nextvisualdue: reportDate(row.nextvisualdue),
      loadtestdate: reportDate(row.loadtestdate),
      loadvaliddate: reportDate(row.loadvaliddate),
      nextloaddue: reportDate(row.nextloaddue),
      archived: row.archived ? "Yes" : "No"
    })
  })

  ;[summarySheet, assetSheet].forEach(sheet => {
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F3B5C" }
    }
    sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.eachRow(row => {
      row.eachCell(cell => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFD9E1EC" } },
          left: { style: "thin", color: { argb: "FFD9E1EC" } },
          bottom: { style: "thin", color: { argb: "FFD9E1EC" } },
          right: { style: "thin", color: { argb: "FFD9E1EC" } }
        }
      })
    })
  })

  assetSheet.autoFilter = {
    from: "A1",
    to: "AA1"
  }

  return workbook
}

app.get("/reports/customer-detailed", async (req, res) => {
  try {
    const report = await getCustomerDetailedReport(customerScopedReportFilters(req))
    res.json(report)
  } catch (err) {
    console.error("Customer detailed report error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/reports/customer-detailed.pdf", async (req, res) => {
  try {
    const report = await getCustomerDetailedReport(customerScopedReportFilters(req))
    const filename = reportFileName(report, "pdf")

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 28,
      bufferPages: false
    })

    doc.pipe(res)
    drawCustomerReportPdf(doc, report)
    doc.end()
  } catch (err) {
    console.error("Customer detailed PDF error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/reports/customer-detailed.xlsx", async (req, res) => {
  try {
    const report = await getCustomerDetailedReport(customerScopedReportFilters(req))
    const workbook = await buildCustomerReportWorkbook(report)
    const filename = reportFileName(report, "xlsx")

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

    await workbook.xlsx.write(res)
    res.end()
  } catch (err) {
    console.error("Customer detailed Excel error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/dashboard/stats", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM atec.tblclients) AS customers,
        (SELECT COUNT(*) FROM atec.tblsites) AS sites,
        (SELECT COUNT(*) FROM atec.tblasset WHERE COALESCE(archived,false)=false) AS assets,
        (SELECT COUNT(*) FROM atec.tblequiptype) AS equipmenttypes,
        (SELECT COUNT(*) FROM atec.tblinspection) AS certificates,
        (SELECT COUNT(*) FROM atec.tblinspection WHERE status = 'NOT SAFE') AS failedtotal,

        (
          SELECT COUNT(*)
          FROM atec.tblasset a
          LEFT JOIN (
            SELECT assetid, MAX(testdate) AS lastvisual
            FROM atec.tblinspection
            WHERE inspectiontype = 'VISUAL'
            GROUP BY assetid
          ) i ON a.assetid = i.assetid
          WHERE COALESCE(a.archived,false)=false
          AND (
            i.lastvisual IS NULL
            OR i.lastvisual + INTERVAL '3 months' <= CURRENT_DATE + INTERVAL '30 days'
          )
        ) AS visualdue,

        (
          SELECT COUNT(*)
          FROM atec.tblasset a
          LEFT JOIN (
            SELECT assetid, MAX(testdate) AS lastloadtest
            FROM atec.tblinspection
            WHERE inspectiontype = 'LOADTEST'
            GROUP BY assetid
          ) i ON a.assetid = i.assetid
          WHERE COALESCE(a.archived,false)=false
          AND (
            i.lastloadtest IS NULL
            OR i.lastloadtest + INTERVAL '12 months' <= CURRENT_DATE + INTERVAL '30 days'
          )
        ) AS loadtestdue,

        (
          SELECT COUNT(*)
          FROM atec.tblasset a
          LEFT JOIN (
            SELECT assetid, MAX(testdate) AS lastvisual
            FROM atec.tblinspection
            WHERE inspectiontype = 'VISUAL'
            GROUP BY assetid
          ) v ON a.assetid = v.assetid
          LEFT JOIN (
            SELECT assetid, MAX(testdate) AS lastloadtest
            FROM atec.tblinspection
            WHERE inspectiontype = 'LOADTEST'
            GROUP BY assetid
          ) l ON a.assetid = l.assetid
          WHERE COALESCE(a.archived,false)=false
          AND (
            v.lastvisual + INTERVAL '3 months' < CURRENT_DATE
            OR l.lastloadtest + INTERVAL '12 months' < CURRENT_DATE
          )
        ) AS overdue
    `)

    res.json(result.rows[0])

  } catch (err) {
    console.error("Dashboard stats error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/dashboard/attention", async (req, res) => {
  try {
    const result = await pool.query(`
      WITH last_visual AS (
        SELECT assetid, MAX(testdate) AS lastvisual
        FROM atec.tblinspection
        WHERE inspectiontype = 'VISUAL'
        GROUP BY assetid
      ),
      last_load AS (
        SELECT assetid, MAX(testdate) AS lastload
        FROM atec.tblinspection
        WHERE inspectiontype = 'LOADTEST'
        GROUP BY assetid
      )
      SELECT
        a.assetid,
        a.assettagno,
        a.serialno,
        c.clientname,
        s.sitename,
        e.description AS equipmenttype,
        lv.lastvisual,
        ll.lastload,

        CASE
          WHEN lv.lastvisual IS NULL THEN 'No Visual Inspection'
          WHEN lv.lastvisual < CURRENT_DATE - INTERVAL '3 months' THEN 'Visual Overdue'
          WHEN ll.lastload IS NULL THEN 'No Load Test'
          WHEN ll.lastload < CURRENT_DATE - INTERVAL '12 months' THEN 'Load Test Overdue'
          ELSE 'OK'
        END AS reason,

        CASE
          WHEN lv.lastvisual IS NULL THEN NULL
          WHEN lv.lastvisual < CURRENT_DATE - INTERVAL '3 months'
            THEN CURRENT_DATE - (lv.lastvisual + INTERVAL '3 months')::date
          WHEN ll.lastload IS NULL THEN NULL
          WHEN ll.lastload < CURRENT_DATE - INTERVAL '12 months'
            THEN CURRENT_DATE - (ll.lastload + INTERVAL '12 months')::date
          ELSE 0
        END AS daysoverdue

      FROM atec.tblasset a
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblequiptype e ON a.equiptypeid = e.equiptypeid      
      LEFT JOIN last_visual lv ON a.assetid = lv.assetid
      LEFT JOIN last_load ll ON a.assetid = ll.assetid
      WHERE COALESCE(a.archived,false)=false
      AND (
        lv.lastvisual IS NULL
        OR lv.lastvisual < CURRENT_DATE - INTERVAL '3 months'
        OR ll.lastload IS NULL
        OR ll.lastload < CURRENT_DATE - INTERVAL '12 months'
      )
      ORDER BY daysoverdue DESC NULLS LAST, a.assetid DESC
      LIMIT 50
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Dashboard attention error:", err);
    res.status(500).json({ error: "Failed to load dashboard attention items" });
  }
});

app.get("/dashboard/failed-equipment", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        i.testid,
        i.assetid,
        a.assettagno,
        a.serialno,
        c.clientname,
        s.sitename,
        e.description AS equipmenttype,
        i.testdate,
        i.validdate,
        i.inspector,
        i.status
      FROM atec.tblinspection i
      JOIN atec.tblasset a
        ON i.assetid = a.assetid
      LEFT JOIN atec.tblclients c
        ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s
        ON a.siteid = s.siteid
      LEFT JOIN atec.tblequiptype e ON a.equiptypeid = e.equiptypeid
      WHERE i.status = 'NOT SAFE'
      ORDER BY i.testdate DESC
      LIMIT 20
    `)

    res.json(result.rows)
  } catch (err) {
    console.error("Dashboard failed equipment error:", err)
    res.status(500).json({
      error: "Failed to load failed equipment"
    })
  }
})

app.get("/dashboard/upcoming-expiries", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (a.assetid)
        i.testid,
        a.assetid,
        a.assettagno,
        a.serialno,
        c.clientname,
        s.sitename,
        et.description AS equipmenttype,
        i.inspectiontype,
        i.testdate,
        i.validdate,
        (i.validdate - CURRENT_DATE) AS daysremaining
      FROM atec.tblinspection i
      JOIN atec.tblasset a
        ON i.assetid = a.assetid
      LEFT JOIN atec.tblclients c
        ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s
        ON a.siteid = s.siteid
      LEFT JOIN atec.tblequiptype et
        ON a.equiptypeid = et.equiptypeid
      WHERE
        i.validdate IS NOT NULL
        AND i.validdate <= CURRENT_DATE + INTERVAL '90 days'
      ORDER BY
        a.assetid,
        i.validdate DESC
    `)

    res.json(result.rows)

  } catch (err) {
    console.error("Dashboard upcoming expiries:", err)
    res.status(500).json({
      error: "Failed to load upcoming expiries"
    })
  }
})

app.get("/dashboard/alerts", async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT
      (
        SELECT COUNT(*)
        FROM atec.tblinspection
        WHERE status='NOT SAFE'
      ) AS failed,

      (
        SELECT COUNT(*)
        FROM atec.tblinspection
        WHERE validdate IS NOT NULL
        AND validdate BETWEEN CURRENT_DATE
        AND CURRENT_DATE + INTERVAL '30 days'
      ) AS expiring,

      (
        SELECT COUNT(*)
        FROM atec.tblasset a
        LEFT JOIN (
          SELECT
            assetid,
            MAX(validdate) AS validdate
          FROM atec.tblinspection
          GROUP BY assetid
        ) i
          ON a.assetid=i.assetid
        WHERE
          COALESCE(a.archived,false)=false
          AND (
            i.validdate IS NULL
            OR i.validdate<CURRENT_DATE
          )
      ) AS overdue
    `)

    res.json(result.rows[0])

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }
})

app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`ATEC server running on port ${PORT}`);
});

