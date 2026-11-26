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

Open http://127.0.0.1:5173. The contest catalogue fetches `/api/contests` on Vite's origin. Vite forwards `/api` requests to Express on port 4000.

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

In the browser, confirm DevTools shows a request to `/api/contests` on port 5173. Stage 6 checks below cover the catalogue and its retry behavior.

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

## Stage 3 · Public contest API

- `GET /api/contests` returns JSON with `items` and `pagination` (`page`, `limit`, `total`, `totalPages`). The defaults are page 1 and 12 items per page. The maximum limit is 50.
- `GET /api/contests/:id` returns one published contest. Unknown and unpublished IDs both return HTTP 404 with `{"error":{"message":"Contest not found."}}`.

The list accepts `search` (case-insensitive title substring), `category` (exact match), `source` (`CODEFORCES` or `MANUAL`), and `upcoming` (`true` for future starts, `false` for contests that have started). Omitting `upcoming` includes both groups. Future contests appear in ascending start-time order, then started contests in descending start-time order. Equal start times sort by ID. Invalid parameter values return 400 with the same error envelope as a missing contest.

The list and detail routes return UTC ISO timestamps. A contest is `upcoming` before its start, `ended` at or after its known end time, and `live` otherwise once it has started. A started contest with no end time has `endsAt` set to `null` and remains `live`.

From the repository root, use Node 24 and a running local PostgreSQL instance:

~~~powershell
npm.cmd --prefix server test
npm.cmd --prefix server run build
npm.cmd --prefix server run dev
~~~

The test suite uses the local connection in `server/.env`. Its role needs `CREATEDB` and access to the `postgres` maintenance database. The suite creates a disposable database, applies the migration, verifies the empty list, and seeds its own records. It removes that database after the tests.

With Express running, try these PowerShell requests. A fresh development database returns an empty list until it has published contests.

~~~powershell
curl.exe -i "http://127.0.0.1:4000/api/contests?page=1&limit=2&search=round&upcoming=true"
curl.exe -i "http://127.0.0.1:4000/api/contests?limit=51"
curl.exe -i "http://127.0.0.1:4000/api/contests/missing"
~~~

Expect 200, 400, and 404, respectively. Replace `missing` with a published contest ID to check the detail response.

### How Prisma builds a page

Prisma's `where` is SQL `WHERE`, `orderBy` is `ORDER BY`, `skip` and `take` are `OFFSET` and `LIMIT`, and `count` uses `COUNT(*)`. An upcoming page with a title search is conceptually:

~~~sql
SELECT "id", "title", "description", "category", "source", "startsAt", "endsAt", "sourceUrl"
FROM "Contest"
WHERE "isPublished" = true AND "startsAt" > $1 AND "title" ILIKE $2
ORDER BY "startsAt" ASC, "id" ASC
LIMIT $3 OFFSET $4;

SELECT COUNT(*)
FROM "Contest"
WHERE "isPublished" = true AND "startsAt" > $1 AND "title" ILIKE $2;
~~~

When `upcoming` is omitted, the service counts matching upcoming and started rows, then reads each group's portion of the page in one PostgreSQL snapshot. That keeps the rows and totals consistent within the response. Offset pagination makes page numbers easy to support, but deep offsets can be slower and changes between requests can shift later pages.

## Stage 4 · Authentication

| Request | Result |
|---|---|
| `POST /api/auth/register` | Takes `name`, `email` and a 12–128 character `password`. Returns `201` with the public user. Registration always creates a `USER`. A duplicate email returns `409`. |
| `POST /api/auth/login` | Takes `email` and `password`. Returns `200` with the public user and sets the session cookie. Invalid credentials return `401`. |
| `GET /api/auth/me` | Returns `{ user: { id, name, email, role } }` for a valid session. Missing or expired sessions return `401`. |
| `POST /api/auth/logout` | Revokes the presented session, clears the cookie and returns `204`. Other browser sessions keep working. |

Passwords use salted Argon2id. Login generates a random 32-byte token, stores its SHA-256 digest in `Session` and sends the token in a host-only `HttpOnly` cookie scoped to `/api`. The database and cookie share a fixed seven-day expiry. For each protected request, `requireSession` hashes the presented token and finds its unexpired session and current user. The admin guard checks that user's role and returns `403` for a signed-in `USER`.

