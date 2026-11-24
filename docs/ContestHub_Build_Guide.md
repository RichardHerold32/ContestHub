# ContestHub
## A beginner-to-full-stack engineering build guide

**Project:** Competition discovery, bookmarking and contest synchronisation platform  
**Audience:** React developer with one year of frontend experience and a MongoDB Notes app  
**Interview goal:** Infosys SP/DSE coding round and technical interview, 6 December 2026  
**Prepared:** 23 November 2026  
**Guide version:** 1.0

> **How to use this guide:** Work through the stages in sequence. Copy one stage's prompt into your coding assistant, inspect the generated code, run the tests, and commit only after the acceptance criteria pass. Do not ask an AI agent to build the entire project in one prompt. A working project you understand is more valuable than a large codebase you cannot explain.

---

# Part I. Understand what you are building

## 1. Product definition

ContestHub is a **contest aggregation and personal tracking platform**. Developers can discover programming contests, filter them, bookmark contests and open the original organiser's page. Administrators can add and publish curated contests. A backend synchronisation job imports upcoming contests from the public Codeforces API.

**Not in scope:** Hosting contests, grading code, registering people automatically, confirming external registrations, scraping restricted websites, generating AI recommendations, real-time collaboration or sending mass emails.

### MVP definition of done

- A visitor can browse and search real Codeforces contests imported by the backend.
- A registered user can log in, log out, bookmark/unbookmark contests and see their bookmarks.
- An administrator can create, edit, publish and unpublish manually curated contests.
- Importing the same Codeforces contest twice updates its record instead of creating a duplicate.
- APIs validate inputs, enforce authentication and authorisation, paginate results and return appropriate errors.
- The application is deployed, documented, and has basic automated tests.

**Reality check:** Competition titles and times in a UI mockup are not real data. Show imported contests as originating from Codeforces, and show manually entered records as curated. An official contest page is a **View contest** link, not necessarily a registration link. Do not claim a registration is confirmed unless the organiser explicitly provides that confirmation.

## 2. Technologies and why they are used

| Technology | Purpose | Why it fits | Main trade-off |
|---|---|---|---|
| React + Vite + TypeScript | Frontend SPA | Familiar React workflow, fast local development | Separate frontend and backend deployment/configuration |
| Tailwind CSS | UI styles | Quick, reusable responsive styling | Long utility class lists can reduce readability |
| TanStack Query | API data and cache | Handles loading/error/refetch/invalidation | Extra abstraction for a small app |
| Node.js 24 LTS | JavaScript runtime | One language across stack, stable ecosystem | CPU-bound work must not block the event loop |
| Express 5 | REST backend | Explicit middleware/routing; beginner-friendly | More decisions than an opinionated framework |
| PostgreSQL | Persistent relational data | Strong constraints, joins, indexing and transactions | Schema/migration discipline required |
| Prisma ORM **7.x** | Database access and migrations | Typed access and readable queries | ORM abstraction can obscure SQL behaviour |
| Argon2 | Password hashing | Password-specific, salted hashing | Requires secure parameter/runtime management |
| Server-side session cookies | Authentication | Revocable sessions; credentials stay out of localStorage | Session storage and CSRF defences required |
| Zod | Input validation | Runtime schema validation for TypeScript | Another schema layer alongside Prisma |
| Vitest + Supertest | API testing | Fast unit/integration checks | Tests need isolated test data/database |
| Codeforces API | Real contest source | Public documented contest data | External reliability and rate limit |

**Version consistency:** This guide deliberately pins Prisma ORM 7 for reproducible instructions. The Prisma 8 release candidate has a different setup and contract model. Use **Prisma 7 documentation and the matching Prisma 7 CLI/client versions**, not unqualified `@latest` for Prisma. Node 24 LTS is recommended for this project; verify your deployment host supports it.

## 3. Architecture and request lifecycle

```text
Browser (React + TanStack Query)
    |
    | HTTPS /api/*
    v
Express REST API
    |-- Validate inputs (Zod)
    |-- Authenticate session cookie
    |-- Authorise USER / ADMIN
    |-- Business logic (services)
    v
Prisma Client -> PostgreSQL

Scheduled/manual sync -> Codeforces API
    |-- Check HTTP response and API status
    |-- Validate/normalise contest objects
    |-- Upsert by (source, externalId)
    v
PostgreSQL -> REST API -> Browser
```

**Example lifecycle for `GET /api/contests`:** Browser calls backend, the route validates page/filter values, the service asks Prisma for a limited set of matching contests, PostgreSQL executes the query, and Express returns JSON. The browser never needs database credentials.

**Example lifecycle for importing contests:** A backend-only job fetches Codeforces, validates the response, converts Unix seconds into timestamps, deduplicates by external ID and saves records. Visitors read the already stored records rather than independently calling Codeforces.

---

# Part II. Establish a learning-oriented workflow

## 4. Your master AI coding prompt

Copy this **once at the beginning of the project** into Cursor, Copilot Chat or your preferred coding assistant:

