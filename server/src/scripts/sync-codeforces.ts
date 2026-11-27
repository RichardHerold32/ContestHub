import { runCodeforcesJob } from "../services/codeforces-job.js";

process.exitCode = await runCodeforcesJob();
