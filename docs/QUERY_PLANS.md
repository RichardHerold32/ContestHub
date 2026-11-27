# Stage 9 · ContestHub SQL and query plans

## How the API queries map to SQL

The contest service uses `findMany` to fetch one slice and `count` to compute the matching total. Prisma's `where`, `orderBy`, `take`, and `skip` correspond to `WHERE`, `ORDER BY`, `LIMIT`, and `OFFSET`. This is the equivalent PostgreSQL for an upcoming page with all filters supplied. The API omits the corresponding predicate when an optional filter is absent. [Contest service](../server/src/services/contests.ts)

~~~sql
SELECT c."id", c."title", c."description", c."category", c."source",
       c."startsAt", c."endsAt", c."sourceUrl"
FROM "Contest" AS c
WHERE c."isPublished" = TRUE
  AND c."startsAt" > $1
  AND c."category" = $2
  AND c."source" = $3
  AND c."title" ILIKE $4
ORDER BY c."startsAt" ASC, c."id" ASC
LIMIT $5 OFFSET $6;

SELECT COUNT(*)
FROM "Contest" AS c
WHERE c."isPublished" = TRUE
  AND c."startsAt" > $1
  AND c."category" = $2
  AND c."source" = $3
  AND c."title" ILIKE $4;
~~~

`$1` is the request's reference time. `$4` is the bound search pattern, such as `%round%`. Prisma sends values separately from the SQL statement, so punctuation in a search string is treated as data. The service separately escapes `%`, `_`, and backslash in the user's search text because PostgreSQL interprets those characters inside a pattern even when the pattern is bound safely.

With the default sort, the service counts upcoming rows with `"startsAt" > $1` and started rows with `"startsAt" <= $1`. It takes the upcoming slice first in ascending start order and fills any remaining slots from the started slice in descending start order. Explicit start-time sorting applies one ordering across all matches. Both paths use the ID as a tie-breaker. A repeatable-read transaction keeps the rows and counts in the same snapshot for one response.

The bookmark service uses a nested relation selection in `findMany`. The following inner join gives the same rows. Prisma can fetch nested data in multiple statements depending on its relation-loading strategy. `$1` comes from the authenticated session. The join pairs each bookmark with the contest whose ID matches its foreign key. The filter keeps only the current user's published contests. [Bookmark service](../server/src/services/bookmarks.ts) · [Prisma 7 relation queries](https://www.prisma.io/docs/orm/v7/prisma-client/queries/relation-queries)

~~~sql
SELECT b."createdAt" AS "savedAt", c."id", c."title", c."description",
       c."category", c."source", c."startsAt", c."endsAt", c."sourceUrl"
FROM "Bookmark" AS b
JOIN "Contest" AS c ON c."id" = b."contestId"
WHERE b."userId" = $1 AND c."isPublished" = TRUE
ORDER BY b."createdAt" DESC, b."contestId" ASC;
~~~

## Run the lab

Use Node 24 and the same local PostgreSQL `DATABASE_URL` and `CREATEDB` permission as the server integration tests. From the repository root in PowerShell, run the following.

~~~powershell
$env:CONTESTHUB_QUERY_LAB = '1'
try {
  npm.cmd --prefix server test -- query-plans --disableConsoleIntercept
} finally {
  Remove-Item Env:CONTESTHUB_QUERY_LAB
}

npm.cmd --prefix server test
~~~

The opt-in lab applies the real migrations in a disposable local database, inserts 10,000 synthetic contests, and adds 25 saves for one user and 501 for another. Contest start times, publication states, and title matches are repeatable, including tied start times. `ANALYZE` refreshes planner statistics. The lab runs six equivalent read queries using `EXPLAIN (ANALYZE, BUFFERS)` and removes the disposable database afterward. The Vitest flag makes the full plans visible in the terminal. [Query-plan lab](../server/test/query-plans.test.ts)

## What PostgreSQL did in one local run

