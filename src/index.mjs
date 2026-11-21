import "dotenv/config";
import pool from "./db/postgres.mjs";
import { exportSnapshot } from "./export/exporter.mjs";

try {
  const output = await exportSnapshot();

  console.log("\nExport successful!");
  console.log("Output:", output);
} catch (error) {
  console.error("\nExport failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
