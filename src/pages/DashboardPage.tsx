import { useState, useEffect, useCallback, useRef } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { TrendingDown, TrendingUp, AlertCircle, ArrowRight, Zap, CreditCard, Eye, EyeOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const ipc = (window as any).ipcRenderer
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmt = (n: number) => `Rs. ${n.toLocaleString()}`

/* ── Dashboard Card Component ──────────────────────────── */
function DashboardCard({ title, subtitle, rightElement, children }: any) {
    const [visible, setVisible] = useState(true)
    return (
        <div className="card">
            <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="card-title">{title}</span>
                    <button
                        onClick={() => setVisible(!visible)}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            padding: 2, display: 'flex', alignItems: 'center', color: 'var(--t-faint)'
                        }}
                        title={visible ? 'Hide' : 'Show'}
                    >
                        {visible ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {subtitle}
                    {rightElement}
                </div>
            </div>
            {visible && children}
        </div>
    )
}

function CollapsibleSection({ title, children }: any) {
    const [visible, setVisible] = useState(true)
    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: 'var(--t-faint)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {title}
                </span>
                <button
                    onClick={() => setVisible(!visible)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--t-faint)', display: 'flex' }}
                    title={visible ? 'Hide' : 'Show'}
                >
                    {visible ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
            </div>
            {visible && children}
        </div>
    )
}

/* ── Count-up hook ─────────────────────────────────────── */
function useCountUp(target: number, active: boolean, duration = 900) {
    const [value, setValue] = useState(0)
    const rafRef = useRef<number>()
    useEffect(() => {
        if (!active || target === 0) { setValue(target); return }
        const start = performance.now()
        const tick = (now: number) => {
            const p = Math.min((now - start) / duration, 1)
            const eased = 1 - Math.pow(1 - p, 3)
            setValue(Math.round(eased * target))
            if (p < 1) rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    }, [target, active])
    return value
}

/* ── Progress bar ──────────────────────────────────────── */
function ProgressBar({ pct, color }: { pct: number; color: string }) {
    const [width, setWidth] = useState(0)
    useEffect(() => { const t = setTimeout(() => setWidth(pct), 120); return () => clearTimeout(t) }, [pct])
    return (
        <div className="progress-track">
            <div className="progress-fill" style={{ width: `${width}%`, background: color }} />
        </div>
    )
}

/* ── Skeleton ──────────────────────────────────────────── */
function KpiSkeleton() {
    return (
        <div style={{ padding: '20px 24px' }}>
            <div className="skeleton skeleton-line" style={{ width: 80, marginBottom: 12 }} />
            <div className="skeleton skeleton-value" style={{ marginBottom: 10 }} />
            <div className="skeleton skeleton-sub" />
        </div>
    )
}

/* ── Recharts tooltip ──────────────────────────────────── */
function BarTip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null
    return (
        <div style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 4, padding: '8px 12px', boxShadow: '0 2px 6px rgba(0,0,0,.08)' }}>
            <div style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: '#9ca3af', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 13, fontFamily: 'IBM Plex Mono', fontWeight: 600, color: '#111' }}>
                Rs. {(payload[0]?.value || 0).toLocaleString()}
            </div>
        </div>
    )
}

/* ══════════════════════════════════════════════════════════
   DASHBOARD PAGE
══════════════════════════════════════════════════════════ */
interface Props { user: any }

