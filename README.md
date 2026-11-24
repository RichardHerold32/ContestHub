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

## Stage 2 · PostgreSQL and Prisma

Use a dedicated PostgreSQL development database named `contesthub`. The database role should own it and be allowed to create a shadow database for `migrate dev`. Prisma uses the shadow database to replay migration history and check for drift. Use a direct PostgreSQL connection string in the ignored `server/.env`.

For the portable PostgreSQL 18 workspace setup, start and stop the existing database from the repository root:

```powershell
$pgCtl = '.\.local-tools\postgresql-18.7\pgsql\bin\pg_ctl.exe'
& $pgCtl -D '.local-tools/contesthub-pgdata' -l '.local-tools/contesthub-postgresql.log' -o '-h 127.0.0.1 -p 5432' -w start
# When finished with the database
& $pgCtl -D '.local-tools/contesthub-pgdata' -m fast -w stop
```

The local `contesthub` database defaults to UTC. If you provision your own instance, set the database timezone to UTC so database-generated timestamps follow the project's convention.

From the repository root, run the following in PowerShell with Node 24 on your path. If `.env` already exists, keep it and verify that it points to your local development database.

```powershell
Set-Location server
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

If you copied the template, edit `DATABASE_URL` in `server/.env` with your local credentials. Then run the following from `server/`:

```powershell
npm.cmd ci
npx.cmd prisma validate
npx.cmd prisma migrate dev
npx.cmd prisma migrate status
npm.cmd run db:check
npx.cmd prisma studio
```

Expect the `init` migration to apply or be reported as already applied. The connectivity check runs `SELECT 1` through the PostgreSQL driver adapter, prints `PostgreSQL connection OK.`, and disconnects. If it fails, check the development server, port, database name, and credentials. Open the URL printed by Prisma Studio and find `User`, `Session`, `Contest`, and `Bookmark`. Press **Ctrl+C** in that terminal to stop Studio.

`prisma7.config.ts` supplies the CLI's datasource URL. `src/lib/prisma.ts` supplies the same URL to `PrismaPg` at runtime and exports one shared client. `npm.cmd run db:generate` regenerates client types from the schema. The server build and typecheck also generate the client, which is excluded from version control. The database check is a separate command, so running the Express health route requires only the HTTP server.

### Keys, relations, and indexes

| Table | Keys and relations | Why the indexes exist |
|---|---|---|
| `User` | `id` is the primary key. `email` is unique. One user can have many sessions and bookmarks. | The primary key and unique email both have indexes. The email index enforces uniqueness and supports lookup by email. |
| `Session` | `id` is the primary key. `tokenHash` is unique. `userId` is a foreign key to `User.id`, so each session belongs to an existing user. | The unique token-hash index supports session lookup. Separate indexes on `userId` and `expiresAt` support finding a user's sessions and scanning for expired sessions. |
| `Contest` | `id` is the primary key. The pair `(source, externalId)` uniquely identifies the same contest on repeated imports. One contest can have many bookmarks. | The unique index supports matching source records. The `startsAt` index supports time ranges across categories. The `(category, startsAt)` index supports a category filter followed by a start-time range or sort. |
| `Bookmark` | `userId` and `contestId` reference `User.id` and `Contest.id`. Together they are the primary key. One row represents one user saving one contest. | The primary-key index prevents duplicate pairs, including concurrent inserts, and can find bookmarks by its leading column, `userId`. |

`User → Bookmark → Contest` is a many-to-many relationship. One user can save many contests, and one contest can be saved by many users. Using both IDs as the bookmark's primary key lets PostgreSQL enforce the exact rule of one save per user per contest. All three foreign keys use cascading deletes. Deleting a user removes that user's sessions and bookmarks. Deleting a contest removes that contest's bookmarks.

### SQL behind the Prisma methods

These are conceptual equivalents. Numbered parameters represent values passed separately to PostgreSQL. Prisma supplies values such as CUIDs and `updatedAt` when it writes rows.

```sql
-- findMany: retrieve a page of published contests
SELECT "id", "title", "startsAt"
FROM "Contest"
WHERE "isPublished" = true
ORDER BY "startsAt", "id"
LIMIT $1 OFFSET $2;

-- create: save one contest for one user
INSERT INTO "Bookmark" ("userId", "contestId")
VALUES ($1, $2)
RETURNING "userId", "contestId", "createdAt";

-- upsert: insert a contest or update the existing row for that source identity
INSERT INTO "Contest" ("id", "source", "externalId", "title", "startsAt", "sourceUrl", "updatedAt")
VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
ON CONFLICT ("source", "externalId")
DO UPDATE SET "title" = EXCLUDED."title", "startsAt" = EXCLUDED."startsAt",
              "updatedAt" = CURRENT_TIMESTAMP;

-- relationship query: get a user's saved contests
SELECT c."id", c."title", c."startsAt"
FROM "Bookmark" AS b
JOIN "Contest" AS c ON c."id" = b."contestId"
WHERE b."userId" = $1;
```

Typed Prisma queries make it easier to work with the schema from TypeScript. The SQL still determines which records match, when constraints reject a write, and which indexes can speed a query.