```text
Act as my senior full-stack engineering mentor. I have one year of mostly
frontend experience, have built React tutorial clones, and have built one
MongoDB Notes app. We are building ContestHub with React + Vite + TypeScript,
Node.js 24 LTS, Express 5, PostgreSQL, Prisma ORM 7, Zod and Vitest.

Teaching rules:
1. Implement only the current milestone. Do not build future features.
2. Before writing code, explain the purpose, request flow, files and trade-offs.
3. Show every command and every file path. Use modern, version-correct APIs.
4. Explain non-obvious lines and what SQL is conceptually being executed.
5. After coding, give manual test commands, edge cases and success criteria.
6. Include one likely technical-interview question per milestone.
7. Do not silently add libraries, change architecture or invent API fields.
8. Prefer minimal working code, clear errors, type safety and tests.
9. Stop after the acceptance checks and ask me to run them before continuing.
10. Never put passwords, tokens, session secrets or DB URLs in the repo.

I will supply each milestone below separately. Teach me rather than only
producing code.
```

### How to study each generated feature

For each meaningful file, answer these questions in your own words: What calls this file? What input does it accept? What output does it produce? What could fail? How would I test it? What is the time/database cost? Then close the assistant and rewrite one important function yourself.

Commit working milestones separately, for example `feat: add contest listing API` or `test: reject duplicate bookmarks`. This demonstrates incremental engineering rather than one giant AI-generated commit.

---

# Part III. Build the application from scratch

## Stage 0. Define scope, screens and project acceptance tests

**What you are doing:** Turning an idea into testable requirements before writing code.  
**Why:** Uncontrolled feature expansion is the main risk with your interview approaching.  
**Deliverables:** A one-page scope, five screen sketches and a list of API endpoints.

**Screens:** (1) Explore contests, (2) Contest details, (3) Login/Register, (4) My bookmarks, (5) Admin contest editor.

**Rules:** Visitors can browse. Logged-in users can bookmark. Only admins can modify listings. External registrations remain on the source website. Contest times are displayed in the viewer's local timezone, stored in UTC.

**Prompt P0:**

```text
Using the ContestHub architecture and MVP in this guide, create a short
product requirements document and a route/screen map. Define USER and ADMIN
permissions, five main screens, loading/empty/error states, and acceptance
tests. Do not generate application code. Clearly separate MVP features from
optional post-interview ideas. Explain any assumptions.
```

**Acceptance checks:** You can explain in 60 seconds who uses the product, what it solves, what is in scope and what is excluded.

**Trade-off:** Limited scope sacrifices feature breadth but makes the completed system testable and explainable.

## Stage 1. Create the repository and run a minimal backend/frontend

**What you are doing:** Creating the two applications and checking that their development servers run independently.  
**Why:** Establishing a working baseline makes subsequent debugging easier.

**Prerequisites:** Git, Node.js 24 LTS, npm, a local PostgreSQL server or an account with a managed PostgreSQL provider, and a code editor. Commands use bash syntax; on Windows, use Git Bash/WSL or run each command as a single line in PowerShell.

**Terminal commands:**

```bash
mkdir contesthub
cd contesthub
git init

npm create vite@latest client -- --template react-ts
cd client
npm install
npm run dev
```

Open a second terminal in the project root:

```bash
mkdir server
cd server
npm init -y
npm install express@5 cors helmet express-rate-limit cookie-parser zod dotenv argon2
npm install -D typescript tsx @types/node @types/express @types/cors @types/cookie-parser vitest supertest @types/supertest
npx tsc --init
```

**Initial server structure:**

```text
contesthub/
  client/
    src/
  server/
    src/
      app.ts
      index.ts
      routes/
      services/
      middleware/
      lib/
    prisma/
    .env.example
  README.md
```

Configure `server/package.json` with `"type": "module"` and a `dev` script such as `"dev": "tsx watch src/index.ts"`. Start with a single `/api/health` route returning `{ "status": "ok" }`. Set the Express server to port 4000. Keep `app.ts` separate from `index.ts` so tests can import the app without starting a listener. Configure the Vite dev proxy so requests to `/api` reach `http://localhost:4000`.

**Prompt P1:**

```text
Create only the initial Express 5 TypeScript backend and Vite frontend
connection. Use app.ts for middleware/routes and index.ts for server startup.
Add GET /api/health, central 404/error handling, Helmet, JSON parsing, a
request-size limit and a Vite /api dev proxy. Show package scripts, required
TypeScript configuration and smoke-test commands. Explain what middleware,
CORS and reverse proxies do. Do not add authentication or Prisma yet.
```

**Acceptance checks:** `npm run dev` runs for both apps, `GET /api/health` returns HTTP 200, and React can fetch that endpoint through `/api` without hard-coding `localhost:4000` into browser components.

**Trade-off:** Separate `client/` and `server/` improves separation of responsibilities but requires proxy/CORS configuration. A single Next.js app would reduce deployment surface but would hide some Express-specific learning.

## Stage 2. Learn PostgreSQL and connect Prisma 7

**What you are doing:** Replacing in-memory data with a relational database.  
**Why:** This is the largest technical skill gap relative to your MongoDB Notes app.

**Must understand before coding:**

- A **table** holds rows, comparable to but not identical to a MongoDB collection.
- A **primary key** identifies a row.
- A **foreign key** points to another table and enforces referential integrity.
- A **unique constraint** prevents duplicates at the database level.
- An **index** speeds selected read patterns at the cost of storage and write overhead.
- A **migration** records a schema change so development and deployment databases stay compatible.

**Install Prisma 7 packages in `server/`:**

