import { useState, useEffect, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { TrendingDown, TrendingUp, AlertCircle, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const ipc = (window as any).ipcRenderer
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ── Recharts tooltip — matches the white theme ──────────────
function BarTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null
    return (
        <div style={{
            background: '#fff', border: '1px solid #e4e4e7',
            borderRadius: 4, padding: '8px 12px',
            boxShadow: '0 2px 6px rgba(0,0,0,.08)', fontSize: 12
        }}>
            <div style={{ color: '#6b7280', fontFamily: 'IBM Plex Mono', marginBottom: 3 }}>{label}</div>
            <div style={{ color: '#111', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
                Rs. {(payload[0]?.value || 0).toLocaleString()}
            </div>
        </div>
    )
}

interface Props { user: any }

export default function DashboardPage({ user }: Props) {
    const nav = useNavigate()
    const [stats, setStats] = useState<any>({})
    const [chart, setChart] = useState<any[]>([])
    const [def, setDef] = useState<any[]>([])
    const [expenses, setExpenses] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    const now = new Date()
    const yr = now.getFullYear().toString()
    const curM = now.getMonth()

    const load = useCallback(async () => {
        if (!ipc) return
        try {
            const [s, coll, defaulters, exps] = await Promise.all([
                ipc.invoke('db:get-dashboard-stats'),
                ipc.invoke('db:report-collection-summary', { year: yr }),
                ipc.invoke('db:report-defaulters'),
                ipc.invoke('db:get-expenditures', {
                    startDate: `${yr}-01-01`,
                    endDate: `${yr}-12-31`
                }),
            ])
            setStats(s)
            // build 12-bar data
            const map: Record<string, number> = {}
            for (const r of coll) map[r.month] = r.total
            setChart(MO.map((m, i) => ({
                month: m,
                amt: map[`${yr}-${String(i + 1).padStart(2, '0')}`] || 0
            })))
            setDef(defaulters.slice(0, 8))
            setExpenses(exps.slice(0, 6))
        } catch (e) { console.error(e) }
        finally { setLoading(false) }
    }, [yr])

    useEffect(() => { load() }, [load])

    const thisM = chart[curM]?.amt || 0
    const lastM = chart[Math.max(0, curM - 1)]?.amt || 0
    const delta = lastM > 0 ? ((thisM - lastM) / lastM * 100) : null

    // ── date header string ───────────────────────────────────
    const dateStr = now.toLocaleDateString('en-PK', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    })
    const greeting = now.getHours() < 12 ? 'Morning' : now.getHours() < 17 ? 'Afternoon' : 'Evening'

    // ── status bar chart — which months have >= 80% collection ──
    const maxAmt = Math.max(...chart.map(c => c.amt), 1)

    return (
        <div className="page">

            {/* ── Page header ── */}
            <div style={{ marginBottom: 28 }}>
                <div style={{
                    fontSize: 11, fontFamily: 'IBM Plex Mono', color: 'var(--t-faint)',
                    letterSpacing: '0.04em', marginBottom: 5, textTransform: 'uppercase'
                }}>
                    {dateStr}
                </div>
                <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--t-primary)', letterSpacing: '-0.025em', marginBottom: 2 }}>
                    {greeting}, {user?.display_name || 'Admin'}
                </h1>
                <p style={{ fontSize: 12.5, color: 'var(--t-faint)' }}>
                    River View Co-operative Housing Society &mdash;&nbsp;
                    {stats.totalPlots || '—'} plots &middot; {stats.totalMembers || '—'} members
                </p>
            </div>

            {/* ── KPI strip ── */}
            <div className="kpi-grid">

                {/* Outstanding dues */}
                <div className="kpi-cell">
                    <div className="kpi-label">Outstanding Dues</div>
                    <div className="kpi-value" style={{ color: 'var(--c-overdue)' }}>
                        {loading ? '—' : `Rs. ${(stats.totalDues || 0).toLocaleString()}`}
                    </div>
                    <div className="kpi-sub">
                        {stats.unpaidBills || 0} unpaid bills
                    </div>
                </div>

                {/* Collected this month */}
                <div className="kpi-cell">
                    <div className="kpi-label">Collected — {MO[curM]}</div>
                    <div className="kpi-value">
                        {loading ? '—' : `Rs. ${thisM.toLocaleString()}`}
                    </div>
                    <div className="kpi-sub">
                        {delta !== null
                            ? <span style={{ color: delta >= 0 ? 'var(--c-paid)' : 'var(--c-overdue)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                {delta >= 0
                                    ? <TrendingUp size={12} />
                                    : <TrendingDown size={12} />
                                }
                                {Math.abs(delta).toFixed(1)}% vs {MO[Math.max(0, curM - 1)]}
                            </span>
                            : <span>No prior data</span>
                        }
                    </div>
                </div>

                {/* Expenses this month */}
                <div className="kpi-cell">
                    <div className="kpi-label">Expenses — {MO[curM]}</div>
                    <div className="kpi-value">
                        {loading ? '—' : `Rs. ${(stats.totalExpenditure || 0).toLocaleString()}`}
                    </div>
                    <div className="kpi-sub">
                        Net: <strong>
                            Rs. {(thisM - (stats.totalExpenditure || 0)).toLocaleString()}
                        </strong>
                    </div>
                </div>

                {/* Defaulters */}
                <div className="kpi-cell">
                    <div className="kpi-label" style={{ color: def.length > 0 ? 'var(--c-overdue)' : undefined }}>
                        {def.length > 0 && <AlertCircle size={11} />}
                        Defaulter Plots
                    </div>
                    <div className="kpi-value" style={{ color: def.length > 0 ? 'var(--c-overdue)' : 'var(--t-primary)' }}>
                        {loading ? '—' : def.length}
                    </div>
                    <div className="kpi-sub">
                        Rs. {def.reduce((s, d) => s + (d.total_due || 0), 0).toLocaleString()} overdue
                    </div>
                </div>

            </div>

            {/* ── Charts row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginBottom: 20 }}>

                {/* Collection bar chart */}
                <div className="card">
                    <div className="card-header">
                        <span className="card-title">Monthly Collection — {yr}</span>
                        <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: 'var(--t-faint)' }}>
                            YTD Rs. {chart.reduce((s, c) => s + c.amt, 0).toLocaleString()}
                        </span>
                    </div>
                    <div style={{ padding: '16px 8px 8px' }}>
                        <ResponsiveContainer width="100%" height={160}>
                            <BarChart data={chart} barSize={16} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                                <XAxis
                                    dataKey="month"
                                    tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                                    axisLine={false} tickLine={false}
                                />
                                <YAxis
                                    tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                                    axisLine={false} tickLine={false}
                                    tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                                />
                                <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(0,0,0,.03)' }} />
                                <Bar dataKey="amt" radius={[2, 2, 0, 0]}>
                                    {chart.map((_, i) => (
                                        <Cell key={i} fill={i === curM ? '#1d4ed8' : '#e4e4e7'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Bill status */}
                <div className="card">
                    <div className="card-header">
                        <span className="card-title">Bill Status</span>
                        <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: 'var(--t-faint)' }}>
                            {stats.totalBills || 0} total
                        </span>
                    </div>
                    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {[
                            { label: 'Paid', n: stats.paidBills || 0, color: 'var(--c-paid)', bg: 'var(--c-paid-bg)' },
                            { label: 'Partial', n: stats.partialBills || 0, color: 'var(--c-partial)', bg: 'var(--c-partial-bg)' },
                            { label: 'Unpaid', n: stats.unpaidBills || 0, color: 'var(--c-overdue)', bg: 'var(--c-overdue-bg)' },
                        ].map(row => {
                            const pct = stats.totalBills > 0 ? (row.n / stats.totalBills) * 100 : 0
                            return (
                                <div key={row.label}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                                        <span style={{ fontSize: 12, color: 'var(--t-muted)' }}>{row.label}</span>
                                        <span style={{
                                            fontSize: 12, fontFamily: 'IBM Plex Mono', fontWeight: 600,
                                            color: row.n > 0 ? row.color : 'var(--t-faint)'
                                        }}>
                                            {row.n}
                                        </span>
                                    </div>
                                    <div style={{ height: 3, background: 'var(--bg-muted)', borderRadius: 2, overflow: 'hidden' }}>
                                        <div style={{
                                            width: `${pct}%`, height: '100%',
                                            background: row.color,
                                            borderRadius: 2,
                                            transition: 'width .5s ease'
                                        }} />
                                    </div>
                                </div>
                            )
                        })}

                        <div className="divider" />

                        {/* collection rate */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ fontSize: 11, color: 'var(--t-faint)', fontFamily: 'IBM Plex Mono', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Collection Rate
                            </span>
                            <span style={{
                                fontSize: 18, fontFamily: 'IBM Plex Mono', fontWeight: 600,
                                color: stats.totalBills > 0 && ((stats.paidBills || 0) / stats.totalBills) > 0.8
                                    ? 'var(--c-paid)' : 'var(--c-overdue)'
                            }}>
                                {stats.totalBills > 0
                                    ? `${Math.round(((stats.paidBills || 0) / stats.totalBills) * 100)}%`
                                    : '—'}
                            </span>
                        </div>
                    </div>
                </div>

            </div>

            {/* ── Bottom row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                {/* Defaulters table */}
                <div className="card">
                    <div className="card-header">
                        <span className="card-title">Defaulters</span>
                        <button
                            onClick={() => nav('/reports')}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: 11, color: 'var(--t-accent)', fontFamily: 'IBM Plex Mono',
                                display: 'flex', alignItems: 'center', gap: 4
                            }}
                        >
                            View report <ArrowRight size={11} />
                        </button>
                    </div>
                    {def.length === 0 ? (
                        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--t-faint)', fontSize: 13 }}>
                            No defaulters
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Plot</th>
                                    <th>Owner</th>
                                    <th className="td-right">Due</th>
                                    <th className="td-right">Days</th>
                                </tr>
                            </thead>
                            <tbody>
                                {def.map((d: any) => (
                                    <tr key={d.plot_number}>
                                        <td style={{ fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>{d.plot_number}</td>
                                        <td style={{ color: 'var(--t-muted)' }}>{d.owner_name || '—'}</td>
                                        <td className="td-mono" style={{ color: 'var(--c-overdue)' }}>
                                            {(d.total_due || 0).toLocaleString()}
                                        </td>
                                        <td className="td-right">
                                            <span className={`badge ${d.days_overdue > 60 ? 'badge-overdue' : d.days_overdue > 30 ? 'badge-partial' : 'badge-gray'}`}>
                                                {d.days_overdue}d
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Recent expenses */}
                <div className="card">
                    <div className="card-header">
                        <span className="card-title">Recent Expenses</span>
                        <button
                            onClick={() => nav('/expenditures')}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: 11, color: 'var(--t-accent)', fontFamily: 'IBM Plex Mono',
                                display: 'flex', alignItems: 'center', gap: 4
                            }}
                        >
                            View all <ArrowRight size={11} />
                        </button>
                    </div>
                    {expenses.length === 0 ? (
                        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--t-faint)', fontSize: 13 }}>
                            No expenses recorded
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Description</th>
                                    <th>Category</th>
                                    <th className="td-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {expenses.map((e: any) => (
                                    <tr key={e.id}>
                                        <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-faint)' }}>
                                            {e.expenditure_date}
                                        </td>
                                        <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {e.description}
                                        </td>
                                        <td>
                                            <span className="badge badge-gray" style={{ fontSize: 10 }}>{e.category}</span>
                                        </td>
                                        <td className="td-mono" style={{ color: 'var(--t-primary)' }}>
                                            {(e.amount || 0).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

            </div>
        </div>
    )
}