import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { SyncError, syncCodeforces } from "./codeforces.js";

type JobOptions = {
  fetcher?: typeof fetch;
  openDatabase?: () => Promise<PrismaClient>;
  closeDatabase?: (db: PrismaClient) => Promise<void>;
  writeLine?: (line: string) => void;
};

export async function runCodeforcesJob({
  fetcher = fetch,
  openDatabase = async () => (await import("../lib/prisma.js")).prisma,
  closeDatabase = (db) => db.$disconnect(),
  writeLine = console.log,
}: JobOptions = {}) {
  const runId = randomUUID();
  const startedAt = performance.now();
  writeLine(JSON.stringify({ event: "codeforces.sync.start", runId, timestamp: new Date().toISOString() }));

  let database: PrismaClient | undefined;
  let status: "success" | "skipped" | "failed" = "success";
  let errorCode: string | undefined;
  let httpStatus: number | undefined;
  let fetched: number | null = null;
  let created = 0;
  let updated = 0;
  let skipped: number | null = null;

  try {
    database = await openDatabase();
    const result = await syncCodeforces(database, fetcher, (count) => { fetched = count; });
    // Only count writes once the transaction has committed.
    created = result.added;
    updated = result.updated;
    skipped = result.skipped;
  } catch (error) {
    errorCode = error instanceof SyncError ? error.code : "DATABASE_ERROR";
    httpStatus = error instanceof SyncError ? error.httpStatus : undefined;
    status = errorCode === "OVERLAPPING_RUN" ? "skipped" : "failed";
  } finally {
    if (database) {
      try {
        await closeDatabase(database);
      } catch {
        if (status !== "failed") {
          status = "failed";
          errorCode = "DATABASE_DISCONNECT_ERROR";
        }
      }
    }
    writeLine(JSON.stringify({
      event: "codeforces.sync.end", runId, timestamp: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAt),
      status, fetched, created, updated, skipped, errorCode, httpStatus,
    }));
  }

  return status === "failed" ? 1 : 0;
}