```bash
npm install @prisma/client@7 @prisma/adapter-pg pg
npm install -D prisma@7 @types/pg
npx prisma init --datasource-provider postgresql --output ../src/generated/prisma
```

Prisma 7's generated config may be called `prisma7.config.ts`; keep it and use the official Prisma 7 quickstart. Put a real `DATABASE_URL` only in `server/.env`, and a safe placeholder in `.env.example`. For a local database, the URL has this shape:

```env
DATABASE_URL="postgresql://USERNAME:PASSWORD@localhost:5432/contesthub?schema=public"
PORT=4000
CLIENT_URL="http://localhost:5173"
```

**Suggested schema (`server/prisma/schema.prisma`):**

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum UserRole {
  USER
  ADMIN
}

enum ContestSource {
  CODEFORCES
  MANUAL
}

model User {
  id           String     @id @default(cuid())
  name         String
  email        String     @unique
  passwordHash String
  role         UserRole   @default(USER)
  createdAt    DateTime   @default(now())
  sessions     Session[]
  bookmarks    Bookmark[]
}

model Session {
  id        String   @id @default(cuid())
  tokenHash String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}

model Contest {
  id          String        @id @default(cuid())
  source      ContestSource
  externalId  String
  title       String
  description String?
  category    String        @default("CODING")
  startsAt    DateTime
  endsAt      DateTime?
  sourceUrl   String
  isPublished Boolean       @default(true)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  bookmarks   Bookmark[]

  @@unique([source, externalId])
  @@index([startsAt])
  @@index([category, startsAt])
}

