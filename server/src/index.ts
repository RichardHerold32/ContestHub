import { app } from "./app.js";

const host = "127.0.0.1";
const port = 4000;

app.listen(port, host, (error) => {
  if (error) {
    console.error("Failed to start the Express server:", error.message);
    process.exitCode = 1;
    return;
  }

  console.log(`Express listening at http://${host}:${port}`);
});