Database sessions take a lookup per protected request and support immediate revocation. A signed, stateless JWT can be verified locally, but a previously issued JWT generally stays usable until expiry unless the server also tracks revocation. `HttpOnly` prevents JavaScript from reading the cookie. Browsers still attach it to requests, so auth writes also require a trusted origin. The server accepts the `Referer` origin when `Origin` is absent, and uses `SameSite=Lax`. In production, set `CLIENT_URL` to the public HTTPS origin and serve the app over HTTPS for the `Secure` cookie. Locally the trusted origin defaults to `http://127.0.0.1:5173`.

The login limit is ten attempts per client IP every fifteen minutes. A blocked request returns `429` with `Retry-After`. Counters live in the Express process and reset when it restarts. Deployment behind a proxy requires configuring the trusted proxy for that host's network layout.

### Check a session from PowerShell

Start PostgreSQL and run `npm.cmd --prefix server run dev` from the project root. In another terminal, run the following with a fresh development account. The random password is generated locally and the temporary cookie jar is removed after logout.

~~~powershell
$api = 'http://127.0.0.1:4000/api/auth'
$origin = 'Origin: http://127.0.0.1:5173'
$jar = Join-Path $env:TEMP ('contesthub-' + [guid]::NewGuid() + '.cookies')
$credentials = @{ email = ([guid]::NewGuid().ToString() + '@example.invalid'); password = [guid]::NewGuid().ToString() }
try {
  (@{ name = 'Stage Four' } + $credentials) | ConvertTo-Json -Compress | curl.exe -sS -w ' HTTP %{http_code}\n' -H $origin -H 'Content-Type: application/json' --data-binary '@-' "$api/register"
  $credentials | ConvertTo-Json -Compress | curl.exe -sS -w ' HTTP %{http_code}\n' -c $jar -H $origin -H 'Content-Type: application/json' --data-binary '@-' "$api/login"
  curl.exe -sS -w ' HTTP %{http_code}\n' -b $jar "$api/me"
  curl.exe -sS -w ' HTTP %{http_code}\n' -b $jar -H $origin -X POST "$api/logout"
  curl.exe -sS -w ' HTTP %{http_code}\n' -b $jar "$api/me"
} finally {
  if (Test-Path -LiteralPath $jar) { Remove-Item -LiteralPath $jar }
}
~~~

Expect `201`, `200`, `200`, `204`, and `401`. The last request deliberately reuses the original cookie to verify server-side revocation. Run `npm.cmd --prefix server test` for the direct admin-guard checks against a test-only HTTP endpoint.

## Stage 5 · Import Codeforces contests

With Node 24 on your path and the Stage 2 database running and migrated, run these commands from the repository root. Inside `server/`, the import command is `npm run sync`. It runs independently of Express.

~~~powershell
npm.cmd --prefix server run sync
npm.cmd --prefix server run sync
npm.cmd --prefix server test -- codeforces
~~~

The first successful sync prints `added=N updated=N skipped=N`. With an unchanged feed, the second run should report zero added and zero updated. Skips include past contests, missing or invalid fields, repeated source IDs and already-current rows. A valid empty feed produces three zeroes. With Express running, inspect the published upcoming rows using the existing endpoint.

~~~powershell
curl.exe -sS "http://127.0.0.1:4000/api/contests?source=CODEFORCES&upcoming=true"
~~~

`server/src/scripts/sync-codeforces.ts` calls `server/src/services/codeforces.ts`. The service requests the public contest list once and allows ten seconds for headers and body together. It checks the HTTP status, parses the JSON, then checks the Codeforces status and result array. A failed run exits with code 1 and a controlled diagnostic. A PostgreSQL transaction rolls back incomplete writes. Existing contests remain available when the upstream service fails or omits them from a later feed.

Each imported row must have phase `BEFORE`, a positive integer ID, a title, a valid future start and a positive duration. Codeforces gives times in seconds. The service multiplies by 1,000 to construct a JavaScript `Date` and computes the end from start plus duration. If the feed repeats an ID, the first valid upcoming entry wins. These are contest times. Codeforces supplies no registration deadline in this mapping.

One `SELECT` looks up matching Codeforces IDs. For a new or changed row, the upsert corresponds to `INSERT ... ON CONFLICT ("source", "externalId") DO UPDATE`. Codeforces owns the title, times and source URL. Local edits to description, category and publication survive a sync. Updating in place keeps the internal ID used by bookmarks. An unchanged row keeps its existing `updatedAt`.