model Bookmark {
  userId    String
  contestId String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  contest   Contest  @relation(fields: [contestId], references: [id], onDelete: Cascade)

  @@id([userId, contestId])
}
```

For a manually entered contest, assign a generated unique `externalId` on the server. Do not ask administrators to invent it. For a Codeforces contest, use the official contest ID converted to a string.

**Generate the database structure:**

```bash
npx prisma migrate dev --name init
npx prisma generate
npx prisma studio
```

Prisma 7 requires the PostgreSQL driver adapter to create a PrismaClient. In `src/lib/prisma.ts`, instantiate `PrismaPg` with `DATABASE_URL`, then pass the adapter to `new PrismaClient({ adapter })`. Follow the import path generated by your chosen Prisma output directory.

**Prompt P2:**

```text
Implement PostgreSQL and Prisma ORM 7 for ContestHub using the exact models
in this guide. Explain each primary key, foreign key, relation, unique
constraint and index. Keep the Prisma 7 datasource config and driver adapter
compatible with the official v7 docs. Create the migration, a shared Prisma
client instance, and a simple database connectivity check. Show the SQL
concepts corresponding to findMany, create and upsert. Do not implement
business routes yet. Explain why Bookmark uses a composite primary key.
```

**Acceptance checks:** Migrations succeed, Prisma Studio shows the four tables, and a test query connects successfully. You can explain `User -> Bookmark -> Contest` without looking at the code.

**Trade-off:** Prisma speeds development but does not remove the need to know SQL. Compare the generated queries with equivalent `SELECT`, `INSERT`, `JOIN` and `ON CONFLICT` statements.

## Stage 3. Implement the public contest REST API

**What you are doing:** Building an API that serves contest data from PostgreSQL.  
**Why:** The frontend should depend on an API contract, not on database or external-service details.

**Endpoints:**

| Method | Route | Description | Access |
|---|---|---|---|
| GET | `/api/health` | Server health | Public |
| GET | `/api/contests` | Paginated list with filters | Public |
| GET | `/api/contests/:id` | Single published contest | Public |

**Sample request:**

```http
GET /api/contests?page=1&limit=12&search=round&category=CODING
```

**Sample successful response shape:**

```json
{
  "items": [
    {
      "id": "example-cuid",
      "title": "Example Coding Contest",
      "source": "CODEFORCES",
      "startsAt": "2026-12-10T14:00:00.000Z",
      "sourceUrl": "https://codeforces.com/contests"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 12,
    "total": 1,
    "totalPages": 1
  }
}
```

*The record above is illustrative, not an actual imported contest.*

**Design decisions:** Validate query parameters using Zod. Default page to 1 and limit to 12; cap limit at 50. Return only `isPublished = true`. Sort by nearest upcoming `startsAt` first. Compute `upcoming`, `live` or `ended` from `startsAt` and `endsAt` in one consistent place; do not mistake the start time for a registration deadline. Avoid leaking internal-only fields and personal user data.

**Prompt P3:**

```text
Implement GET /api/contests and GET /api/contests/:id with Express 5,
Zod and Prisma. Include search, category, source, upcoming filter,
pagination (max 50), UTC timestamps, stable sorting, and a consistent
error JSON format. Separate route, validation and service code. Explain
Prisma where, orderBy, skip/take and count, plus their conceptual SQL.
Write tests for invalid page values, unpublished contests and unknown IDs.
```

**Acceptance checks:** Empty database returns `items: []`. Invalid `limit` returns 400. Unknown ID returns 404. Unpublished contest is invisible to public users. Search and pagination work on seeded records.

**Trade-off:** Offset pagination is simplest for an MVP, but large offsets get slower and concurrent updates can shift results. Cursor pagination can be introduced later for large feeds.

## Stage 4. Build real authentication and authorisation

**What you are doing:** Creating user identities and controlling access to backend resources.  
**Why:** A frontend-only admin check is insecure because anyone can call the API directly.

**Endpoints:**

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

**Recommended design:** Hash passwords with Argon2. On successful login, generate a cryptographically random session token, store only its hash in the `Session` table, and set the token in an `HttpOnly` cookie with suitable `Secure`, `SameSite` and expiry options. On subsequent requests, hash the cookie token, look up its session, verify expiry and load the user. Logout deletes the current session and clears the cookie. Treat all client data as untrusted. Never accept a public registration field that sets `role = ADMIN`.

**Important security requirement:** Cookies are automatically sent by browsers. Protect unsafe methods (`POST`, `PATCH`, `DELETE`) against cross-site request forgery with appropriate same-site deployment, Origin validation and/or an anti-CSRF token. Use HTTPS in production, restricted CORS origins, a login rate limiter and generic login errors. `SameSite` alone is not a universal CSRF solution.

**Prompt P4:**

```text
Implement register, login, logout and me routes. Use Argon2 password hashes,
cryptographically random opaque session tokens, SHA-256 token hashes stored
in PostgreSQL Session rows, and HttpOnly cookies. Add session expiry,
logout revocation, protected-route middleware, admin-role middleware,
login rate limiting, Zod validation and CSRF-aware origin handling.
Never permit role escalation through a registration payload. Add tests
for wrong passwords, expired sessions, logout and USER access to admin
routes. Explain sessions versus JWTs and cookie security trade-offs.
```

**Acceptance checks:** A new user can register/login, `/me` works with a valid session, invalid credentials fail, logout revokes access, and an ordinary USER cannot access an admin route by calling it directly with Postman/curl.

**Trade-off:** Database sessions are easy to revoke but require a query or cache access to authenticate requests. Stateless JWTs reduce session lookups but need careful expiry, storage and revocation design.

## Stage 5. Import real contests from Codeforces

**What you are doing:** Building the project's main non-CRUD engineering component, an external data ingestion pipeline.  
**Why:** Imported data must be trustworthy, consistent and deduplicated even when the external source fails.

**Documented endpoint:** `https://codeforces.com/api/contest.list`

Codeforces returns a `status` and `result` field. The `Contest` object includes `id`, `name`, `phase` and `durationSeconds`. `startTimeSeconds` may be absent, so guard against missing/invalid values before constructing dates. The official API limit is at most one request per two seconds.

**Flow:**

```text
Fetch (timeout + HTTP check)
    -> Check JSON status === "OK"
    -> Validate response shape
    -> Filter upcoming (phase === "BEFORE")
    -> Skip missing startTimeSeconds
    -> Normalise to Contest schema
    -> Upsert by (CODEFORCES, externalId)
    -> Log created / updated / skipped / failed counts
```

**Representative mapping:**

```ts
const normalised = {
  source: "CODEFORCES" as const,
  externalId: String(contest.id),
  title: contest.name,
  category: "CODING",
  startsAt: new Date(contest.startTimeSeconds * 1000),
  endsAt: new Date((contest.startTimeSeconds + contest.durationSeconds) * 1000),
  sourceUrl: `https://codeforces.com/contest/${contest.id}`,
  isPublished: true
};
```

That snippet assumes the fields were validated first. Do not blindly trust a remote response. In the upsert, update source-controlled fields (`title`, `startsAt`, `endsAt`, URL) while preserving unrelated local fields and bookmarks. Decide explicitly whether admins can override imported records.

**Prompt P5:**

```text
Create a Codeforces ingestion service and a CLI command `npm run sync`.
Fetch https://codeforces.com/api/contest.list from the backend, with a
10-second timeout, HTTP status handling, JSON validation and Codeforces
status handling. Import upcoming contests with valid startTimeSeconds.
Normalise Unix timestamps to Date values. Upsert using the unique pair
(source, externalId). Do not create duplicates on repeated sync. Log a
summary of added/updated/skipped rows. Show how to mock API responses
for tests, including a timeout and missing startTimeSeconds. Respect the
published Codeforces request rate limit. Do not invent registration deadlines.
```

**Acceptance checks:** First sync creates contests. Second sync does not increase the count for the same source IDs. A changed contest time is updated. An upstream failure does not delete valid existing data. The job reports errors without exposing secrets.

**Trade-off:** Directly fetching upstream on every page view would be fresher in theory but increases latency, rate-limit risk and outage exposure. Scheduled local storage sacrifices some freshness for availability and predictable reads.

## Stage 6. Build the React browse experience

**What you are doing:** Creating the user-facing interface over your own REST API.  
**Why:** React is your existing strength, so use it to present the backend's capabilities rather than build a visually complex mockup.

**UI:** Header, search bar, category/source filters, sort control, contest cards, pagination, contest detail page and empty/error states. Each card shows title, organiser/source, start time, duration and a **View on Codeforces** link. Never claim confirmed registration or display an invented deadline.

**Suggested client libraries:** `react-router-dom`, `@tanstack/react-query`, Tailwind CSS and a small accessible component library if needed. Avoid Redux for this MVP because most state is server-owned and can be handled by TanStack Query.

**Prompt P6:**

```text
Build a clean responsive React + TypeScript contest discovery UI using the
actual /api/contests endpoints. Add search, source/category filters,
pagination, card and detail views, and loading/empty/error/retry states.
Use TanStack Query for server data, React Router for navigation, and
URL query parameters for shareable filters. Explain server state versus
local UI state. Use real API data, not hard-coded mock contests. Make
external links safe with rel="noopener noreferrer".
```

**Acceptance checks:** UI updates after a backend record changes. Browser refresh preserves filter URL state. Empty and API-error states are usable. Timestamps display in the user's local time while backend storage remains UTC.

**Trade-off:** TanStack Query adds a dependency but handles cache, retries and invalidation better than manual `useEffect` for network data.

## Stage 7. Bookmarks and user dashboard

**What you are doing:** Implementing user-specific relational data.  
**Why:** This gives you a many-to-many relationship and protected endpoint ownership rules to discuss.

**Endpoints:**

```text
GET    /api/me/bookmarks
POST   /api/me/bookmarks        {"contestId": "..."}
DELETE /api/me/bookmarks/:contestId
```

The backend must derive `userId` from the authenticated session, never from a request body. The `Bookmark` composite primary key `(userId, contestId)` prevents duplicates even when two requests race. The endpoint may use an idempotent create strategy or return `409 Conflict` on duplicate, but document the contract and test it.

**Prompt P7:**

```text
Implement authenticated bookmark create/list/delete APIs and a My
Bookmarks React page. Derive the user identity only from the session.
Use the Bookmark composite key to prevent duplicates. Handle unknown
contest IDs, repeat requests, deleted contests, logged-out users and
attempts to access another user's bookmarks. Add API tests. Explain
many-to-many relationships and why a database constraint is needed in
addition to checking for duplicates in application code.
```

**Acceptance checks:** Bookmarking twice creates one row. User A cannot access User B's bookmarks. Logging out prevents bookmark changes. Removing a bookmark updates the UI after query invalidation.

**Trade-off:** A join table adds a query/join but scales cleanly to many users and contests. An array of contest IDs inside a user document would lose relational foreign-key guarantees.

## Stage 8. Admin editing, publishing and RBAC

**What you are doing:** Adding a controlled source for contests that do not have an official API.  
**Why:** Manual curation avoids prohibited scraping and makes the product useful beyond Codeforces.

**Endpoints:**

```text
POST  /api/admin/contests
PATCH /api/admin/contests/:id
GET   /api/admin/contests
```

Provide a publish/unpublish switch using `isPublished`. Manual contests receive `source = MANUAL` and a server-generated `externalId`. Do not let the admin editor override a Codeforces record's unique source identity unless you have deliberately designed that policy. Validate URLs, titles and dates on the server. Seed the first admin through a private script, **never** a public 'register as admin' form.

**Prompt P8:**

```text
Create admin-only contest management APIs and an admin form for manual
contests. Require authenticated ADMIN role in backend middleware. Validate
fields with Zod, generate MANUAL external IDs on the server, support
publish/unpublish, and prevent public display of unpublished contests.
Add tests for unauthorised access, invalid dates, unsafe URLs, and
manually curated listings. Provide a secure one-time admin seed script;
do not expose an admin registration endpoint.
```

**Acceptance checks:** A normal user gets 403 when calling an admin API even if the frontend hides the page. Unpublished contests disappear from public listings but stay in the admin dashboard.

**Trade-off:** RBAC with two roles is simple and adequate now. Fine-grained permissions become useful only when multiple editor/reviewer roles exist.

## Stage 9. Search performance and SQL knowledge

**What you are doing:** Making list queries predictable and understanding what PostgreSQL does.  
**Why:** An ORM is not an excuse to ignore database performance.

**Important SQL practice:**

```sql
-- Read published upcoming contests
SELECT id, title, "startsAt"
FROM "Contest"
WHERE "isPublished" = TRUE AND "startsAt" >= NOW()
ORDER BY "startsAt" ASC
LIMIT 12 OFFSET 0;

