const express = require("express");
const cors = require("cors");
const pool = require("./db");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("ATEC backend is running");
});

app.get("/customers", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM atec.tblclients ORDER BY clientid`
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

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
    res.status(500).json({ error: err.message });
  }
});

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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

app.get("/assets", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.assetid,
        a.serialno,
        a.assettagno,
        a.manufacturer,
        a.description,
        a.floatparam1,
        a.floatparam2,
        a.floatparam3,
        a.floatparam4,
        a.intparam1,
        a.intparam2,
        a.paramstring1,
        a.paramstring2,
        a.media1,
        a.media2,
        c.clientname,
        s.sitename,
        sec.sectionname,
        et.description AS equipmenttype
      FROM atec.tblasset a
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
      LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
      ORDER BY a.assetid
      LIMIT 100
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

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
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;

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
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ATEC server running on port ${PORT}`);
});