import { z } from "zod";

const text = z.string().trim().refine((value) => !value.includes("\0"), "Remove null characters.");
const date = z.iso.datetime({ offset: true, error: "Use an ISO timestamp with a time zone." })
  .transform((value) => new Date(value))
  .refine((value) => Number.isFinite(value.getTime()), "Use a valid date.");
const organiserUrl = text.pipe(z.string().max(2048)).refine((value) => {
  if (!/^https?:\/\/[^/\\\s]/i.test(value) || /[\\\s]/.test(value) || !URL.canParse(value)) return false;
  const url = new URL(value);
  return !url.username && !url.password;
}, "Use an absolute HTTP or HTTPS URL without credentials.");

const fields = {
  title: text.pipe(z.string().min(1).max(200)),
  category: text.pipe(z.string().min(1).max(60)),
  description: text.pipe(z.string().max(5000)).nullable(),
  startsAt: date,
  endsAt: date.nullable(),
  sourceUrl: organiserUrl,
  isPublished: z.boolean(),
};

export const createContestBody = z.strictObject({
  ...fields,
  category: fields.category.default("CODING"),
  description: fields.description.default(null),
  endsAt: fields.endsAt.default(null),
  isPublished: fields.isPublished.default(false),
});
export const updateContestBody = z.strictObject(fields).partial()
  .refine((patch) => Object.keys(patch).length > 0, "Provide at least one contest field.");

export type NewManualContest = z.output<typeof createContestBody>;
export type ManualContestPatch = z.output<typeof updateContestBody>;
