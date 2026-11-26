import type { Contest } from './contests'

const dateTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
})
const statusLabel = { upcoming: 'Upcoming', live: 'Live', ended: 'Ended' }

export function ContestLabels({ contest }: { contest: Contest }) {
  return (
    <div className="contest-labels">
      <span className="source-label">{contest.source === 'CODEFORCES' ? 'Codeforces' : 'Curated'}</span>
      <span className={`status status--${contest.status}`}>{statusLabel[contest.status]}</span>
    </div>
  )
}

export function ContestSchedule({ contest }: { contest: Contest }) {
  const minutes = contest.endsAt
    ? Math.round((Date.parse(contest.endsAt) - Date.parse(contest.startsAt)) / 60_000)
    : null
  const duration = minutes === null || minutes < 0 ? '' :
    [Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h` : '', minutes % 60 ? `${minutes % 60}m` : ''].filter(Boolean).join(' ') || '<1m'

  return (
    <dl className="schedule">
      <div>
        <dt>Starts</dt>
        <dd><time dateTime={contest.startsAt}>{dateTime.format(new Date(contest.startsAt))}</time></dd>
      </div>
      {duration && <div><dt>Duration</dt><dd>{duration}</dd></div>}
    </dl>
  )
}

export function OrganiserLink({ contest }: { contest: Contest }) {
  const url = URL.canParse(contest.sourceUrl) ? new URL(contest.sourceUrl) : null
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null

  return (
    <a className="organiser-link" href={url.href} target="_blank" rel="noopener noreferrer">
      {contest.source === 'CODEFORCES' ? 'View on Codeforces' : 'View organiser site'}
      <span aria-hidden="true"> ↗</span>
    </a>
  )
}
