import pool from "../db/postgres.mjs";
import { to as copyTo } from "pg-copy-streams";

import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { mkdir, rm, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { csvToParquet } from "./parquet.mjs";

const TABLES = [
  {
    name: "messages",
    table: "export_messages",
    orderBy: "id",
  },
  {
    name: "users",
    table: "export_users",
    orderBy: "id",
  },
];

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function exportTable(client, table, stagingDir) {
  const csvPath = path.join(stagingDir, `${table.name}.csv`);
  const parquetPath = path.join(stagingDir, `${table.name}.parquet`);

  const sql = `
    COPY (
      SELECT *
      FROM public.${quoteIdentifier(table.table)}
      ORDER BY ${quoteIdentifier(table.orderBy)}
    )
    TO STDOUT
    WITH (FORMAT CSV, HEADER TRUE, ENCODING 'UTF8')
  `;

  console.log(`Exporting ${table.table}...`);
  const stream = client.query(copyTo(sql));
  await pipeline(stream, createWriteStream(csvPath));
  console.log(`CSV saved: ${csvPath}`);

  console.log(`Converting ${table.name} to Parquet...`);
  await csvToParquet(csvPath, parquetPath);
  console.log(`Parquet saved: ${parquetPath}`);

  // Count rows from the resulting Parquet file.
  // This verifies the converted file independently.
  const { DuckDBInstance } = await import("@duckdb/node-api");

  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  let rowCount;

  try {
    const escapedPath = parquetPath.replaceAll("'", "''");

    const result = await connection.runAndReadAll(`
      SELECT COUNT(*)
      FROM read_parquet('${escapedPath}')
    `);

    rowCount = Number(result.getRows()[0][0]);
  } finally {
    connection.closeSync();
  }

  console.log(`Finished ${table.name}: ${rowCount} rows`);
  return {
    csv: `${table.name}.csv`,
    parquet: `${table.name}.parquet`,
    rowCount,
  };
}

export async function exportSnapshot() {
  const client = await pool.connect();

  // const exportRoot = path.resolve("exports");
  // await mkdir(exportRoot, { recursive: true });

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  // const stagingDir = path.join(exportRoot, `.staging-${timestamp}`);
  // const finalDir = path.join(exportRoot, `export-${timestamp}`);
  const stagingDir = path.resolve(".staging");
  const finalDir = path.resolve("export");
  await mkdir(stagingDir, { recursive: true });
  await rm(finalDir, { recursive: true });

  let transactionStarted = false;

  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionStarted = true;

    // This first query establishes the transaction snapshot.
    const snapshot = await client.query(`
      SELECT
        transaction_timestamp() AS snapshot_time,
        pg_current_snapshot()::text AS snapshot_id
    `);

    const tables = {};

    for (const table of TABLES) {
      tables[table.name] = await exportTable(client, table, stagingDir);
    }

    await client.query("COMMIT");
    transactionStarted = false;

    const manifest = {
      format: "parquet",
      version: 1,
      exportedAt: new Date().toISOString(),
      snapshot: {
        timestamp: snapshot.rows[0].snapshot_time,
        id: snapshot.rows[0].snapshot_id,
      },
      tables,
    };

    await writeFile(
      path.join(stagingDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    // Publish the completed export only after all files succeed.
    await rename(stagingDir, finalDir);

    console.log("Export completed:", finalDir);
    return finalDir;
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    await rm(stagingDir, {
      recursive: true,
      force: true,
    });

    throw error;
  } finally {
    client.release();
  }
}