Read a plan from its scan nodes up through joins, sorts, and limits. Compare estimated rows with actual rows and check the number of loops. A buffer hit is a page already in PostgreSQL's shared buffers. A buffer read is a page loaded into those buffers, which can still come from the operating system's cache. Parent buffer counts include work below them. Planner cost is a relative estimate. Execution time is a measurement from one run and varies with the data, statistics, cache, and machine. [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/18/using-explain.html)

These measurements are from PostgreSQL 18. The buffers were warm and the execution nodes reported shared hits with zero shared reads.

| Query | Observed work | Shared hits | Execution time |
|---|---|---:|---:|
| First upcoming page | Start-time index scan and incremental sort yielded 12 rows to the limit | 4 | 0.099 ms |
| Upcoming page 301 | Same index and sort yielded 3,612 rows to the limit | 88 | 2.417 ms |
| Category and 14-day range | Start-time index narrowed the range, then the filter discarded 377 rows | 12 | 0.170 ms |
| Substring page | Date index supplied candidates, then the filter discarded 616 rows before the limit was satisfied | 17 | 0.248 ms |
| Substring count | Date index supplied 4,996 candidates. The filter kept 104 and the aggregate returned one count row | 108 | 1.598 ms |
| Bookmark join | A bitmap scan found 25 bookmarks. A nested loop looked up 25 contest IDs and returned 20 published contests | 78 | 0.137 ms |

The deep-page output shows where those extra rows went. `Limit` returned 12 rows after consuming 3,612 from the sort. The index provided the first sort key, so the incremental sort could finish ordering rows by ID within groups of start times.

~~~text
Limit  (cost=279.57..280.51 rows=12 width=123) (actual time=2.383..2.385 rows=12.00 loops=1)
  Buffers: shared hit=88
  ->  Incremental Sort  (cost=0.39..349.22 rows=4498 width=123) (actual time=0.045..2.265 rows=3612.00 loops=1)
        Sort Key: "startsAt", id
        Presorted Key: "startsAt"
        …
Execution Time: 2.417 ms
~~~

The substring plan shows the time comparison under `Index Cond` and the title match under `Filter`. PostgreSQL displays case-insensitive `LIKE` as `~~*`. The count has no page limit and must filter every candidate in the indexed range.

~~~text
Index Cond: ("startsAt" > '2026-12-01 12:00:00'::timestamp without time zone)
Filter: ("isPublished" AND (title ~~* '%dynamic programming%'::text))
Rows Removed by Filter: 4892
~~~

The category query also chose the start-time index in this fixture. The planner estimated a lower cost for that path with this data and limit. That choice can change with a different category distribution, time range, or row order on disk.

## What the trade-offs mean for ContestHub

- **Pagination.** `LIMIT 12 OFFSET 0` returns the first page. Page 301 uses `OFFSET 3600` and PostgreSQL must produce enough ordered results to skip those rows before it returns 12. The ID tie-breaker resolves ties in each snapshot. Inserts or updates between requests can still shift page boundaries. [PostgreSQL LIMIT and OFFSET](https://www.postgresql.org/docs/18/queries-limit.html)
- **Indexes.** The B-tree on `"startsAt"` can help with a time range and with start-time ordering. The index on `("category", "startsAt")` is useful when the query fixes the category and then applies a time range. PostgreSQL can prefer a sequential scan when it expects to read much of the table. A leading wildcard in `ILIKE '%term%'` generally rules out a direct lookup using a normal B-tree. A date index can still narrow or order candidates before the title filter runs. Each index takes storage and adds maintenance work on writes. [PostgreSQL index types](https://www.postgresql.org/docs/18/indexes-types.html)
- **Constraints.** The unique `("source", "externalId")` pair gives each imported contest one identity per source. The bookmark primary key `("userId", "contestId")` gives each user one save per contest and supports lookups by its leading user column. PostgreSQL enforces these constraints even when two requests write concurrently.

**Interview question.** If the first page is fast, why can the same filtered query slow down on page 301 even though it still returns 12 rows?