export default function DashboardPage({ user }: Props) {
    const nav = useNavigate()
    const [stats, setStats] = useState<any>({})
    const [chart, setChart] = useState<any[]>(MO.map(m => ({ month: m, amt: 0 })))
    const [def, setDef] = useState<any[]>([])
    const [expenses, setExpenses] = useState<any[]>([])
    const [loaded, setLoaded] = useState(false)

    const now = new Date()
    const yr = now.getFullYear().toString()
    const curM = now.getMonth()

    /* ── Count-up targets ── */
    const dues = useCountUp(stats.totalDues || 0, loaded)
    const collected = useCountUp(chart[curM]?.amt || 0, loaded)
    const expTotal = useCountUp(stats.totalExpenditure || 0, loaded)
    const defCount = useCountUp(def.length, loaded, 600)

    const load = useCallback(async () => {
        if (!ipc) return
        setLoaded(false)
        try {
            const [s, coll, defaulters, exps] = await Promise.all([
                ipc.invoke('db:get-dashboard-stats'),
                ipc.invoke('db:report-collection-summary', { year: yr }),
                ipc.invoke('db:report-defaulters'),
                ipc.invoke('db:get-expenditures', { startDate: `${yr}-01-01`, endDate: `${yr}-12-31` }),
            ])
            setStats(s)
            const map: Record<string, number> = {}
            for (const r of coll) map[r.month] = r.total
            setChart(MO.map((m, i) => ({
                month: m,
                amt: map[`${yr}-${String(i + 1).padStart(2, '0')}`] || 0
            })))
            setDef((defaulters || []).slice(0, 8))
            setExpenses((exps || []).filter((e: any) => e.is_deleted === 0).slice(0, 6))
        } catch (e) { console.error(e) }
        finally { setLoaded(true) }
    }, [yr])

    useEffect(() => { load() }, [load])

    /* ── Derived values ── */
    const thisM = chart[curM]?.amt || 0
    const lastM = chart[Math.max(0, curM - 1)]?.amt || 0
    const delta = lastM > 0 ? ((thisM - lastM) / lastM * 100) : null
    const netM = thisM - (stats.totalExpenditure || 0)
    const collRate = stats.totalBills > 0
        ? Math.round(((stats.paidBills || 0) / stats.totalBills) * 100)
        : 0
    const ytd = chart.reduce((s, c) => s + c.amt, 0)
    const dateStr = now.toLocaleDateString('en-PK', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    })
    const greeting = now.getHours() < 12 ? 'Morning' : now.getHours() < 17 ? 'Afternoon' : 'Evening'

    return (
        <div className="page">

            {/* ── Header ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                    <div style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: 'var(--t-faint)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 }}>
                        {dateStr.toUpperCase()}
                    </div>
                    <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.025em', marginBottom: 3 }}>
                        {greeting}, {user?.display_name || 'Admin'}
                    </h1>
                    <p style={{ fontSize: 12.5, color: 'var(--t-faint)' }}>
                        River View Co-operative Housing Society &mdash;&nbsp;
                        {stats.totalPlots || '—'} plots &middot; {stats.totalMembers || '—'} members
                    </p>
                </div>
                <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.4rem 0.9rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: '0.82rem', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>
                    Refresh
                </button>
            </div>

            {/* ── KPI strip ── */}
            <CollapsibleSection title="Overview">
                <div className="kpi-grid">
                    {!loaded ? [0, 1, 2, 3].map(i => <KpiSkeleton key={i} />) : (
                        <>
                            <div className="kpi-cell">
                                <div className="kpi-label">Outstanding Dues</div>
                                <div className="kpi-value" style={{ color: dues > 0 ? 'var(--c-overdue)' : 'var(--t-primary)' }}>
                                    {fmt(dues)}
                                </div>
                                <div className="kpi-sub">
                                    <span style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                                        onClick={() => nav('/billing')}>
                                        {stats.unpaidBills || 0} unpaid bills
                                    </span>
                                </div>
                            </div>

                            <div className="kpi-cell">
                                <div className="kpi-label">Collected — {MO[curM]}</div>
                                <div className="kpi-value">{fmt(collected)}</div>
                                <div className="kpi-sub">
                                    {delta !== null ? (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: delta >= 0 ? 'var(--c-paid)' : 'var(--c-overdue)' }}>
                                            {delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                            {Math.abs(delta).toFixed(1)}% vs {MO[Math.max(0, curM - 1)]}
                                        </span>
                                    ) : (
                                        <span style={{ color: 'var(--t-faint)' }}>First month on record</span>
                                    )}
                                </div>
                            </div>

                            <div className="kpi-cell">
                                <div className="kpi-label">Expenses — {MO[curM]}</div>
                                <div className="kpi-value">{fmt(expTotal)}</div>
                                <div className="kpi-sub">
                                    Net <strong style={{ color: netM >= 0 ? 'var(--c-paid)' : 'var(--c-overdue)', fontFamily: 'IBM Plex Mono' }}>
                                        {fmt(netM)}
                                    </strong>
                                </div>
                            </div>

                            <div className="kpi-cell">
                                <div className="kpi-label" style={{ display: 'flex', alignItems: 'center', gap: 5, color: def.length > 0 ? 'var(--c-overdue)' : undefined }}>
                                    {def.length > 0 && <AlertCircle size={11} />} Defaulter Plots
                                </div>
                                <div className="kpi-value" style={{ color: def.length > 0 ? 'var(--c-overdue)' : 'var(--t-primary)' }}>
                                    {defCount}
                                </div>
                                <div className="kpi-sub">
                                    {fmt(def.reduce((s, d) => s + (d.total_due || 0), 0))} overdue
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </CollapsibleSection>

            {/* ── Quick actions ── */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <button className="btn btn-primary" onClick={() => nav('/billing?tab=generate')}>
                    <Zap size={14} /> Generate This Month's Bills
                </button>
                <button className="btn btn-ghost" onClick={() => nav('/billing')}>
                    <CreditCard size={14} /> Collect Payment
                </button>
            </div>

            {/* ── Charts row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, marginBottom: 20 }}>

                {/* Bar chart */}
                <DashboardCard title={`Monthly Collection — ${yr}`} rightElement={<span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: 'var(--t-faint)' }}>YTD {fmt(ytd)}</span>}>
                    <div style={{ padding: '12px 8px 10px' }}>
                        <ResponsiveContainer width="100%" height={155}>
                            <BarChart data={chart} barSize={14} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                                <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false}
                                    tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                                <Tooltip content={<BarTip />} cursor={{ fill: 'rgba(0,0,0,.03)' }} />
                                <Bar dataKey="amt" radius={[2, 2, 0, 0]}>
                                    {chart.map((_, i) => <Cell key={i} fill={i === curM ? '#1d4ed8' : '#e4e4e7'} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </DashboardCard>

                {/* Bill status */}
                <DashboardCard title="Bill Status" rightElement={<span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: 'var(--t-faint)' }}>{stats.totalBills || 0} total</span>}>
                    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {[
                            { label: 'Paid', n: stats.paidBills || 0, color: 'var(--c-paid)' },
                            { label: 'Partial', n: stats.partialBills || 0, color: 'var(--c-partial)' },
                            { label: 'Unpaid', n: stats.unpaidBills || 0, color: 'var(--c-overdue)' },
                        ].map(row => (
                            <div key={row.label}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ fontSize: 12, color: 'var(--t-muted)' }}>{row.label}</span>
                                    <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono', fontWeight: 600, color: row.n > 0 ? row.color : 'var(--t-faint)' }}>
                                        {row.n}
                                    </span>
                                </div>
                                <ProgressBar pct={stats.totalBills > 0 ? (row.n / stats.totalBills) * 100 : 0} color={row.color} />
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--t-faint)' }}>
                            Collection Rate
                        </span>
                        <span style={{ fontSize: 22, fontFamily: 'IBM Plex Mono', fontWeight: 600, color: collRate >= 80 ? 'var(--c-paid)' : 'var(--c-overdue)' }}>
                            {loaded ? `${collRate}%` : '—'}
                        </span>
                    </div>
                </DashboardCard>

            </div>

            {/* ── Bottom row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                {/* Defaulters */}
                <DashboardCard title="Defaulters" rightElement={
                    <button onClick={() => nav('/reports')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--accent)', fontFamily: 'IBM Plex Mono', display: 'flex', alignItems: 'center', gap: 3 }}>
                        View report <ArrowRight size={11} />
                    </button>
                }>
                    {!loaded ? (
                        <div style={{ padding: 20 }}>{[100, 80, 90, 70, 85].map((w, i) => <div key={i} className="skeleton skeleton-line" style={{ width: w, marginBottom: 10 }} />)}</div>
                    ) : def.length === 0 ? (
                        <div style={{ padding: '36px 20px', textAlign: 'center', fontSize: 13, color: 'var(--t-faint)' }}>No defaulters 🎉</div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr><th>Plot</th><th>Owner</th><th style={{ textAlign: 'right' }}>Due</th><th style={{ textAlign: 'right' }}>Days</th></tr>
                            </thead>
                            <tbody>
                                {def.map((d: any) => (
                                    <tr key={d.plot_number} style={{ cursor: 'pointer' }} onClick={() => nav('/plots')}>
                                        <td style={{ fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>{d.plot_number}</td>
                                        <td style={{ color: 'var(--t-muted)' }}>{d.owner_name || '—'}</td>
                                        <td className="td-mono" style={{ color: 'var(--c-overdue)', textAlign: 'right' }}>
                                            {(d.total_due || 0).toLocaleString()}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <span className={`badge ${d.days_overdue > 60 ? 'badge-overdue' : d.days_overdue > 30 ? 'badge-partial' : 'badge-gray'}`}>
                                                {d.days_overdue}d
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </DashboardCard>

                {/* Recent expenses */}
                <DashboardCard title="Recent Expenses" rightElement={
                    <button onClick={() => nav('/expenditures')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--accent)', fontFamily: 'IBM Plex Mono', display: 'flex', alignItems: 'center', gap: 3 }}>
                        View all <ArrowRight size={11} />
                    </button>
                }>
                    {!loaded ? (
                        <div style={{ padding: 20 }}>{[0, 1, 2, 3, 4].map(i => <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}><div className="skeleton skeleton-line" style={{ width: 140 }} /><div className="skeleton skeleton-line" style={{ width: 60 }} /></div>)}</div>
                    ) : expenses.length === 0 ? (
                        <div style={{ padding: '36px 20px', textAlign: 'center', fontSize: 13, color: 'var(--t-faint)' }}>No expenses recorded</div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr><th>Date</th><th>Description</th><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
                            </thead>
                            <tbody>
                                {expenses.map((e: any) => (
                                    <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => nav('/expenditures')}>
                                        <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-faint)' }}>{e.expenditure_date}</td>
                                        <td style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description}</td>
                                        <td><span className="badge badge-gray" style={{ fontSize: 10 }}>{e.category}</span></td>
                                        <td className="td-mono" style={{ textAlign: 'right' }}>{(e.amount || 0).toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </DashboardCard>

            </div>
        </div>
    )
}