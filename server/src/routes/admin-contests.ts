import { Router } from "express";
import { HttpError } from "../lib/http-error.js";
import { requireAdmin, requireOrigin, requireSession } from "../middleware/auth.js";
import { createManualContest, listManualContests, updateManualContest } from "../services/admin-contests.js";
import { createContestBody, updateContestBody } from "../validation/admin-contests.js";
import { parseContestId } from "../validation/contests.js";

export const adminContestRouter = Router();
adminContestRouter.use(requireSession, requireAdmin);

adminContestRouter.get("/", async (_req, res) => {
  res.json({ items: await listManualContests() });
});

adminContestRouter.post("/", requireOrigin, async (req, res) => {
  const body = createContestBody.safeParse(req.body);
  if (!body.success) throw invalidContest(body.error.issues[0]);
  res.status(201).json(await createManualContest(body.data));
});

adminContestRouter.patch("/:id", requireOrigin, async (req, res) => {
  const id = parseContestId(req.params.id);
  const body = updateContestBody.safeParse(req.body);
  if (!body.success) throw invalidContest(body.error.issues[0]);
  res.json(await updateManualContest(id, body.data));
});

function invalidContest(issue: { path: PropertyKey[]; message: string }) {
  const field = issue.path[0];
  return new HttpError(400, typeof field === "string" ? field + ": " + issue.message : issue.message);
}
