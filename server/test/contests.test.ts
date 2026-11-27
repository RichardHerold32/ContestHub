import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { useTestDatabase } from "./database.js";

const api = request(app);
const database = useTestDatabase();

it("preserves the health endpoint", async () => {
  await api.get("/api/health").expect(200, { status: "ok" });
});

it("returns an empty page on a fresh database", async () => {
  await api.get("/api/contests").expect(200, {
    items: [],
    pagination: { page: 1, limit: 12, total: 0, totalPages: 0 },
  });
});

it.each([
  ["page=0", "page"],
  ["page=-1", "page"],
  ["page=1.5", "page"],
  ["page=99999999999999999", "page"],
  ["page=1&page=2", "page"],
  ["limit=0", "limit"],
  ["limit=51", "limit"],
  ["source=OTHER", "source"],
  ["upcoming=yes", "upcoming"],
  ["sort=title", "sort"],
])("rejects %s with a JSON 400", async (query, field) => {
  await api.get("/api/contests?" + query).expect(400, {
    error: { message: "Invalid contest query parameters: " + field + "." },
  });
});

describe("with seeded contests", () => {
  const now = new Date("2026-12-01T12:00:00.000Z");
  const near = new Date("2026-12-02T12:00:00.000Z");
  const far = new Date("2026-12-03T12:00:00.000Z");
  const yesterday = new Date("2026-11-30T12:00:00.000Z");

  beforeAll(async () => {
    await database().contest.createMany({
      data: ([
        { id: "b", title: "Round 100XY Finals", source: "CODEFORCES", startsAt: near },
        { id: "a", title: "Round 100%_\\ Finals", source: "CODEFORCES", startsAt: near },
        { id: "c", title: "Design Contest", source: "MANUAL", startsAt: far, category: "DESIGN" },
        { id: "d", title: "Live Round", source: "CODEFORCES", startsAt: now },
        { id: "e", title: "Ended Round", source: "MANUAL", startsAt: yesterday, endsAt: now },
        { id: "hidden", title: "Hidden Round", source: "CODEFORCES", startsAt: near, isPublished: false },
      ] as const).map((entry) => ({
        ...entry,
        externalId: entry.id,
        sourceUrl: "https://example.invalid/contests/" + entry.id,
      })),
    });
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });

  afterEach(() => vi.useRealTimers());

  it.each(["missing", "hidden"])("returns the same 404 for detail ID %s", async (id) => {
    await api.get("/api/contests/" + id).expect(404, { error: { message: "Contest not found." } });
  });

  it("sorts tied starts, crosses the group boundary, and omits unpublished rows and totals", async () => {
    const first = await api.get("/api/contests?page=1&limit=2").expect(200);
    const second = await api.get("/api/contests?page=2&limit=2").expect(200);
    const third = await api.get("/api/contests?page=3&limit=2").expect(200);
    expect(first.body.items.map(({ id }: { id: string }) => id)).toEqual(["a", "b"]);
    expect(second.body.items.map(({ id }: { id: string }) => id)).toEqual(["c", "d"]);
    expect(third.body.items.map(({ id }: { id: string }) => id)).toEqual(["e"]);
    expect(second.body.pagination).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3 });
    await api.get("/api/contests?page=500&limit=2").expect(200, {
      items: [], pagination: { page: 500, limit: 2, total: 5, totalPages: 3 },
    });
  });

  it.each([
    ["start-asc", ["e", "d", "a", "b", "c"]],
    ["start-desc", ["c", "a", "b", "d", "e"]],
  ])("applies %s across pages with stable ties", async (sort, expectedIds) => {
    for (const page of [1, 2, 3]) {
      const { body } = await api.get(`/api/contests?sort=${sort}&page=${page}&limit=2`).expect(200);
      expect(body.items.map(({ id }: { id: string }) => id)).toEqual(expectedIds.slice((page - 1) * 2, page * 2));
      expect(body.pagination).toEqual({ page, limit: 2, total: 5, totalPages: 3 });
    }
  });

  it("combines start-date sorting with the catalogue filters", async () => {
    const { body } = await api.get("/api/contests?sort=start-asc&source=MANUAL&upcoming=false").expect(200);
    expect(body.items.map(({ id }: { id: string }) => id)).toEqual(["e"]);
    expect(body.pagination.total).toBe(1);
  });

  it("preserves the combined filter total and tie-break order across pages", async () => {
    const filters = { search: "round", category: "CODING", source: "CODEFORCES", upcoming: "true", limit: 1 };
    const expectedPages = [["a"], ["b"], []];

    for (const [index, expectedIds] of expectedPages.entries()) {
      const page = index + 1;
      const { body } = await api.get("/api/contests").query({ ...filters, page }).expect(200);
      expect(body.items.map(({ id }: { id: string }) => id)).toEqual(expectedIds);
      expect(body.pagination).toEqual({ page, limit: 1, total: 2, totalPages: 2 });
    }
  });

  it.each([
    ["search=round", ["a", "b", "d", "e"]],
    ["search=%20100%25_%5C%20", ["a"]],
    ["category=DESIGN", ["c"]],
    ["source=MANUAL", ["c", "e"]],
    ["upcoming=true", ["a", "b", "c"]],
    ["upcoming=false", ["d", "e"]],
    ["search=ROUND&category=CODING&source=CODEFORCES&upcoming=true", ["a", "b"]],
  ])("filters by %s", async (query, expectedIds) => {
    const { body } = await api.get("/api/contests?" + query).expect(200);
    expect(body.items.map(({ id }: { id: string }) => id)).toEqual(expectedIds);
    expect(body.pagination.total).toBe(expectedIds.length);
  });

  it("serializes UTC dates and status and returns only public fields", async () => {
    await api.get("/api/contests/d").expect(200, {
      id: "d",
      title: "Live Round",
      description: null,
      category: "CODING",
      source: "CODEFORCES",
      startsAt: now.toISOString(),
      endsAt: null,
      sourceUrl: "https://example.invalid/contests/d",
      status: "live",
    });
    const { body } = await api.get("/api/contests").expect(200);
    expect(body.items.map(({ status }: { status: string }) => status)).toEqual([
      "upcoming", "upcoming", "upcoming", "live", "ended",
    ]);
    expect(body.items[4].endsAt).toBe(now.toISOString());
  });
});

it("treats SQL-like search text as literal data and still excludes unpublished matches", async () => {
  const text = "' OR '1'='1' --";
  const startsAt = new Date("2026-12-02T12:00:00.000Z");
  const sharedFields = { source: "MANUAL", startsAt, sourceUrl: "https://example.invalid/contest" } as const;
  await database().contest.createMany({
    data: [
      { ...sharedFields, externalId: "literal-public", title: "SQL notation " + text },
      { ...sharedFields, externalId: "literal-hidden", title: "Hidden SQL notation " + text, isPublished: false },
      { ...sharedFields, externalId: "unrelated", title: "Unrelated contest" },
    ],
  });

  const { body } = await api.get("/api/contests").query({ search: text }).expect(200);
  expect(body.items).toEqual([expect.objectContaining({ title: "SQL notation " + text })]);
  expect(body.pagination.total).toBe(1);
});
