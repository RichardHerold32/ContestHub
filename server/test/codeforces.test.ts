import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { runCodeforcesJob } from "../src/services/codeforces-job.js";
import { fetchContestList, syncCodeforces } from "../src/services/codeforces.js";
import { useTestDatabase } from "./database.js";

function feed(...rows: unknown[]) {
  return vi.fn<typeof fetch>(async () => Response.json({ status: "OK", result: rows }));
}

function runJob(prisma: PrismaClient, fetcher: typeof fetch) {
  const lines: string[] = [];
  const done = runCodeforcesJob({
    openDatabase: async () => prisma,
    closeDatabase: async () => { /* the test fixture owns this connection */ },
    fetcher,
    writeLine: (line) => lines.push(line),
  });
  return { lines, done };
}

function jobResult(lines: string[]) {
  expect(lines).toHaveLength(2);
  const [start, end] = lines.map((line) => JSON.parse(line));
  expect(start).toMatchObject({ event: "codeforces.sync.start", runId: expect.any(String) });
  expect(end).toMatchObject({
    event: "codeforces.sync.end", runId: start.runId, durationMs: expect.any(Number),
  });
  expect(end.durationMs).toBeGreaterThanOrEqual(0);
  expect(start.timestamp).toBe(new Date(start.timestamp).toISOString());
  expect(end.timestamp).toBe(new Date(end.timestamp).toISOString());
  return end;
}

