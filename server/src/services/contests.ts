import type { Prisma } from "../generated/prisma/client.js";
import type { ContestListQuery } from "../validation/contests.js";

export const publicContestFields = {
  id: true,
  title: true,
  description: true,
  category: true,
  source: true,
  startsAt: true,
  endsAt: true,
  sourceUrl: true,
} satisfies Prisma.ContestSelect;

type PublicContestRow = Prisma.ContestGetPayload<{ select: typeof publicContestFields }>;

function contestStatus({ startsAt, endsAt }: PublicContestRow, now: Date) {
  if (startsAt > now) return "upcoming";
  if (endsAt !== null && endsAt <= now) return "ended";
  return "live";
}

export function toPublicContest(contest: PublicContestRow, now: Date) {
  return {
    ...contest,
    startsAt: contest.startsAt.toISOString(),
    endsAt: contest.endsAt?.toISOString() ?? null,
    status: contestStatus(contest, now),
  };
}

function contestWhere({ category, source, search }: ContestListQuery): Prisma.ContestWhereInput {
  // PostgreSQL LIKE gives these characters special meaning inside a pattern.
  const searchPattern = search?.replace(/[\\%_]/g, "\\$&");
  return {
    isPublished: true,
    category,
    source,
    title: searchPattern ? { contains: searchPattern, mode: "insensitive" } : undefined,
  };
}

export async function listContests(query: ContestListQuery) {
  const now = new Date();
  const { prisma } = await import("../lib/prisma.js");
  const { page, limit, upcoming, sort } = query;
  const where = contestWhere(query);
  const upcomingWhere = { ...where, startsAt: { gt: now } };
  const startedWhere = { ...where, startsAt: { lte: now } };

  const { rows, total, totalPages } = await prisma.$transaction(async (tx) => {
    if (sort) {
      const sortedWhere = upcoming === undefined ? where : upcoming ? upcomingWhere : startedWhere;
      const total = await tx.contest.count({ where: sortedWhere });
      const totalPages = Math.ceil(total / limit);
      const rows = page <= totalPages ? await tx.contest.findMany({
        where: sortedWhere,
        orderBy: [{ startsAt: sort === "start-asc" ? "asc" : "desc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: publicContestFields,
      }) : [];
      return { rows, total, totalPages };
    }

    const upcomingCount = upcoming === false ? 0 : await tx.contest.count({ where: upcomingWhere });
    const startedCount = upcoming === true ? 0 : await tx.contest.count({ where: startedWhere });
    const total = upcomingCount + startedCount;
    const totalPages = Math.ceil(total / limit);
    const rows: PublicContestRow[] = [];

    if (page <= totalPages) {
      const offset = (page - 1) * limit;
      if (offset < upcomingCount) {
        rows.push(...await tx.contest.findMany({
          where: upcomingWhere,
          orderBy: [{ startsAt: "asc" }, { id: "asc" }],
          skip: offset,
          take: Math.min(limit, upcomingCount - offset),
          select: publicContestFields,
        }));
      }

      const startedOffset = Math.max(0, offset - upcomingCount);
      if (rows.length < limit && startedOffset < startedCount) {
        rows.push(...await tx.contest.findMany({
          where: startedWhere,
          orderBy: [{ startsAt: "desc" }, { id: "asc" }],
          skip: startedOffset,
          take: limit - rows.length,
          select: publicContestFields,
        }));
      }
    }

    return { rows, total, totalPages };
  }, { isolationLevel: "RepeatableRead" });

  return {
    items: rows.map((row) => toPublicContest(row, now)),
    pagination: { page, limit, total, totalPages },
  };
}

export async function findContest(id: string) {
  const now = new Date();
  const { prisma } = await import("../lib/prisma.js");
  const contest = await prisma.contest.findUnique({
    where: { id, isPublished: true },
    select: publicContestFields,
  });

  return contest && toPublicContest(contest, now);
}
