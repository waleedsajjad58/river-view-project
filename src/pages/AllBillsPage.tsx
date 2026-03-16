import { useState, useEffect, useCallback } from 'react'
import { Search } from 'lucide-react'

const ipc = (window as any).ipcRenderer

export default function AllBillsPage() {
    const [bills, setBills] = useState<any[]>([])
    const [search, setSearch] = useState('')
    const [typeFilter, setTypeFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [monthFilter, setMonthFilter] = useState('')

    const load = useCallback(async () => {
        if (!ipc) return
        const data = await ipc.invoke('db:get-all-bills', {
            billType: typeFilter !== 'all' ? typeFilter : undefined,
            status: statusFilter !== 'all' ? statusFilter : undefined,
            billingMonth: monthFilter || undefined,
        })
        setBills(data)
    }, [typeFilter, statusFilter, monthFilter])

    useEffect(() => { load() }, [load])

    const filtered = bills.filter((b: any) => {
        if (!search) return true
        const q = search.toLowerCase()
        return (b.bill_number || '').toLowerCase().includes(q)
            || (b.plot_number || '').toLowerCase().includes(q)
            || (b.owner_name || '').toLowerCase().includes(q)
            || (b.tenant_name || '').toLowerCase().includes(q)
    })

    const statusBadge = (status: string) => {
        const map: Record<string, string> = { unpaid: 'badge-red', partial: 'badge-yellow', paid: 'badge-green', overdue: 'badge-red' }
        return <span className={`badge ${map[status] || ''}`}>{status.toUpperCase()}</span>
    }

    const typeBadge = (type: string) => {
        const map: Record<string, string> = { monthly: 'badge-blue', tenant: 'badge-yellow', special: 'badge-purple' }
        return <span className={`badge ${map[type] || ''}`}>{type}</span>
    }

    const totalBilled = filtered.reduce((s, b) => s + (b.total_amount || 0), 0)
    const totalCollected = filtered.reduce((s, b) => s + (b.amount_paid || 0), 0)
    const totalOutstanding = filtered.reduce((s, b) => s + (b.balance_due || 0), 0)

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>All Bills</h1>
                    <p className="subtitle">Unified accounting oversight — {filtered.length} bills</p>
                </div>
            </div>

            <div className="all-bills-filters">
                <div className="search-box">
                    <Search size={16} />
                    <input type="text" placeholder="Search bill #, plot, owner, tenant..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                    <option value="all">All Types</option>
                    <option value="monthly">Monthly</option>
                    <option value="tenant">Tenant</option>
                    <option value="special">Special</option>
                </select>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                    <option value="all">All Status</option>
                    <option value="unpaid">Unpaid</option>
                    <option value="partial">Partial</option>
                    <option value="paid">Paid</option>
                    <option value="overdue">Overdue</option>
                </select>
                <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="month-input" />
            </div>

            <div className="billing-summary">
                <div className="summary-item">
                    <span className="summary-label">Total Billed</span>
                    <span className="summary-value">Rs. {totalBilled.toLocaleString()}</span>
                </div>
                <div className="summary-item">
                    <span className="summary-label">Collected</span>
                    <span className="summary-value text-green">Rs. {totalCollected.toLocaleString()}</span>
                </div>
                <div className="summary-item">
                    <span className="summary-label">Outstanding</span>
                    <span className="summary-value text-red">Rs. {totalOutstanding.toLocaleString()}</span>
                </div>
            </div>

            <table className="data-table">
                <thead>
                    <tr>
                        <th>Bill #</th><th>Type</th><th>Plot</th><th>Owner/Tenant</th><th>Month</th>
                        <th>Total</th><th>Paid</th><th>Balance</th><th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {filtered.length === 0 ? (
                        <tr><td colSpan={9} className="empty-row">No bills match your filters.</td></tr>
                    ) : filtered.map((b: any) => (
                        <tr key={b.id}>
                            <td>{b.bill_number}</td>
                            <td>{typeBadge(b.bill_type)}</td>
                            <td>{b.plot_number}</td>
                            <td>{b.owner_name || b.tenant_name || <span className="text-muted">N/A</span>}</td>
                            <td>{b.billing_month || '-'}</td>
                            <td>Rs. {(b.total_amount || 0).toLocaleString()}</td>
                            <td>Rs. {(b.amount_paid || 0).toLocaleString()}</td>
                            <td>Rs. {(b.balance_due || 0).toLocaleString()}</td>
                            <td>{statusBadge(b.status)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
