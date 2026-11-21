import { DuckDBInstance } from "@duckdb/node-api";

function sqlString(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}

export async function csvToParquet(csvPath, parquetPath) {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  try {
    const csv = sqlString(csvPath);
    const parquet = sqlString(parquetPath);

    await connection.run(`
      COPY (
        SELECT *
        FROM read_csv_auto(
          ${csv},
          header = true,
          sample_size = -1
        )
      )
      TO ${parquet}
      (
        FORMAT PARQUET,
        COMPRESSION ZSTD,
        ROW_GROUP_SIZE 100000
      )
    `);
  } finally {
    connection.closeSync();
  }
}