describe("Codeforces response handling", () => {
  it.each([
    [() => new Response("private upstream detail", { status: 503 }), "Codeforces returned HTTP 503."],
    [() => new Response("private invalid JSON"), "Invalid JSON from Codeforces."],
    [() => Response.json({ status: "FAILED", comment: "private detail" }), "Codeforces reported FAILED."],
    [() => Response.json({ status: "OK", result: {} }), "Invalid Codeforces response shape."],
    [() => { throw new Error("private network detail"); }, "Could not read the Codeforces response."],
  ] as const)("reports a controlled error (%s)", async (response, message) => {
    await expect(fetchContestList(async () => response())).rejects.toHaveProperty("message", message);
  });

  it.each(["headers", "body"])("aborts after ten seconds while waiting for %s", async (stage) => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
        const signal = init!.signal!;
        if (stage === "headers") {
          return new Promise<Response>((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason)));
        }
        return new Response(new ReadableStream({
          start(controller) {
            signal.addEventListener("abort", () => controller.error(signal.reason));
          },
        }));
      });
      const check = expect(fetchContestList(fetcher)).rejects.toThrow("timed out after 10 seconds");
      await vi.advanceTimersByTimeAsync(9_999);
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await check;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Codeforces ingestion into PostgreSQL", () => {
  const db = useTestDatabase();
  const contest = {
    id: 77, name: "Example round", phase: "BEFORE",
    startTimeSeconds: Math.floor(Date.now() / 1000) + 86_400, durationSeconds: 7200,
  };

  it("imports once, skips invalid or unchanged rows and updates a rescheduled round in place", async () => {
    const prisma = db();
    const fetcher = feed(
      { ...contest, startTimeSeconds: undefined }, contest, contest,
      { ...contest, id: 78, phase: "FINISHED" }, { ...contest, id: 79, startTimeSeconds: 1 },
      { ...contest, id: 80, startTimeSeconds: Number.MAX_SAFE_INTEGER },
    );
    const manual = await prisma.contest.create({
      data: { source: "MANUAL", externalId: "77", title: "Manual event", startsAt: new Date(), sourceUrl: "https://example.org" },
    });
    expect(await syncCodeforces(prisma, fetcher)).toEqual({ added: 1, updated: 0, skipped: 5 });
    expect(fetcher).toHaveBeenCalledWith("https://codeforces.com/api/contest.list", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const lookup = { source_externalId: { source: "CODEFORCES", externalId: "77" } } as const;
    const inserted = await prisma.contest.findUniqueOrThrow({ where: lookup });
    expect(inserted).toMatchObject({
      title: contest.name, isPublished: true, category: "CODING", sourceUrl: "https://codeforces.com/contest/77",
      startsAt: new Date(contest.startTimeSeconds * 1000),
      endsAt: new Date((contest.startTimeSeconds + contest.durationSeconds) * 1000),
    });
    expect(await syncCodeforces(prisma, fetcher)).toEqual({ added: 0, updated: 0, skipped: 6 });
    expect(await prisma.contest.findUnique({ where: lookup })).toEqual(inserted);

    const user = await prisma.user.create({ data: { name: "Reader", email: "reader@example.org", passwordHash: "fixture" } });
    await prisma.bookmark.create({ data: { userId: user.id, contestId: inserted.id } });
    await prisma.contest.update({
      where: lookup, data: { isPublished: false, description: "Local notes", category: "PRACTICE" },
    });
    const laterStart = contest.startTimeSeconds + 3600;
    expect(await syncCodeforces(prisma, feed({ ...contest, startTimeSeconds: laterStart })))
      .toEqual({ added: 0, updated: 1, skipped: 0 });
    expect(await prisma.contest.findUnique({ where: lookup, include: { bookmarks: true } })).toMatchObject({
      id: inserted.id, startsAt: new Date(laterStart * 1000), endsAt: new Date((laterStart + 7200) * 1000),
      isPublished: false, description: "Local notes", category: "PRACTICE", bookmarks: [{ userId: user.id }],
    });
    expect(await prisma.contest.count({ where: { source: "CODEFORCES" } })).toBe(1);
    expect(await prisma.contest.findUnique({ where: { id: manual.id } })).toEqual(manual);
  }, 20_000);

  it("preserves stored rows on upstream failure and when absent from a successful feed", async () => {
    const prisma = db();
    const existing = await prisma.contest.create({
      data: { source: "CODEFORCES", externalId: "91", title: "Stored round", startsAt: new Date(), sourceUrl: "https://codeforces.com/contest/91" },
    });
    await expect(syncCodeforces(prisma, async () => Response.json({ status: "FAILED" }))).rejects.toThrow("reported FAILED");
    expect(await syncCodeforces(prisma, feed())).toEqual({ added: 0, updated: 0, skipped: 0 });
    expect(await prisma.contest.findUnique({ where: { id: existing.id } })).toEqual(existing);
  }, 12_000);

  it("allows only one request during the rate-limit interval, including after an upstream error", async () => {
    const prisma = db();
    const started = Promise.withResolvers<void>();
    const fetcher = vi.fn<typeof fetch>(async () => {
      started.resolve();
      return new Response(null, { status: 429 });
    });
    const first = expect(syncCodeforces(prisma, fetcher)).rejects.toThrow("HTTP 429");
    await started.promise;
    const startedAt = performance.now();
    await expect(syncCodeforces(prisma, fetcher)).rejects.toThrow("already running");
    await first;
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(1_990);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }, 8_000);

  it("logs an overlapping trigger as skipped and reports committed counts on replay", async () => {
    const prisma = db();
    const row = { ...contest, id: 181, name: "Scheduled round" };
    const entered = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    const sharedFetcher = feed(row).mockImplementationOnce(() => {
      entered.resolve();
      return response.promise;
    });
    const first = runJob(prisma, sharedFetcher);
    await entered.promise;
    const second = runJob(prisma, sharedFetcher);
    const secondExit = await second.done;
    response.resolve(Response.json({ status: "OK", result: [row, row] }));

    expect(secondExit).toBe(0);
    expect(jobResult(second.lines)).toMatchObject({
      status: "skipped", errorCode: "OVERLAPPING_RUN", fetched: null, created: 0, updated: 0, skipped: null,
    });
    expect(await first.done).toBe(0);
    const firstEnd = jobResult(first.lines);
    expect(firstEnd).toMatchObject({ status: "success", fetched: 2, created: 1, updated: 0, skipped: 1 });
    expect(firstEnd.runId).not.toBe(jobResult(second.lines).runId);
    expect(sharedFetcher).toHaveBeenCalledTimes(1);

    const replay = runJob(prisma, feed(row));
    expect(await replay.done).toBe(0);
    expect(jobResult(replay.lines)).toMatchObject({ status: "success", fetched: 1, created: 0, updated: 0, skipped: 1 });
    expect(await prisma.contest.count({ where: { source: "CODEFORCES", externalId: "181" } })).toBe(1);
  }, 15_000);

  it("logs the upstream timeout while the public API continues to serve stored contests", async () => {
    const prisma = db();
    const saved = await prisma.contest.create({
      data: {
        source: "CODEFORCES", externalId: "182", title: "Last good sync round",
        startsAt: new Date(contest.startTimeSeconds * 1000), sourceUrl: "https://codeforces.com/contest/182",
      },
    });
    const entered = Promise.withResolvers<void>();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      entered.resolve();
      const signal = init!.signal!;
      return new Promise<Response>((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("Private upstream details")), { once: true });
      });
    });
    const job = runJob(prisma, fetcher);
    const readCatalogue = async () => {
      const { body } = await request(app).get("/api/contests").query({ search: saved.title }).expect(200);
      expect(body.items).toEqual([expect.objectContaining({ id: saved.id, title: saved.title })]);
    };
    await entered.promise;
    await readCatalogue();
    expect(await job.done).toBe(1);
    expect(jobResult(job.lines)).toMatchObject({
      status: "failed", errorCode: "UPSTREAM_TIMEOUT", fetched: null, created: 0, updated: 0, skipped: null,
    });
    expect(job.lines.join("\n")).not.toContain("Private upstream details");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await readCatalogue();
  }, 20_000);

  it("reports fetched rows and zero committed writes when the import rolls back", async () => {
    const prisma = db();
    await prisma.$executeRaw`ALTER TABLE "Contest" ADD CONSTRAINT "reject_sync_fixture"
      CHECK ("title" <> 'Rejected sync fixture')`;
    try {
      const job = runJob(prisma, feed(
        { ...contest, id: 183, name: "Valid sync fixture" },
        { ...contest, id: 184, name: "Rejected sync fixture" },
      ));
      expect(await job.done).toBe(1);
      expect(jobResult(job.lines)).toMatchObject({
        status: "failed", errorCode: "DATABASE_ERROR", fetched: 2, created: 0, updated: 0, skipped: null,
      });
      expect(job.lines.join("\n")).not.toContain("reject_sync_fixture");
      expect(await prisma.contest.count({ where: { externalId: { in: ["183", "184"] } } })).toBe(0);
    } finally {
      await prisma.$executeRaw`ALTER TABLE "Contest" DROP CONSTRAINT "reject_sync_fixture"`;
    }
  }, 12_000);
});