The job takes a PostgreSQL transaction-level advisory lock before the fetch and holds it for at least two seconds from the start of the request, including on upstream errors. A concurrent CLI using the same database exits before contacting Codeforces. This costs one database connection during the request. Browse requests read the last successful import directly from PostgreSQL, so their latency is independent of Codeforces availability. [Codeforces API usage limits](https://codeforces.com/apiHelp)

`server/test/codeforces.test.ts` passes a fake fetch function into the same service the CLI uses. For example, the following response exercises a missing start time and should produce one skipped row.

~~~ts
const fetcher = async () => Response.json({
  status: "OK",
  result: [{ id: 77, name: "Example round", phase: "BEFORE", durationSeconds: 7200 }],
});
const summary = await syncCodeforces(prisma, fetcher);
~~~

The timeout tests use a pending response that rejects when the supplied abort signal fires. Vitest advances a fake clock to 9,999 ms, verifies the request is still active, then advances one more millisecond and checks the error. Separate cases cover waiting for headers and waiting for the body.

## Stage 6 · Explore contests in React

Start PostgreSQL, then run the client and server dev commands in separate terminals from the project root.

~~~powershell
npm.cmd --prefix server run dev
npm.cmd --prefix client run dev
~~~

Open http://127.0.0.1:5173. Run `npm.cmd --prefix server run sync` to populate a fresh development catalogue with the current Codeforces feed. The screens read published records from PostgreSQL through Express.

1. Search by title and enter an exact category such as `CODING`, then press **Search**. Change source, timing and sort. The URL records applied settings and the page. Refresh the browser and test Back and Forward. **Next** appears as an enabled link when more than 12 records match.
2. Open a contest, refresh its detail URL, then follow **Back to contests** to verify the original filters. Check the source link details and the local start time. The API sends UTC timestamps and the browser formats them in its own time zone.
3. Search for an unmatched title and clear the filters. Use `/?page=9999` and `/contests/missing` to check the page recovery link and the detail 404. Stop Express, refresh the page, restart Express and select **Retry**.
4. In a disposable development database, edit a published contest title while its list or detail page is open. Return to the tab or keep it active for up to 30 seconds to see the update. Throttle the browser's network and refresh to see the loading placeholders.

Contest records and totals are **server state**. TanStack Query caches them per request, refetches on window focus and polls visible tabs every 30 seconds. Filters and page are **URL state**, so links can reproduce a view. Unsubmitted search and category text are **local UI state** in the form. TanStack Query adds a dependency and provides caching, request cancellation and retry behavior that a manual effect would have to coordinate.

The optional API query parameter `sort=start-asc` or `sort=start-desc` orders the entire filtered catalogue before pagination. Tied times sort by ID. Omitting it uses the original upcoming-first order.

~~~powershell
npm.cmd --prefix client run lint
npm.cmd --prefix client run build
npm.cmd --prefix server run build
npm.cmd --prefix server test
curl.exe -sS "http://127.0.0.1:5173/api/contests?source=CODEFORCES&sort=start-asc&limit=12"
~~~

**Interview question.** A user shares page two of a filtered contest list. Which values belong in the URL, which values belong in the TanStack Query key, and how would the recipient see a recent change in PostgreSQL?

## Stage 7 · Save contests and manage bookmarks

With PostgreSQL running, start both apps from the project root in separate terminals.

~~~powershell
npm.cmd --prefix server run dev
npm.cmd --prefix client run dev
~~~

1. Open `http://127.0.0.1:5173/bookmarks` in a signed-out browser. Create an account, then sign in. The app returns you to **My bookmarks**.
2. Open a published contest from Explore and save it. Open **My bookmarks**, then reload. The saved contest should still appear.
3. Sign out and sign in with a different account in the same tab. Its list starts empty. Sign back in as the first account and remove the saved contest. The list refreshes and shows the empty state.

All bookmark requests require the session cookie. Writes also require the trusted origin. The API sets `Cache-Control: no-store`.

| Request | Result |
|---|---|
| `GET /api/me/bookmarks` | `200` with `{ userId, items: [{ savedAt, contest }] }`. Each contest uses the public API shape. Published saves appear newest first. |
| `POST /api/me/bookmarks` | Accepts only `{ "contestId": "..." }`. The first save and repeat saves return `204`. Missing or unpublished contests return `404`. |
| `DELETE /api/me/bookmarks/:contestId` | `204` whether the session user’s bookmark was removed or was already absent. |

Invalid bookmark input returns `400`, an invalid session returns `401`, and an untrusted write origin returns `403`. Hard-deleting a contest cascades to its bookmarks. Unpublishing hides it from the list while preserving the saved relationship.

One user can save many contests, and one contest can be saved by many users. Each `Bookmark` row joins one pair. Foreign keys guarantee both records exist. Two requests can both pass an application-level duplicate check before either writes. The composite primary key makes PostgreSQL enforce the rule during the write, and the insert skips an existing pair with the equivalent of `ON CONFLICT DO NOTHING`. The list reads the session user's rows and joins their published contests. The delete filters by both user ID and contest ID.

React keys the private query by session user and invalidates it after a successful save or removal. The UI waits for the server result, so a failed removal leaves the item available for retry.

~~~powershell
npm.cmd --prefix server test -- bookmarks
npm.cmd --prefix server test
npm.cmd --prefix client run lint
npm.cmd --prefix client run build
npm.cmd --prefix server run build
~~~

**Interview question.** Two concurrent requests try to save the same contest for one user. Why can both pass a pre-insert lookup, and how does the database guarantee a single bookmark?

## Stage 8 · Curate contests as an admin

### Create the first admin

Use a trusted terminal with PostgreSQL running and the intended `DATABASE_URL` configured for the server. Build before entering the credentials. These PowerShell commands prompt for the password without echoing it, pass it to the seed through the current process environment, and clear the temporary values afterward.

~~~powershell
npm.cmd --prefix server run build
if ($LASTEXITCODE -ne 0) { throw 'Build the server before seeding the admin.' }

try {
  $env:CONTESTHUB_ADMIN_NAME = Read-Host 'Admin name'
  $env:CONTESTHUB_ADMIN_EMAIL = Read-Host 'Email for a new admin account'
  $seedPassword = Read-Host 'Admin password (12–128 characters)' -AsSecureString
  $env:CONTESTHUB_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $seedPassword).Password
  npm.cmd --prefix server run seed:admin
  if ($LASTEXITCODE -ne 0) { throw 'The admin seed did not complete.' }
} finally {
  Remove-Item Env:CONTESTHUB_ADMIN_NAME, Env:CONTESTHUB_ADMIN_EMAIL, Env:CONTESTHUB_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  if ($seedPassword) { $seedPassword.Dispose() }
  Remove-Variable seedPassword -ErrorAction SilentlyContinue
}
~~~

