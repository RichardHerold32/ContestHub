import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ContestLabels, ContestSchedule, OrganiserLink } from './ContestSummary'
import { ApiError } from './api'
import { AdminContestsPage } from './AdminContests'
import { AuthPage, SessionNav } from './AuthPage'
import { BookmarksPage, ContestBookmark } from './Bookmarks'
import { contestDetailQuery, contestListQuery, filterParams, readFilters } from './contests'
import type { Filters } from './contests'

function SearchFields({ filters, apply }: { filters: Filters; apply: (patch: Partial<Filters>) => void }) {
  return (
    <form className="search-form" role="search" onSubmit={(event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      apply({ search: String(form.get('search')).trim(), category: String(form.get('category')).trim() })
    }}>
      <div className="filter-field search-field">
        <label htmlFor="contest-search">Search contests</label>
        <input key={filters.search} id="contest-search" name="search" type="search" defaultValue={filters.search} placeholder="Search by contest title" />
      </div>
      <div className="filter-field">
        <label htmlFor="contest-category">Category</label>
        <input key={filters.category} id="contest-category" name="category" list="categories" defaultValue={filters.category} placeholder="All categories" />
        <datalist id="categories"><option value="CODING" /></datalist>
      </div>
      <button className="button button--primary" type="submit">Search</button>
    </form>
  )
}

function LoadingResults() {
  return (
    <div role="status">
      <span className="sr-only">Loading contests…</span>
      <div className="contest-grid" aria-hidden="true">
        {[1, 2, 3].map((item) => <div className="skeleton" key={item}><i /><i /><i /></div>)}
      </div>
    </div>
  )
}

