import { useState, useMemo } from 'react'
import { Search, ChevronUp, ChevronDown } from 'lucide-react'

interface Column {
    key: string
    label: string
    sortable?: boolean
    render?: (value: any, row: any) => React.ReactNode
}

interface DataTableProps {
    columns: Column[]
    data: any[]
    searchKeys?: string[]
    onRowClick?: (row: any) => void
    emptyMessage?: string
}

export default function DataTable({ columns, data, searchKeys = [], onRowClick, emptyMessage = 'No data found' }: DataTableProps) {
    const [search, setSearch] = useState('')
    const [sortKey, setSortKey] = useState('')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

    const filtered = useMemo(() => {
        let result = data
        if (search && searchKeys.length > 0) {
            const q = search.toLowerCase()
            result = result.filter(row => searchKeys.some(k => String(row[k] || '').toLowerCase().includes(q)))
        }
        if (sortKey) {
            result = [...result].sort((a, b) => {
                const av = a[sortKey] ?? '', bv = b[sortKey] ?? ''
                const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
                return sortDir === 'asc' ? cmp : -cmp
            })
        }
        return result
    }, [data, search, searchKeys, sortKey, sortDir])

    const toggleSort = (key: string) => {
        if (sortKey === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc') }
        else { setSortKey(key); setSortDir('asc') }
    }

    return (
        <div className="data-table-wrapper">
            {searchKeys.length > 0 && (
                <div className="table-toolbar">
                    <div className="search-box">
                        <Search size={16} />
                        <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
                    </div>
                </div>
            )}
            <div className="table-scroll">
                <table className="data-table">
                    <thead>
                        <tr>
                            {columns.map(col => (
                                <th key={col.key} onClick={() => col.sortable !== false && toggleSort(col.key)}
                                    className={col.sortable !== false ? 'sortable' : ''}>
                                    <span>{col.label}</span>
                                    {sortKey === col.key && (sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 ? (
                            <tr><td colSpan={columns.length} className="empty-row">{emptyMessage}</td></tr>
                        ) : (
                            filtered.map((row, i) => (
                                <tr key={row.id || i} onClick={() => onRowClick?.(row)} className={onRowClick ? 'clickable' : ''}>
                                    {columns.map(col => (
                                        <td key={col.key}>{col.render ? col.render(row[col.key], row) : row[col.key]}</td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