Keep seed credentials out of `.env`, source files, and command arguments. The script applies the normal account validation and stores an Argon2id password hash. PostgreSQL serializes first-admin setup across concurrent seed processes. After an admin exists, a repeated command leaves the accounts as they are. An existing public account keeps its current role.

### Create, publish, and unpublish

With both dev servers running, sign in at `http://127.0.0.1:5173/auth` and open **Admin contests**. Create a contest with a title, organiser URL and start time. Keep **Published** off and verify the draft appears in the admin list. Edit it, turn **Published** on, and verify it appears under the **Curated** source on Explore. Turn **Published** off again and verify it disappears from Explore while staying in the admin list.

| Endpoint | Contract |
|---|---|
| `GET /api/admin/contests` | `200` with `{ items }` for all manual contests, including drafts. |
| `POST /api/admin/contests` | `201` with the created record. The server sets `source=MANUAL`, generates a UUID for `externalId` and defaults the contest to unpublished. |
| `PATCH /api/admin/contests/:id` | `200` with the updated manual record. Send `{ "isPublished": true }` or `{ "isPublished": false }` to change visibility. Unknown and Codeforces IDs return `404`. |

Express checks the current session and role on each admin request. Signed-out visitors get `401` and ordinary users get `403`, including direct API calls. Writes also check the trusted origin. Input validation returns `400`. The API accepts absolute HTTP(S) organiser URLs without credentials and timestamps with an offset. The form interprets times in the browser's zone and sends UTC. End time is optional and must follow start time when supplied.

The edit transaction checks the saved schedule and applies the patch together. If two concurrent edits conflict, the API returns `409` so the editor can reload. When a contest is unpublished, public detail returns `404` and the contest drops out of public listings and bookmark views. The bookmark row survives and becomes visible again when the contest is republished.

~~~powershell
npm.cmd --prefix server test -- admin
npm.cmd --prefix server test
npm.cmd --prefix client run lint
npm.cmd --prefix client run build
npm.cmd --prefix server run build
~~~

**Interview question.** A regular user opens DevTools and sends a direct `PATCH` request to publish a contest. Which backend checks run, and where does the server get the user's role?
