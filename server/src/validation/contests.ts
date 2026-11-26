import { z } from "zod";
import { HttpError } from "../lib/http-error.js";
import { ContestSource } from "../generated/prisma/enums.js";

const decimal = z.string().regex(/^[0-9]+$/).transform(Number);
const text = z.string().trim().refine((value) => !value.includes("\0"));

const listQuery = z.object({
  page: decimal.pipe(z.int().min(1)).default(1),
  limit: decimal.pipe(z.int().min(1).max(50)).default(12),
  search: text.optional(),
  category: text.pipe(z.string().min(1)).optional(),
  source: z.enum(ContestSource).optional(),
  upcoming: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  sort: z.enum(["start-asc", "start-desc"]).optional(),
});

export const contestId = z.string().min(1).refine((value) => !value.includes("\0"));

export type ContestListQuery = z.output<typeof listQuery>;

export function parseContestListQuery(query: unknown): ContestListQuery {
  const parsed = listQuery.safeParse(query);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path[0]).join(", ");
    throw new HttpError(400, fields ? "Invalid contest query parameters: " + fields + "." : "Invalid contest query.");
  }

  return parsed.data;
}

export function parseContestId(id: unknown): string {
  const parsed = contestId.safeParse(id);
  if (!parsed.success) {
    throw new HttpError(404, "Contest not found.");
  }

  return parsed.data;
}
