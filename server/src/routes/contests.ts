import { Router } from "express";
import { HttpError } from "../lib/http-error.js";
import { findContest, listContests } from "../services/contests.js";
import { parseContestId, parseContestListQuery } from "../validation/contests.js";

export const contestRouter = Router();

contestRouter.get("/", async (request, response) => {
  const query = parseContestListQuery(request.query);
  response.json(await listContests(query));
});

contestRouter.get("/:id", async (request, response) => {
  const contest = await findContest(parseContestId(request.params.id));
  if (!contest) {
    throw new HttpError(404, "Contest not found.");
  }

  response.json(contest);
});
