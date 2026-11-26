import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { HttpError } from "./lib/http-error.js";
import { contestRouter } from "./routes/contests.js";
import { authRouter } from "./routes/auth.js";
import { bookmarkRouter } from "./routes/bookmarks.js";
import { adminContestRouter } from "./routes/admin-contests.js";

export const app = express();

app.use(helmet());
app.use(cookieParser());
app.use(["/api/auth", "/api/me/bookmarks", "/api/admin/contests"], (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/api/contests", contestRouter);
app.use("/api/auth", authRouter);
app.use("/api/me/bookmarks", bookmarkRouter);
app.use("/api/admin/contests", adminContestRouter);

app.use((_request, response) => {
  response.status(404).json({ error: { message: "Route not found." } });
});

export const handleError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({ error: { message: error.message } });
    return;
  }

  // The parser marks client errors with an HTTP status. Its messages can contain user input.
  if (error instanceof Error && "status" in error) {
    const { status } = error;
    if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status < 500) {
      const message = status === 413 ? "Request body exceeds the 100 KB limit."
        : status === 415 ? "Unsupported request encoding or charset."
        : "Invalid request body.";
      response.status(status).json({ error: { message } });
      return;
    }
  }

  response.status(500).json({ error: { message: "Internal server error." } });
};

app.use(handleError);
