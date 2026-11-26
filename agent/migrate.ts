import { readFileSync } from "node:fs";
import { pool } from "../lib/db";

async function main() {
  await pool.query(readFileSync("db/schema.sql", "utf8"));
  console.log("Database schema is up to date.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
