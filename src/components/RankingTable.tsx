import type { RankSortKey, RankedSite } from '../lib/astro/ranking'
import type { LunarSite } from '../lib/astro/types'
import { formatDuration, formatPercent } from '../lib/format'

interface Props {
  rows: RankedSite[]
  sortBy: RankSortKey
  onSort: (key: RankSortKey) => void
  onSelect: (site: LunarSite) => void
}

const COLUMNS: { key: RankSortKey | null; label: string }[] = [
  { key: 'sunlitPct', label: 'Sunlight %' },
  { key: 'commPct', label: 'Earth link %' },
  { key: 'jointPct', label: 'Both %' },
  { key: 'longestCommMs', label: 'Longest Earth link' },
  { key: null, label: 'Longest sunlight' },
]

export default function RankingTable({ rows, sortBy, onSort, onSelect }: Props) {
  return (
    <div className="ranking-wrap">
      <table className="ranking-table">
        <thead>
          <tr>
            <th className="site-head">Site</th>
            {COLUMNS.map((col) =>
              col.key ? (
                <th
                  key={col.label}
                  className={`sortable${sortBy === col.key ? ' sorted' : ''}`}
                  onClick={() => onSort(col.key as RankSortKey)}
                  aria-sort={sortBy === col.key ? 'descending' : 'none'}
                  title={`Sort by ${col.label}`}
                >
                  {col.label}
                  {sortBy === col.key && <span className="sort-arrow">↓</span>}
                </th>
              ) : (
                <th key={col.label}>{col.label}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
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
              <td className="mono sun-text">{formatPercent(row.metrics.sunlitPct)}</td>
              <td className="mono earth-text">{formatPercent(row.metrics.commPct)}</td>
              <td className="mono">{formatPercent(row.metrics.jointPct)}</td>
              <td className="mono">{formatDuration(row.metrics.longestCommMs)}</td>
              <td className="mono muted-cell">{formatDuration(row.metrics.longestSunlitMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