-- Read a user's bookmarks with contest details
SELECT c.id, c.title, c."startsAt"
FROM "Bookmark" AS b
JOIN "Contest" AS c ON c.id = b."contestId"
WHERE b."userId" = 'example-user-id';
```

Use the actual migration-generated column names and quotes; these examples assume the Prisma default mixed-case mappings. Examine query plans with `EXPLAIN ANALYZE`. Existing indexes on `startsAt` and `(category, startsAt)` help some common filters, but do not assume they make case-insensitive substring searches fast. A PostgreSQL `pg_trgm` index or full-text search is a later optimisation once measurements justify it.

**Prompt P9:**

```text
Review the contest listing and bookmark queries. Show the equivalent SQL
for Prisma findMany, count and relation includes. Demonstrate EXPLAIN
ANALYZE on representative data. Explain why LIMIT/OFFSET is useful,
when indexes help, and why contains/ILIKE may still be slow. Do not
add Redis or complex search infrastructure without a measured need.
Write tests for filtering, stable pagination order and SQL injection safety.
```

**Acceptance checks:** You can explain a SQL JOIN, a unique constraint and why an index is not free.

**Trade-off:** Indexes speed reads but increase write overhead; measure before creating many. Offset pagination is adequate for a small contest catalogue.

## Stage 10. Add scheduling, logging and failure recovery

**What you are doing:** Moving from manually triggered imports to repeatable operations.  
**Why:** A reliable ingestion process is your most meaningful advanced backend feature.

Start with a manual CLI job. After its tests pass, schedule it using the hosting provider's scheduler or a single trusted cron worker. Prefer scheduling the CLI/worker, not relying on `node-cron` inside every API server instance, which could trigger duplicate concurrent imports after scaling. A six-hour interval is more than sufficient for the initial demo. Store UTC timestamps, use timeouts, avoid excessive retries and log each sync run's result. If the job fails, previously saved contests remain available. Never publish internal scheduler secrets.

**Prompt P10:**

```text
Turn the tested Codeforces sync into a scheduled job without coupling it
to incoming page requests. Add structured logs for start/end, fetched,
created, updated, skipped and errors. Prevent accidental overlapping
runs, handle source API outages safely and keep existing database data.
Explain in-process cron versus external scheduled jobs, idempotency,
retry policies, rate limits and eventual consistency. Keep the design
small enough for one application instance.
```

**Acceptance checks:** A run is repeatable and idempotent. An upstream timeout is visible in logs but does not break `GET /api/contests`. Duplicate schedule triggers do not create duplicate contest rows.

**Trade-off:** External scheduling is operationally more reliable for scaled services, but has hosting/setup complexity. A manually triggered CLI is sufficient for the first working milestone.

## Stage 11. Write tests, protect APIs and check errors

**What you are doing:** Proving the features behave correctly under both successful and failing conditions.  
**Why:** Being able to demonstrate tests makes the project much more credible than showing screenshots.

**Minimum test plan:**

| Case | Expected result |
|---|---|
| Missing contest ID | 404 |
| Invalid page or limit | 400 |
| Logged-out bookmark request | 401 |
| USER calls admin route | 403 |
| Duplicate bookmark | One bookmark row; documented response |
| Import same Codeforces ID twice | One contest row |
| Codeforces timeout or `FAILED` | Import reports failure; existing data retained |
| Request for unpublished contest | Not visible publicly |
| SQL injection-like search string | Treated as data; no SQL execution |
| Expired or logged-out session | Authentication rejected |
| Browser form invalid date or URL | Clear validation error |

**Additional protections:** Helmet, request body limits, login rate limits, Zod runtime validation, HTTPS in production, strict session cookie options, CSRF-aware protection, no credentials in logs, restrictive production CORS and proper error redaction. Avoid displaying upstream HTML or untrusted description content as raw `dangerouslySetInnerHTML`.

**Prompt P11:**

```text
Set up Vitest and Supertest for Express APIs. Use an isolated PostgreSQL
test database or a safely reset test schema, never the production DB.
Implement tests for the table in Stage 11 and provide one clear command
to run all tests. Mock Codeforces for deterministic ingestion tests.
Review authentication, CSRF, rate limiting, sensitive data leaks,
uncaught errors and unvalidated input. Explain unit versus integration
tests, the test pyramid and what is not yet covered.
```

**Acceptance checks:** Tests pass twice in a row. Failures have useful error messages. Sensitive secrets are absent from repository history and API responses.

**Trade-off:** Test setup costs development time but reduces regression risk and gives a strong interview talking point.

## Stage 12. Deploy and document honestly

**What you are doing:** Demonstrating that the application works outside your laptop.  
**Why:** A deployed link and reproducible setup validate the integration of client, API and database.

**Possible deployment layout:**

```text
Static React hosting -> HTTPS /api reverse proxy -> Node/Express host
                                                  -> managed PostgreSQL
