const { Pool } = require("pg");
require("dotenv").config();
const { dbPoolConfig } = require("./services/runtimeConfig")

const poolConfig = dbPoolConfig(process.env)

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: poolConfig.max,
  idleTimeoutMillis: poolConfig.idleTimeoutMillis,
  connectionTimeoutMillis: poolConfig.connectionTimeoutMillis,
  statement_timeout: poolConfig.statement_timeout,
  query_timeout: poolConfig.query_timeout,
  application_name: process.env.DB_APPLICATION_NAME || "atec-backend",
});

pool.on("error", err => {
  console.error("Database pool error", {
    message: err?.message || "Unknown database pool error",
    code: err?.code
  })
})

module.exports = pool;
