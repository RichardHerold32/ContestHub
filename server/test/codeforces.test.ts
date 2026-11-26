import { describe, expect, it, vi } from "vitest";
import { fetchContestList, syncCodeforces } from "../src/services/codeforces.js";
import { useTestDatabase } from "./database.js";

function feed(...rows: unknown[]) {
  return vi.fn<typeof fetch>(async () => Response.json({ status: "OK", result: rows }));
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
});