External scheduler -> sync worker -> Codeforces API
```

For example, host the React frontend on a static host, the Node server on a managed app host and PostgreSQL on a managed database provider. Exact free-tier availability and deployment commands may change, so inspect current provider documentation before selecting. Prefer a common same-origin `/api` reverse proxy where feasible. If frontend and API are on different sites, explicitly solve cookie `SameSite`, `Secure`, CORS and CSRF configuration; do not weaken protections merely to make login work.

**Deployment checklist:**

- Configure environment variables on the host; do not upload `.env`.
- Generate Prisma Client during the appropriate build step.
- Apply committed production migrations using `prisma migrate deploy`, not `migrate dev`.
- Test register/login/logout and admin authorisation over HTTPS.
- Run one Codeforces sync and confirm real records appear.
- Test refreshing a deep React route directly.
- Check database connectivity, log redaction, health checks and static asset routes.
- Write a README with architecture, schema, commands, screenshots, deployment link, known limitations and test instructions.

**Prompt P12:**

```text
Prepare ContestHub for deployment. Provide provider-neutral environment
requirements, production build scripts, Prisma 7 production migration
commands, secrets handling, HTTPS/cookie/CORS/CSRF considerations,
a deployment smoke-test checklist and a polished technical README.
Include an architecture diagram, table relationships, API route table,
test commands, real limitations and future improvements. Do not claim
features or performance measurements that we have not verified.
```

**Acceptance checks:** A fresh visitor can browse live imported contests. A new account can log in and bookmark. Admin routes are protected. README allows another developer to reproduce the setup. You can explain the production request path end-to-end.

**Trade-off:** Managed hosting reduces operations work but increases reliance on platform pricing, policies and configuration. Self-hosting gives control but raises security, monitoring and maintenance effort.

---

# Part IV. Prioritisation for your Infosys deadline

## 5. What to build first and what to defer

**Essential, in order:** Stages 0 through 5, followed by 6, 7, 8, 11 and 12.  
**If time remains:** Stage 9 performance study, then Stage 10 scheduling.  
**Not before the interview:** Redis, AI recommendations, microservices, Kafka, WebSockets, mobile apps, custom scraping and online code execution.

**Suggested short project schedule:**

| Date | Project milestone | Stop condition |
|---|---|---|
| 23 Nov | Scope, frontend/backend skeleton | Health endpoint works |
| 24 Nov | PostgreSQL schema and migration | Database connection verified |
| 25 Nov | Contest list/read APIs and seed data | Pagination and filters work |
| 26 Nov | Authentication and session security | Login/logout/protected route tests |
| 27 Nov | Codeforces import and idempotent upsert | Real records, no duplicates |
| 28 Nov | React pages and bookmarks | End-to-end user flow |
| 29 Nov | Admin, tests, README and deployment | Demonstrable MVP |
| 30 Nov to 5 Dec | DSA mocks, core CS revision, project explanation | Only bug fixes, not new features |

This timetable is aggressive and assumes roughly 1 to 2 focused hours of project work daily. If a milestone slips, do not sacrifice coding-round preparation. Prefer a smaller working product to an unfinished feature list. If schedule pressure becomes serious, drop sessions/admin and use a curated read-only contest aggregator with robust ingestion and tests, but describe the reduced scope honestly.

## 6. What to put on your resume, after the features work

**ContestHub | Full-Stack Competition Aggregation Platform**  
*React, TypeScript, Node.js, Express, PostgreSQL, Prisma*

- Designed relational schemas and REST APIs for contest discovery, filtering, bookmarking and admin workflows.
- Integrated the public Codeforces API and implemented idempotent contest synchronisation using PostgreSQL unique constraints and upserts.
- Implemented authenticated user workflows, role-based authorisation, input validation and API integration tests.
- Deployed the application with a documented architecture and reproducible development setup.

**Important:** Include only bullet points whose features you built, tested and can demonstrate. Do not invent user traffic, latency reductions or deployment achievements.

---

# Part V. Technical interviews: questions and answer cues

Do not memorise these as scripts. Answer using a concrete file, endpoint or query from your own project.

## A. Architecture and REST APIs

1. **Walk me through ContestHub from browser click to database query.**  
   Explain React request, route, validation, auth middleware, service, Prisma, PostgreSQL and JSON response.

2. **Why Express instead of Next.js API routes or NestJS?**  
   Express gave explicit middleware and API learning with minimal framework complexity; it requires more manual structure.

3. **Why did you separate routes, services and database access?**  
   Separation of HTTP concerns, business logic and persistence makes testing and change easier.

4. **What is REST? Why do you use GET, POST, PATCH and DELETE?**  
   Discuss resource operations, safe reads, idempotency and appropriate status codes.

5. **What happens when the frontend receives HTTP 500 or times out?**  
   Explain error boundaries/queries, retriable messages and no fabricated success.

6. **What is the difference between client state and server state?**  
   UI modal state vs asynchronous contest records, loading, caching and invalidation.

7. **Why did you use TypeScript?**  
   Compile-time interfaces help but external JSON still needs runtime validation with Zod.

## B. PostgreSQL and Prisma

8. **Why PostgreSQL over MongoDB?**  
   Natural relationships (users, contests, bookmarks), joins and strong constraints; MongoDB remains valid for document-oriented patterns.

9. **Explain the many-to-many relationship in bookmarks.**  
   User and Contest connect through Bookmark; compound PK prevents duplicate pairs.

10. **What is a foreign key? What happens when a contest is deleted?**  
    Refer to onDelete Cascade and its implications for saved bookmarks.

11. **Why `@@unique([source, externalId])` instead of unique title?**  
    Contest titles can repeat; external source IDs are stable within a platform; combination prevents duplicate imports.

12. **What is an upsert? Why is it useful for your synchroniser?**  
    Insert if missing, update if present; repeated jobs remain idempotent.

13. **Explain an SQL JOIN from your own project.**  
    Show Bookmark JOIN Contest filtered by authenticated user ID.

14. **What is a database index and why not index every column?**  
    Indexes optimise selected lookups/sorts but cost storage and additional work on writes.

15. **What is offset pagination? How is cursor pagination different?**  
    Offset uses LIMIT/OFFSET; cursors use a stable ordered key and perform better for deep pages/high-change feeds.

16. **What are transactions and when would you use them?**  
    All-or-nothing multiple changes; explain consistency in updates that must succeed together.

17. **Does Prisma eliminate the need to know SQL?**  
    No. You still need schema design, JOIN reasoning, indexes and query plan analysis.

## C. Authentication and security

18. **Authentication vs authorisation?**  
    Identity verification vs permission to perform an operation.

19. **Why hash passwords with Argon2 instead of encrypting them?**  
    A password verifier should not store recoverable plaintext; Argon2 deliberately slows guessing.

20. **Why use HttpOnly session cookies instead of localStorage tokens?**  
    HttpOnly reduces JavaScript access to tokens, but cookies require CSRF-conscious design.

21. **Can a user call an admin endpoint directly using Postman?**  
    Yes, any client can call it. Backend middleware must reject USER requests with 403.

22. **How does logout work in a database-backed session system?**  
    Delete/revoke session row, clear cookie and reject subsequent token use.

23. **What attacks did you consider?**  
    SQL injection, credential stuffing, CSRF, XSS, broken access control and secret exposure. Explain actual protections, not slogans.

## D. External API, jobs and scaling

24. **Why not call Codeforces directly from the React app?**  
    Rate limits, upstream reliability, central validation, consistent filtering and caching through your DB.

25. **How do you avoid importing duplicates?**  
    Composite unique constraint plus upsert; frontend checks alone are insufficient under concurrency.

26. **What happens if Codeforces is down?**  
    Sync fails with logs; stored contest data remains available; retry later with controlled backoff.

27. **What is idempotency?**  
    Repeating the same operation produces the same intended stored state; describe repeated imports.

28. **Why use a scheduler rather than refreshing on every page request?**  
    Lower latency, rate-limit compliance and greater resilience at the cost of data freshness.

29. **How would you handle 100,000 contests?**  
    Pagination, relevant indexes, measured query plans, caching if justified, and separating sync workload from API.

30. **If two users bookmark simultaneously, can duplicates occur?**  
    The composite primary key prevents duplicate records for the same user/contest; design appropriate API conflict semantics.

## E. Testing, deployment and ownership

31. **Difference between unit and integration tests?**  
    Unit isolates a function; integration tests API, middleware and database behaviour together.

32. **Which test caught a real bug?**  
    Prepare an actual example from your build and show the failing test plus fix.

33. **What is a database migration?**  
    Versioned schema evolution; use migrate dev locally and migrate deploy in production.

34. **What was the hardest part you implemented without a tutorial?**  
    Pick a real part, such as sessions or idempotent ingestion, and explain debugging decisions.

35. **What would you change if given another month?**  
    Propose measured improvements: better monitoring, cursor pagination, additional approved sources, background workers or accessibility tests.

## F. Three live whiteboard exercises based on ContestHub

**Exercise 1: SQL.** Write a query returning a user's bookmarked contests ordered by start time. Then explain what indexes might help.

**Exercise 2: Algorithm.** Given two sorted lists of contest start times, merge them into one ordered list. State time complexity `O(n + m)` and space complexity of your implementation.

**Exercise 3: Design.** Two synchronisation jobs run simultaneously. Explain how `UNIQUE(source, externalId)` and database upsert prevent duplicate rows; discuss possible last-write-wins updates and how to improve concurrent job coordination.

---

# Part VI. Final self-review and debugging

## 7. Questions to ask before saying a feature is complete

- Can I describe the user action and HTTP request that triggers this code?
- Is the backend validating all data, even if the frontend validates it too?
- Who is authorised to call this endpoint, and where is that enforced?
- What SQL query does this Prisma call approximately represent?
- What happens with an empty result, duplicate, timeout and invalid input?
- Does the code work when run twice?
- Can another developer run the application using the README and `.env.example`?
- Am I claiming only features actually implemented and tested?

## 8. Common mistakes and corrections

| Symptom | Likely cause | What to check |
|---|---|---|
| Prisma cannot connect | Wrong DATABASE_URL or database not running | PostgreSQL host, port, credentials, network, SSL |
| Prisma setup imports fail | Mixed Prisma 7 and 8 guides | CLI/client versions, generated output path, adapter |
| `/api` returns Vite HTML | Proxy not configured | `client/vite.config.ts` proxy target |
| Browser login succeeds but `/me` is anonymous | Cookie not sent or wrong origin | credentials, SameSite, Secure, proxy, CORS |
| Repeated sync duplicates contests | Missing unique key or wrong upsert where | `(source, externalId)` constraint and migration |
| Contest start time off by hours | UTC/local timezone mishandling | Unix seconds * 1000; `Date` storage; local render |
| Upcoming contests vanish | `phase` filter or time comparison wrong | Codeforces response shape and time logic |
| User can change admin data | Backend role checks missing | Actual API middleware, not just hidden buttons |
| Prisma migration differs on deploy | Migrations not committed/applied | Migration files and `prisma migrate deploy` |

## 9. Official references

- **Node.js releases:** https://nodejs.org/en/about/previous-releases
- **Express 5 routing:** https://expressjs.com/en/5x/guide/routing/
- **Express security practices:** https://expressjs.com/en/advanced/best-practice-security/
- **Prisma ORM 7 PostgreSQL quickstart:** https://www.prisma.io/docs/v7/prisma-orm/quickstart/postgresql
- **Prisma migrations:** https://www.prisma.io/docs/orm/v7/prisma-migrate
- **PostgreSQL manual:** https://www.postgresql.org/docs/
- **Codeforces API overview:** https://codeforces.com/apiHelp
- **Codeforces API contest methods:** https://codeforces.com/apiHelp/methods
- **Codeforces contest fields:** https://codeforces.com/apiHelp/objects
- **React:** https://react.dev/
- **Vite:** https://vite.dev/guide/
- **TanStack Query:** https://tanstack.com/query/latest/docs/framework/react/overview
- **OWASP cheat sheets:** https://cheatsheetseries.owasp.org/

---

## Final recommendation

Finish a **small, real, tested system** before adding advanced tools. For your Infosys preparation, the highest-value learning outcomes are: understanding an HTTP request end to end, designing and querying a relational schema, enforcing authorisation in the backend, integrating an external API reliably, preventing duplicates with database constraints, and explaining failures and trade-offs. Keep the coding assessment preparation as your first priority.
