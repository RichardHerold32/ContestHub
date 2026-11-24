# ContestHub
Competition discovery, bookmarking and contest synchronisation platform

## Stage 1 local setup

Use Node.js 24 LTS and npm. The commands below use Windows PowerShell. If you use a portable Node installation, put its directory on the current terminal's `PATH` in each terminal before running npm.

From the repository root, install the locked dependencies:

```powershell
node --version
npm.cmd --version
npm.cmd --prefix server ci
npm.cmd --prefix client ci
```

Start Express in one terminal:

```powershell
Set-Location server
npm.cmd run dev
```

Start Vite in another terminal from the repository root:

```powershell
Set-Location client
npm.cmd run dev
```

Open http://127.0.0.1:5173. The page fetches `/api/health` on Vite's origin. Vite forwards the request to Express on port 4000, and the page displays the result.

## Smoke checks

With both servers running, execute these commands in a third terminal:

```powershell
curl.exe -i http://127.0.0.1:4000/api/health
curl.exe -i http://127.0.0.1:5173/api/health
curl.exe -i http://127.0.0.1:5173/api/missing
'{invalid' | curl.exe -i -H 'Content-Type: application/json' --data-binary '@-' http://127.0.0.1:4000/api/missing
('{"value":"' + ('a' * 102401) + '"}') | curl.exe -i -H 'Content-Type: application/json' --data-binary '@-' http://127.0.0.1:4000/api/missing
```

Expect `200` and `{"status":"ok"}` from both health checks, followed by JSON errors with statuses `404`, `400`, and `413`, respectively. The direct health response should include Helmet headers such as `X-Content-Type-Options: nosniff`.

In the browser, confirm the page reports a connection and DevTools shows a request to `/api/health` on port 5173. Stop Express and refresh to check the error state. Restart Express and click **Retry** to check recovery.

From the repository root, verify both builds and the frontend lint check:

```powershell
npm.cmd --prefix server run typecheck
npm.cmd --prefix server run build
npm.cmd --prefix client run lint
npm.cmd --prefix client run build
```

Stop the Express watcher before starting the compiled server with `npm.cmd --prefix server start`. Run the direct health check again.
