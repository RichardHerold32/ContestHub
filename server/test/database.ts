import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";

export function useTestDatabase() {
  const dbName = "contesthub_test_" + randomUUID().replaceAll("-", "");
  let maintenance: Client | undefined;
  let databaseCreated = false;
  let prisma: PrismaClient | undefined;

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Set DATABASE_URL to your local PostgreSQL development database.");

    const url = new URL(connectionString);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error("Integration tests require local PostgreSQL.");
    }

    url.pathname = "/postgres";
    url.searchParams.delete("schema");
    maintenance = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5_000 });
    await maintenance.connect();
    // Only an internally generated name is used as a SQL identifier.
    await maintenance.query('CREATE DATABASE "' + dbName + '"');
    databaseCreated = true;

    url.pathname = "/" + dbName;
    url.searchParams.set("schema", "public");
    vi.stubEnv("DATABASE_URL", url.toString());
    const require = createRequire(import.meta.url);
    const cli = resolve(dirname(require.resolve("prisma/package.json")), "build/index.js");
    execFileSync(process.execPath, [cli, "migrate", "deploy"], { stdio: "pipe", timeout: 30_000 });
    ({ prisma } = await import("../src/lib/prisma.js"));
  }, 45_000);

  afterAll(async () => {
    try {
      await prisma?.$disconnect();
      if (databaseCreated) await maintenance?.query('DROP DATABASE "' + dbName + '"');
    } finally {
      await maintenance?.end();
      vi.unstubAllEnvs();
    }
  });

  return () => {
    if (!prisma) throw new Error("The disposable test database was not initialized.");
    return prisma;
  };
}
