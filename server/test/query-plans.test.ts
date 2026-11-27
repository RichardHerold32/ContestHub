import { describe, expect, it } from "vitest";
import { Prisma } from "../src/generated/prisma/client.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { useTestDatabase } from "./database.js";

const referenceTime = "2026-12-01 12:00:00";
const contestColumns = Prisma.sql`
  c."id", c."title", c."description", c."category", c."source", c."startsAt", c."endsAt", c."sourceUrl"
`;
const upcoming = Prisma.sql`c."isPublished" = TRUE AND c."startsAt" > CAST(${referenceTime} AS timestamp)`;

async function seedLab(prisma: PrismaClient) {
  await prisma.$executeRaw`
    INSERT INTO "Contest" (
      "id", "source", "externalId", "title", "category", "startsAt", "endsAt", "sourceUrl", "isPublished", "updatedAt"
    )
    SELECT
      'lab-contest-' || n,
      (CASE WHEN n % 4 = 0 THEN 'MANUAL' ELSE 'CODEFORCES' END)::"ContestSource",
      n::text,
      'Round ' || n || CASE WHEN n % 43 = 0 THEN ' Dynamic Programming' ELSE '' END,
      CASE WHEN n % 29 = 0 THEN 'ALGORITHMS' WHEN n % 3 = 0 THEN 'PRACTICE' ELSE 'CODING' END,
      starts_at,
      starts_at + INTERVAL '2 hours',
      'https://example.invalid/contests/' || n,
      n % 10 <> 0,
      CAST(${referenceTime} AS timestamp)
    FROM generate_series(1, 10000) AS fixture(n)
    CROSS JOIN LATERAL (
      SELECT CAST(${referenceTime} AS timestamp) + ((n - 5001) / 4) * INTERVAL '2 hours' AS starts_at
    ) AS schedule
  `;

  await prisma.$executeRaw`
    INSERT INTO "User" ("id", "name", "email", "passwordHash")
    VALUES
      ('lab-reader', 'Lab Reader', 'reader@example.invalid', 'fixture'),
      ('lab-other', 'Lab Other', 'other@example.invalid', 'fixture')
  `;

  await prisma.$executeRaw`
    INSERT INTO "Bookmark" ("userId", "contestId", "createdAt")
    SELECT 'lab-reader', 'lab-contest-' || n, CAST(${referenceTime} AS timestamp) - n * INTERVAL '1 minute'
    FROM generate_series(2, 50, 2) AS fixture(n)
    UNION ALL
    SELECT 'lab-other', 'lab-contest-' || n, CAST(${referenceTime} AS timestamp) - n * INTERVAL '1 minute'
    FROM generate_series(1, 1001, 2) AS fixture(n)
  `;
  await prisma.$executeRaw`ANALYZE "Contest", "Bookmark"`;
}

const upcomingPage = (offset: number) => Prisma.sql`
  SELECT ${contestColumns} FROM "Contest" AS c
  WHERE ${upcoming}
  ORDER BY c."startsAt" ASC, c."id" ASC
  LIMIT 12 OFFSET ${offset}
`;

const titleMatch = Prisma.sql`${upcoming} AND c."title" ILIKE ${"%dynamic programming%"}`;
const examples = [
  { name: "Upcoming first page (offset 0)", sql: upcomingPage(0) },
  { name: "Upcoming deep page (offset 3600)", sql: upcomingPage(3600) },
  {
    name: "Selective category and start time",
    sql: Prisma.sql`
      SELECT ${contestColumns} FROM "Contest" AS c
      WHERE ${upcoming}
        AND c."category" = ${"ALGORITHMS"}
        AND c."startsAt" < CAST(${referenceTime} AS timestamp) + INTERVAL '14 days'
      ORDER BY c."startsAt" ASC, c."id" ASC
      LIMIT 12
    `,
  },
  {
    name: "Case-insensitive substring page",
    sql: Prisma.sql`
      SELECT ${contestColumns} FROM "Contest" AS c
      WHERE ${titleMatch}
      ORDER BY c."startsAt" ASC, c."id" ASC
      LIMIT 12
    `,
  },
  {
    name: "Case-insensitive substring count",
    sql: Prisma.sql`SELECT COUNT(*) FROM "Contest" AS c WHERE ${titleMatch}`,
  },
  {
    name: "Scoped bookmark join",
    sql: Prisma.sql`
      SELECT b."createdAt", ${contestColumns}
      FROM "Bookmark" AS b
      JOIN "Contest" AS c ON c."id" = b."contestId"
      WHERE b."userId" = ${"lab-reader"} AND c."isPublished" = TRUE
      ORDER BY b."createdAt" DESC, b."contestId" ASC
    `,
  },
];

describe.skipIf(process.env.CONTESTHUB_QUERY_LAB !== "1")("PostgreSQL query plans", () => {
  const database = useTestDatabase();

  it("prints plans on a migrated, disposable catalogue", async () => {
    const prisma = database();
    await seedLab(prisma);

    for (const { name, sql } of examples) {
      // Every SQL fragment above is fixed. Interpolated filter values are bound parameters.
      const rows = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`EXPLAIN (ANALYZE, BUFFERS) ${sql}`;
      expect(rows.length).toBeGreaterThan(0);
      console.log([name, ...rows.map((row) => row["QUERY PLAN"])].join("\n"));
    }
  }, 30_000);
});