function LoadError({ retry, fetching, cached, subject }: {
  retry: () => void; fetching: boolean; cached: boolean; subject: string
}) {
  return (
    <div className="notice notice--error">
      <p role="alert">{cached ? `Could not refresh ${subject}. Showing the last loaded data.` : `Could not load ${subject}.`}</p>
      <button className="button" type="button" onClick={retry} disabled={fetching}>
        {fetching ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  )
}

function pageUrl(filters: Filters, page: number) {
  const params = filterParams({ ...filters, page }).toString()
  return params ? `/?${params}` : '/'
}

function Browse() {
  const [params, setParams] = useSearchParams()
  const filters = readFilters(params)
  const query = useQuery(contestListQuery(filters))
  const hasFilters = Boolean(filters.search || filters.category || filters.source || filters.upcoming)
  const listParams = filterParams(filters).toString()
  const detailSearch = listParams ? `?${listParams}` : ''

  function apply(patch: Partial<Filters>) {
    setParams(filterParams({ ...filters, ...patch, page: 1 }))
  }

  const data = query.data
  return (
    <>
      <section className="intro">
        <h1>Explore contests</h1>
        <p>Find programming contests and check when they start in your time zone.</p>
      </section>
      <section className="filters" aria-label="Contest filters">
        <SearchFields filters={filters} apply={apply} />
        <div className="select-filters">
          <div className="filter-field">
            <label htmlFor="contest-source">Source</label>
            <select id="contest-source" value={filters.source} onChange={(event) => apply({ source: event.target.value as Filters['source'] })}>
              <option value="">All sources</option>
              <option value="CODEFORCES">Codeforces</option>
              <option value="MANUAL">Curated</option>
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="contest-timing">Timing</label>
            <select id="contest-timing" value={filters.upcoming} onChange={(event) => apply({ upcoming: event.target.value as Filters['upcoming'] })}>
              <option value="">All contests</option>
              <option value="true">Upcoming</option>
              <option value="false">Started</option>
            </select>
          </div>
          <div className="filter-field sort-field">
            <label htmlFor="contest-sort">Sort by</label>
            <select id="contest-sort" value={filters.sort} onChange={(event) => apply({ sort: event.target.value as Filters['sort'] })}>
              <option value="">Upcoming first</option>
              <option value="start-asc">Start time · oldest first</option>
              <option value="start-desc">Start time · newest first</option>
            </select>
          </div>
          {hasFilters && <Link className="clear-filters" to={pageUrl({ ...readFilters(new URLSearchParams()), sort: filters.sort }, 1)}>Clear filters</Link>}
        </div>
      </section>
      <section className="results" aria-labelledby="results-heading">
        <div className="results-header">
          <h2 id="results-heading">Contests</h2>
          <span role="status">
            {data && `${data.pagination.total} ${data.pagination.total === 1 ? 'contest' : 'contests'}`}
            {data && query.isFetching && ' · Refreshing…'}
          </span>
        </div>
        {query.isPending && <LoadingResults />}
        {query.isError && <LoadError retry={() => void query.refetch()} fetching={query.isFetching} cached={Boolean(data)} subject="contests" />}
        {data && data.items.length === 0 && (
          <div className="notice">
            {filters.page > Math.max(1, data.pagination.totalPages) ? (
              <><h3>This page is out of range.</h3><Link to={pageUrl(filters, Math.max(1, data.pagination.totalPages))}>Go to the last available page</Link></>
            ) : hasFilters ? (
              <><h3>No contests match your filters.</h3><p>Try a different search or clear the filters above.</p></>
            ) : (
              <><h3>No contests available yet.</h3><p>Check back after new contests are published.</p></>
            )}
          </div>
        )}
        {data && data.items.length > 0 && (
          <ul className="contest-grid">
            {data.items.map((contest) => (
              <li key={contest.id} className="contest-card">
                <ContestLabels contest={contest} />
                <h3><Link to={{ pathname: `/contests/${encodeURIComponent(contest.id)}`, search: detailSearch }}>{contest.title}</Link></h3>
                <p className="category">{contest.category}</p>
                <ContestSchedule contest={contest} />
                <OrganiserLink contest={contest} />
              </li>
            ))}
          </ul>
        )}
        {data && data.items.length > 0 && data.pagination.totalPages > 1 && (
          <nav className="pagination" aria-label="Contest pages">
            {filters.page > 1
              ? <Link className="button" to={pageUrl(filters, filters.page - 1)}>Previous</Link>
              : <button className="button" disabled>Previous</button>}
            <span>Page {filters.page} of {data.pagination.totalPages}</span>
            {filters.page < data.pagination.totalPages
              ? <Link className="button" to={pageUrl(filters, filters.page + 1)}>Next</Link>
              : <button className="button" disabled>Next</button>}
          </nav>
        )}
      </section>
    </>
  )
}

function Detail({ id }: { id: string }) {
  const [params] = useSearchParams()
  const filters = readFilters(params)
  const query = useQuery(contestDetailQuery(id))
  const missing = query.error instanceof ApiError && query.error.status === 404
  const contest = query.data

  return (
    <>
      <Link className="back-link" to={pageUrl(filters, filters.page)}>← Back to contests</Link>
      {query.isPending && <p role="status">Loading contest…</p>}
      {missing ? (
        <div className="notice"><h1>Contest not found</h1><p>It may no longer be published.</p></div>
      ) : (
        <>
          {query.isError && <LoadError retry={() => void query.refetch()} fetching={query.isFetching} cached={Boolean(contest)} subject="the contest" />}
          {contest && (
            <article className="detail">
              <ContestLabels contest={contest} />
              <h1>{contest.title}</h1>
              <p className="category">{contest.category}</p>
              <ContestSchedule contest={contest} />
              {contest.description && <p className="description">{contest.description}</p>}
              <div className="detail-actions">
                <OrganiserLink contest={contest} />
                <ContestBookmark key={contest.id} contest={contest} />
              </div>
            </article>
          )}
        </>
      )}
    </>
  )
}

function DetailRoute() {
  const { id } = useParams()
  return id ? <Detail id={id} /> : <PageNotFound />
}

function PageNotFound() {
  return <div className="notice"><h1>Page not found</h1><Link to="/">Browse contests</Link></div>
}

export default function App() {
  const { pathname } = useLocation()
  const previousPathname = useRef(pathname)
  const main = useRef<HTMLElement>(null)

  useEffect(() => {
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname
      main.current?.focus({ preventScroll: true })
      window.scrollTo(0, 0)
    }
  }, [pathname])

  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="site-header">
        <div className="shell header-content">
          <Link className="brand" to="/"><span aria-hidden="true" className="brand-mark">&gt;_</span>ContestHub</Link>
          <SessionNav />
        </div>
      </header>
      <main className="shell main" id="main" ref={main} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Browse />} />
          <Route path="/contests/:id" element={<DetailRoute />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/bookmarks" element={<BookmarksPage />} />
          <Route path="/admin/contests" element={<AdminContestsPage />} />
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </main>
    </>
  )
}
