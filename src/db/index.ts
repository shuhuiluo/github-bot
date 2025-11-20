import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const defaultConnection = "postgresql://localhost:5432/github-bot";
const connectionString = process.env.DATABASE_URL ?? defaultConnection;

if (!process.env.DATABASE_URL) {
  console.warn(
    `[db] DATABASE_URL not set. Falling back to local ${defaultConnection}`
  );
}

const sslRequired =
  process.env.DATABASE_SSL === "true" ||
  process.env.RENDER === "true" ||
  process.env.NODE_ENV === "production";

const disableSSLValidation =
  process.env.DEV_DISABLE_SSL_VALIDATION === "true" &&
  process.env.NODE_ENV !== "production";

const caFilePath = process.env.DATABASE_CA_CERT_PATH;
let sslConfig:
  | boolean
  | { ca?: string; rejectUnauthorized?: boolean }
  | undefined;

if (sslRequired) {
  if (disableSSLValidation) {
    console.warn(
      "[db] DEV_DISABLE_SSL_VALIDATION is enabled. TLS certificate verification is disabled—do not use in production."
    );
    sslConfig = { rejectUnauthorized: false };
  } else if (caFilePath) {
    const ca = readFileSync(resolve(caFilePath), "utf8");
    sslConfig = { ca, rejectUnauthorized: true };
  } else {
    // Default: enable TLS with standard Node trust store (rejectUnauthorized true)
    sslConfig = true;
  }
}

const maxConnections = Number.parseInt(
  process.env.DATABASE_POOL_SIZE ?? "",
  10
);

const client = postgres(connectionString, {
  ssl: sslConfig,
  max: Number.isFinite(maxConnections) ? maxConnections : undefined,
});

export const db = drizzle(client);

const migrationsFolder = process.env.DRIZZLE_MIGRATIONS_PATH
  ? resolve(process.cwd(), process.env.DRIZZLE_MIGRATIONS_PATH)
  : resolve(process.cwd(), "drizzle");

/**
 * Automatically run database migrations on startup so we don't rely on manual CLI steps.
 * Exported promise allows callers to await readiness.
 */
export const dbReady = migrate(db, {
  migrationsFolder,
}).catch(error => {
  console.error("Failed to run database migrations", error);
  throw error;
});
