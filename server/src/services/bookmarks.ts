import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../lib/http-error.js";
import { publicContestFields, toPublicContest } from "./contests.js";

export async function listBookmarks(userId: string) {
  const { prisma } = await import("../lib/prisma.js");
  const rows = await prisma.bookmark.findMany({
    where: { userId, contest: { isPublished: true } },
    orderBy: [{ createdAt: "desc" }, { contestId: "asc" }],
    select: { createdAt: true, contest: { select: publicContestFields } },
  });
  const now = new Date();
  return rows.map(({ createdAt, contest }) => ({
    savedAt: createdAt.toISOString(),
    contest: toPublicContest(contest, now),
  }));
}

export async function saveBookmark(userId: string, contestId: string) {
  const { prisma } = await import("../lib/prisma.js");
  async function publishedContest() {
    return prisma.contest.findUnique({
      where: { id: contestId, isPublished: true },
      select: { id: true },
    });
  }

  if (!await publishedContest()) throw new HttpError(404, "Contest not found.");
  try {
    await prisma.bookmark.createMany({ data: [{ userId, contestId }], skipDuplicates: true });
  } catch (error) {
    // A contest can be deleted between the publication check and the insert.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003" && !await publishedContest()) {
      throw new HttpError(404, "Contest not found.");
    }
    throw error;
  }
}

export async function removeBookmark(userId: string, contestId: string) {
  const { prisma } = await import("../lib/prisma.js");
  await prisma.bookmark.deleteMany({ where: { userId, contestId } });
}
