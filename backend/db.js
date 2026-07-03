const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_MAX || 15),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000),
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 30000),
  application_name: process.env.DB_APPLICATION_NAME || "atec-backend",
});

module.exports = pool;
