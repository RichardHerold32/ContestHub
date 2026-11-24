# ContestHub architecture

## System overview

```text
React browser app
    ↓ HTTPS /api/*                        ↑ JSON response
Express route → validation and access checks → service
    ↓                                        ↑
Prisma Client with PostgreSQL adapter ↔ PostgreSQL

Backend import command → Codeforces API
                       ← contest data
       ↓ validate, normalise, and upsert via Prisma
    PostgreSQL
```

The frontend uses React, Vite, TypeScript, Tailwind CSS, React Router, and TanStack Query. The backend runs on Node.js 24 LTS with Express 5 and Zod. Prisma ORM 7 uses its PostgreSQL adapter to connect to the database. Argon2 hashes passwords. Vitest and Supertest cover backend behaviour. In development, Vite forwards `/api` requests to Express. In production, the preferred layout serves the UI and proxies `/api` through one HTTPS origin.

## Request lifecycle

### Search for a contest

1. Explore reads the search and filters from the browser URL. TanStack Query requests `GET /api/contests` with those parameters and tracks loading, success, and errors.
2. Express routes the request to the contest endpoint. Zod validates the incoming query at runtime. For example, an invalid page produces a `400` before a database query runs. Valid public reads require no session.
3. The service builds the database query through Prisma. PostgreSQL filters for published rows that match the search and filters, orders them consistently with the nearest upcoming starts first, and returns one page. A matching count supplies pagination metadata. Conceptually, this uses SQL `WHERE`, `ORDER BY`, `LIMIT`, and `OFFSET`.
4. Express returns contest data and pagination as JSON. React renders the results and formats the returned UTC timestamps for the viewer’s timezone. The browser only needs the HTTP API to read the catalogue.

The planned list parameters are search, category, source, upcoming status, page, and limit. Pagination defaults to page 1 and 12 items, with a maximum limit of 50.

### Save a bookmark

Login verifies the password against its Argon2 hash. Express issues a random token in an `HttpOnly` session cookie and stores the token’s hash and expiry in PostgreSQL. On a protected request, middleware hashes the cookie token, looks up a valid session, and identifies its user. This is **authentication**. Checking whether that user may manage a curated listing is **authorisation**. Logout revokes the database session and clears the cookie.

When React sends `POST /api/me/bookmarks`, the service takes the user ID from the session and the contest ID from the validated request. Prisma writes the relationship in PostgreSQL. A bookmark links one `User` row and one `Contest` row. Foreign keys ensure both exist, and the composite primary key `(userId, contestId)` ensures a repeated or concurrent save leaves one row. To list saved contests, the API can join bookmarks for the current user to the corresponding contests.

## Codeforces ingestion

1. An operator runs the backend import command. The job fetches the Codeforces contest list with a timeout and checks both the HTTP response and the API’s reported status.
2. The job validates the data, keeps upcoming contests with valid start times, and converts Unix seconds to UTC timestamps. It maps each record to the catalogue fields and derives its organiser link from the Codeforces contest ID.
3. Prisma upserts each record using the database constraint on `(source, externalId)`. An upsert inserts a new row or updates the existing row for that key. Keeping the same contest row preserves its bookmark relationships when source data changes. The admin editor manages curated rows, whose external IDs are generated on the server.
4. The job reports the outcome in logs. If Codeforces times out or returns a failure, previously stored rows remain available through the public API. Browse requests read PostgreSQL independently of the importer.

## Proposed REST API

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | Public | Check that the API responds. |
| `GET` | `/api/contests` | Public | Search, filter, and paginate published contests. |
| `GET` | `/api/contests/:id` | Public | Read one published contest. |
| `POST` | `/api/auth/register` | Public | Create an ordinary user account. |
| `POST` | `/api/auth/login` | Public | Validate credentials and issue a session cookie. |
| `POST` | `/api/auth/logout` | Session | Revoke the current session and clear the cookie. |
| `GET` | `/api/auth/me` | Session | Read the current user’s identity and role. |
| `GET` | `/api/me/bookmarks` | Signed-in `USER` or `ADMIN` | List the session user’s bookmarks. |
| `POST` | `/api/me/bookmarks` | Signed-in `USER` or `ADMIN` | Save the contest identified by `contestId`. |
| `DELETE` | `/api/me/bookmarks/:contestId` | Signed-in `USER` or `ADMIN` | Remove the session user’s bookmark. |
| `GET` | `/api/admin/contests` | `ADMIN` | List curated contests, including unpublished records. |
| `POST` | `/api/admin/contests` | `ADMIN` | Create a curated contest. |
| `PATCH` | `/api/admin/contests/:id` | `ADMIN` | Edit, publish, or unpublish a curated contest. |

Return `400` for invalid input, `401` when a protected request lacks a valid session, `403` when an authenticated user lacks permission, and `404` for missing or unpublished public contest details. The import is a backend command.

## Trade-offs

| Decision | Benefit and cost |
|---|---|
| Separate React and Express apps | Makes the HTTP boundary visible and lets API tests run independently of React. Development and deployment both need proxy configuration. |
| TanStack Query for server data | Handles loading, caching, retry, and refreshing after writes. It adds a cache whose keys and invalidation rules must match the API requests. |
| PostgreSQL with Prisma 7 | The database enforces relationships and uniqueness, and Prisma provides typed queries and migrations. The project still requires explicit schema changes and an understanding of the SQL those queries represent. |
| Offset pagination | Supports simple page numbers for a small catalogue. Deep pages cost more to fetch, and inserts can shift which records appear on adjacent pages. |
| Database sessions | A database row can be revoked immediately, at the cost of a lookup on protected requests. Cookies require HTTPS in production, appropriate cookie settings, and CSRF protection for writes through same-origin deployment and Origin validation. |
| Manual import and local reads | A Codeforces outage can leave the catalogue stale while users continue browsing. A manual command keeps the first delivery simple, and freshness depends on when the operator last ran it successfully. |

## Decisions for later stages

- **Stage 7.** Decide whether saving an existing bookmark returns idempotent success or `409 Conflict`. Either contract must preserve one row per user and contest.
- **Stage 12.** Select deployment providers and confirm support for the same-origin `/api` proxy. A separate API origin requires explicit cookie, CORS, and CSRF configuration.

See the [product requirements](PRD.md) and [build guide](ContestHub_Build_Guide.md).
