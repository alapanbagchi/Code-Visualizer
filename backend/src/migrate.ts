import path from "path";
import db from "./common/db";
import * as fs from "fs/promises";

const MIGRATIONS_DIR = path.join(__dirname, "../migrations");
const MIGRATION_TABLE = "_migrations"; // Table to track applied migrations
const ensureMigrationTableExists = async () => {
  await db.query(`
        CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    `);
  console.log(`Migration table '${MIGRATION_TABLE}' ensured.`);
};

const getAppliedMigrations = async (): Promise<Set<string>> => {
  const res = await db.query(`SELECT name FROM ${MIGRATION_TABLE};`);
  return new Set(res.rows.map((row) => row.name));
};
const applyMigration = async (migrationName: string, sqlContent: string) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(sqlContent);
    await client.query(`INSERT INTO ${MIGRATION_TABLE} (name) VALUES ($1)`, [
      migrationName,
    ]);
    await client.query("COMMIT");
    console.log(`Migration '${migrationName}' applied successfully.`);
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error(
      `Error applying migration '${migrationName}': ${err.message}`
    );
  } finally {
    client.release();
  }
};

const migrate = async () => {
  console.log("Starting database migrations...");
  try {
    await ensureMigrationTableExists();
    const appliedMigrations = await getAppliedMigrations();

    const migrationFiles = await fs.readdir(MIGRATIONS_DIR);
    const sortedMigrationFiles = migrationFiles.sort(); // Ensure migrations run in order

    for (const file of sortedMigrationFiles) {
      if (file.endsWith(".sql")) {
        const migrationName = file;
        if (!appliedMigrations.has(migrationName)) {
          const sqlContent = await fs.readFile(
            path.join(MIGRATIONS_DIR, file),
            "utf8"
          );
          await applyMigration(migrationName, sqlContent);
        } else {
          console.log(
            `Migration '${migrationName}' already applied. Skipping.`
          );
        }
      }
    }
    console.log("Database migration complete.");
  } catch (error: any) {
    console.error("Failed to migrate database:", error.message);
    process.exit(1);
  } finally {
    await db.end();
  }
};
