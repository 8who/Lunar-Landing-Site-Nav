import type { RankSortKey, RankedSite } from '../lib/astro/ranking'
import type { LunarSite } from '../lib/astro/types'
import { formatDuration, formatPercent } from '../lib/format'
import type { ResourceRow } from '../lib/resources/minerals'

interface Props {
  rows: RankedSite[]
  resourceById?: Map<string, ResourceRow>
  resourceLabel?: string
  resourceLoading?: boolean
  sortResource?: boolean
  onSortResource?: () => void
  sortBy: RankSortKey
  onSort: (key: RankSortKey) => void
  onSelect: (site: LunarSite) => void
}

const COLUMNS: { key: RankSortKey | null; label: string }[] = [
  { key: 'sunlitPct', label: 'Sunlight %' },
  { key: 'commPct', label: 'Earth geometric visibility %' },
  { key: 'jointPct', label: 'Both %' },
  { key: 'meanTrackingIncidence', label: 'Estimated solar flux' },
  { key: 'longestCommMs', label: 'Longest Earth visibility' },
  { key: null, label: 'Longest sunlight' },
]

export default function RankingTable({ rows, sortBy, onSort, onSelect, resourceById, resourceLabel, resourceLoading, sortResource, onSortResource }: Props) {
  const sortedRows = sortResource && resourceById?.size ? [...rows].sort((a, b) => (resourceById.get(b.site.id)?.score ?? -1) - (resourceById.get(a.site.id)?.score ?? -1)) : rows
  return (
    <div className="ranking-wrap">
      <table className="ranking-table">
        <caption>{resourceById?.size ? `Resource-adjusted planning score for ${resourceLabel}. Select a column heading to sort.` : 'Operational comparison of landing sites.'}</caption>
        <thead>
          <tr>
            <th className="site-head">Site</th>
            {resourceById && <th scope="col" aria-sort={sortResource ? 'descending' : 'none'}><button type="button" onClick={onSortResource}>Resource score {sortResource ? '↓' : ''}</button></th>}
            {COLUMNS.map((col) =>
              col.key ? (
                <th
                  key={col.label}
                  className={`sortable${!sortResource && sortBy === col.key ? ' sorted' : ''}`}
                  onClick={() => onSort(col.key as RankSortKey)}
                  aria-sort={!sortResource && sortBy === col.key ? 'descending' : 'none'}
                  title={`Sort by ${col.label}`}
                >
                  {col.label}
                  {!sortResource && sortBy === col.key && <span className="sort-arrow">↓</span>}
                </th>
              ) : (
                <th key={col.label}>{col.label}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => (
            <tr
              key={row.site.id}
              onClick={() => onSelect(row.site)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(row.site)
                }
              }}
            >
              <td>
                <div className="site-cell">
                  <span>
                    <span className="rank-pos">{i + 1}</span>
                    {row.site.name}
                  </span>
                  <small>
                    {row.site.lat.toFixed(1)}° lat · {row.site.lon.toFixed(1)}° lon
                  </small>
                </div>
              </td>
              {resourceById && <td className="mono" title={resourceById.get(row.site.id)?.reasons.join('; ') || 'Combined mineral and simultaneous visibility planning score'}>{resourceLoading ? 'Loading…' : resourceById.get(row.site.id)?.score == null ? '—' : `${resourceById.get(row.site.id)!.score!.toFixed(1)} / 100`}</td>}
              <td className="mono sun-text">{formatPercent(row.metrics.sunlitPct)}</td>
              <td className="mono earth-text" title="Earth’s disc clears the modeled local terrain skyline; DSN station availability and the communications link budget are not included.">{formatPercent(row.metrics.commPct)}</td>
              <td className="mono">{formatPercent(row.metrics.jointPct)}</td>
              <td className="mono sun-text" title="Idealized incident solar flux per square metre. Panel area, conversion, storage, loads and thermal limits are not modeled.">
                {Math.round(row.metrics.meanTrackingFluxWm2)} W/m²
              </td>
              <td className="mono">{formatDuration(row.metrics.longestCommMs)}</td>
              <td className="mono muted-cell">{formatDuration(row.metrics.longestSunlitMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
