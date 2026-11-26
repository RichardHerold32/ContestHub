import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";

const endpoint = "https://codeforces.com/api/contest.list";
const requestIntervalMs = 2_000;
const envelope = z.discriminatedUnion("status", [
  z.object({ status: z.literal("OK"), result: z.array(z.unknown()) }),
  z.object({ status: z.literal("FAILED") }),
]);
const upcomingContest = z.object({
  phase: z.literal("BEFORE"),
  id: z.int().positive(),
  name: z.string().trim().min(1),
  startTimeSeconds: z.int().positive(),
  durationSeconds: z.int().positive(),
});

// Only these controlled messages may reach CLI logs.
export class SyncError extends Error {}

export async function fetchContestList(fetcher: typeof fetch = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(endpoint, { signal: controller.signal, redirect: "manual" });
    if (!response.ok) {
      controller.abort();
      throw new SyncError(`Codeforces returned HTTP ${response.status}.`);
    }
    const parsed = envelope.safeParse(await response.json());
    if (!parsed.success) throw new SyncError("Invalid Codeforces response shape.");
    if (parsed.data.status === "FAILED") throw new SyncError("Codeforces reported FAILED.");
    return parsed.data.result;
  } catch (error) {
    if (error instanceof SyncError) throw error;
    if (controller.signal.aborted) throw new SyncError("Codeforces timed out after 10 seconds.");
    if (error instanceof SyntaxError) throw new SyncError("Invalid JSON from Codeforces.");
    throw new SyncError("Could not read the Codeforces response.");
  } finally {
    clearTimeout(timer);
  }
}

function normalise(row: unknown, now: number) {
  const result = upcomingContest.safeParse(row);
  if (!result.success) return;
  const { id, name, startTimeSeconds, durationSeconds } = result.data;
  const startsAt = new Date(startTimeSeconds * 1000);
  const endsAt = new Date((startTimeSeconds + durationSeconds) * 1000);
  if (!(startsAt.getTime() > now) || !Number.isFinite(endsAt.getTime())) return;

  return { externalId: String(id), title: name, startsAt, endsAt, sourceUrl: `https://codeforces.com/contest/${id}` };
}

export async function syncCodeforces(db: PrismaClient, fetcher: typeof fetch = fetch) {
  return db.$transaction(async (tx) => {
    // The two integer keys identify this job within the database. Commit or rollback releases the lock.
    const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(1128813890, 1) AS acquired
    `;
    if (!lock.acquired) throw new SyncError("A Codeforces sync is already running.");

    const requestedAt = performance.now();
    let rows: unknown[];
    try {
      rows = await fetchContestList(fetcher);
    } finally {
      const remaining = Math.ceil(requestIntervalMs - (performance.now() - requestedAt));
      if (remaining > 0) await delay(remaining);
    }

    const now = Date.now();
    const contests = new Map<string, NonNullable<ReturnType<typeof normalise>>>();
    for (const row of rows) {
      const contest = normalise(row, now);
      if (contest && !contests.has(contest.externalId)) contests.set(contest.externalId, contest);
    }

    const existing = await tx.contest.findMany({
      where: { source: "CODEFORCES", externalId: { in: [...contests.keys()] } },
      select: { externalId: true, title: true, startsAt: true, endsAt: true, sourceUrl: true },
    });
    const byId = new Map(existing.map((contest) => [contest.externalId, contest]));
    const summary = { added: 0, updated: 0, skipped: rows.length - contests.size };
    for (const { externalId, ...fields } of contests.values()) {
      const previous = byId.get(externalId);
      if (previous && previous.title === fields.title && previous.sourceUrl === fields.sourceUrl &&
          previous.startsAt.getTime() === fields.startsAt.getTime() &&
          previous.endsAt?.getTime() === fields.endsAt.getTime()) {
        summary.skipped++;
        continue;
      }
      const identity = { source: "CODEFORCES", externalId } as const;
      await tx.contest.upsert({
        where: { source_externalId: identity },
        create: { ...identity, ...fields },
        update: fields,
      });
      if (previous) summary.updated++;
      else summary.added++;
    }
    return summary;
  }, { timeout: 30_000 });
}
