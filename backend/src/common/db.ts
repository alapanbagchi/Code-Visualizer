import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();

console.log("DATABASE_URL from .env:", process.env.POSTGRES_URL);

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

pool.on("connect", () => {
  console.log("PostgreSQL client connected successfully");
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
  process.exit(-1);
});

export default pool;
