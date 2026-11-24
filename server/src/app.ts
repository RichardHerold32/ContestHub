import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";

export const app = express();

app.use(helmet());
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use((_request, response) => {
  response.status(404).json({ error: { message: "Route not found." } });
});

const handleError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
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
