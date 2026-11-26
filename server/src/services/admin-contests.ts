import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../lib/http-error.js";
import type { ManualContestPatch, NewManualContest } from "../validation/admin-contests.js";
import { publicContestFields } from "./contests.js";

const adminContestFields = { ...publicContestFields, externalId: true, isPublished: true, createdAt: true, updatedAt: true };

function validateSchedule(startsAt: Date, endsAt: Date | null) {
  if (endsAt && endsAt <= startsAt) throw new HttpError(400, "End time must be after start time.");
}

export async function listManualContests() {
  const { prisma } = await import("../lib/prisma.js");
  return prisma.contest.findMany({
    where: { source: "MANUAL" },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: adminContestFields,
  });
}

export async function createManualContest(data: NewManualContest) {
  validateSchedule(data.startsAt, data.endsAt);
  const { prisma } = await import("../lib/prisma.js");
  return prisma.contest.create({
    data: { ...data, source: "MANUAL", externalId: randomUUID() },
    select: adminContestFields,
  });
}

export async function updateManualContest(id: string, patch: ManualContestPatch) {
  const { prisma } = await import("../lib/prisma.js");
  try {
    return await prisma.$transaction(async (tx) => {
      const where = { id, source: "MANUAL" } as const;
      const current = await tx.contest.findUnique({ where, select: { startsAt: true, endsAt: true } });
      if (!current) throw new HttpError(404, "Curated contest not found.");
      if (patch.startsAt !== undefined || patch.endsAt !== undefined) {
        validateSchedule(patch.startsAt ?? current.startsAt, patch.endsAt === undefined ? current.endsAt : patch.endsAt);
      }
      return tx.contest.update({ where, data: patch, select: adminContestFields });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new HttpError(409, "The contest changed while you were editing it. Reload the list and try again.");
    }
    throw error;
  }
}
