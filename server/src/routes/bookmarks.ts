import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../lib/http-error.js";
import { requireOrigin, requireSession } from "../middleware/auth.js";
import { listBookmarks, removeBookmark, saveBookmark } from "../services/bookmarks.js";
import { contestId } from "../validation/contests.js";

export const bookmarkRouter = Router();
const bookmarkContestId = contestId.refine((value) => value.trim().length > 0);
const bookmarkBody = z.strictObject({ contestId: bookmarkContestId });

bookmarkRouter.use(requireSession);

bookmarkRouter.get("/", async (_req, res) => {
  const userId = res.locals.user!.id;
  res.json({ userId, items: await listBookmarks(userId) });
});

bookmarkRouter.post("/", requireOrigin, async (req, res) => {
  const body = bookmarkBody.safeParse(req.body);
  if (!body.success) throw new HttpError(400, "Provide a valid contestId.");
  await saveBookmark(res.locals.user!.id, body.data.contestId);
  res.sendStatus(204);
});

bookmarkRouter.delete("/:contestId", requireOrigin, async (req, res) => {
  const id = bookmarkContestId.safeParse(req.params.contestId);
  if (!id.success) throw new HttpError(400, "Provide a valid contestId.");
  await removeBookmark(res.locals.user!.id, id.data);
  res.sendStatus(204);
});
