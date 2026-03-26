import { useState, useEffect, useCallback } from 'react'
import { Download, TrendingUp, FileText, Layers, RefreshCw } from 'lucide-react'
import { exportExcelFile } from '../utils/exportExcel'

const ipc = (window as any).ipcRenderer

type Tab = 'trial-balance' | 'defaulters' | 'fund-summary' | 'income-expenditure'

export default function ReportsPage() {
    const [tab, setTab] = useState<Tab>('trial-balance')

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>Reports & Analytics</h1>
                    <p className="subtitle">Financial reports, defaulter lists, and collection summaries</p>
                </div>
            </div>

            <div className="report-tabs" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                {([
                    { id: 'trial-balance', label: 'Trial Balance', icon: <FileText size={16} /> },
                    { id: 'defaulters', label: 'Defaulters', icon: <RefreshCw size={16} /> },
                    { id: 'fund-summary', label: 'Fund Summary', icon: <Layers size={16} /> },
                    { id: 'income-expenditure', label: 'Income & Expenditure', icon: <TrendingUp size={16} /> },
                ] as { id: Tab; label: string; icon: any }[]).map(t => (
                    <button
                        key={t.id}
                        className={`btn ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setTab(t.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                        {t.icon} {t.label}
                    </button>
                ))}
            </div>

            {tab === 'trial-balance' && <TrialBalanceReport />}
            {tab === 'defaulters' && <DefaulterReport />}
            {tab === 'fund-summary' && <FundSummaryReport />}
            {tab === 'income-expenditure' && <IncomeExpenditureReport />}
        </div>
    )
}

// ── Trial Balance ─────────────────────────────────────────────

function TrialBalanceReport() {
    const [data, setData] = useState<any[]>([])
    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setMonth(0); d.setDate(1); return d.toISOString().split('T')[0]
    })
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

    const load = useCallback(async () => {
        if (!ipc) return
        const rows = await ipc.invoke('db:report-trial-balance', { startDate, endDate })
        setData(rows)
    }, [startDate, endDate])

    useEffect(() => { load() }, [load])

    const totalDebit = data.reduce((s, r) => s + r.total_debit, 0)
    const totalCredit = data.reduce((s, r) => s + r.total_credit, 0)

    return (
        <div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem' }}>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="month-input" />
                <span className="text-muted">to</span>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="month-input" />
                <button className="btn btn-ghost" onClick={() => exportTableExcel('trial-balance', 'Trial Balance', data, ['Account Code', 'Account Name', 'Type', 'Debit', 'Credit', 'Balance'])}>
                    <Download size={16} /> Export Excel
                </button>
            </div>

            <table className="data-table">
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Account Name</th>
                        <th>Type</th>
                        <th style={{ textAlign: 'right' }}>Debit (Rs.)</th>
                        <th style={{ textAlign: 'right' }}>Credit (Rs.)</th>
                        <th style={{ textAlign: 'right' }}>Balance</th>
                    </tr>
                </thead>
                <tbody>
                    {data.length === 0 ? (
                        <tr><td colSpan={6} className="empty-row">No journal entries found in this period.</td></tr>
                    ) : data.map((r, i) => {
                        const balance = r.normal_balance === 'debit'
                            ? r.total_debit - r.total_credit
                            : r.total_credit - r.total_debit
                        return (
                            <tr key={i}>
                                <td style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{r.account_code}</td>
                                <td>{r.account_name}</td>
                                <td><span className={`badge badge-${r.account_type === 'asset' ? 'blue' : r.account_type === 'revenue' ? 'green' : r.account_type === 'expense' ? 'red' : 'yellow'}`}>{r.account_type}</span></td>
                                <td style={{ textAlign: 'right' }}>{r.total_debit > 0 ? r.total_debit.toLocaleString('en-PK', { maximumFractionDigits: 0 }) : '-'}</td>
                                <td style={{ textAlign: 'right' }}>{r.total_credit > 0 ? r.total_credit.toLocaleString('en-PK', { maximumFractionDigits: 0 }) : '-'}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600, color: balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>{balance.toLocaleString('en-PK', { maximumFractionDigits: 0 })}</td>
                            </tr>
                        )
                    })}
                </tbody>
                {data.length > 0 && (
                    <tfoot>
                        <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                            <td colSpan={3}>TOTALS</td>
                            <td style={{ textAlign: 'right' }}>{totalDebit.toLocaleString('en-PK', { maximumFractionDigits: 0 })}</td>
                            <td style={{ textAlign: 'right' }}>{totalCredit.toLocaleString('en-PK', { maximumFractionDigits: 0 })}</td>
                            <td style={{ textAlign: 'right', color: Math.abs(totalDebit - totalCredit) < 0.01 ? 'var(--success)' : 'var(--danger)' }}>
                                {Math.abs(totalDebit - totalCredit) < 0.01 ? '✓ Balanced' : `Diff: ${(totalDebit - totalCredit).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`}
                            </td>
                        </tr>
                    </tfoot>
                )}
            </table>
        </div>
    )
}

// ── Defaulter Report ──────────────────────────────────────────

function DefaulterReport() {
    const [data, setData] = useState<any[]>([])
    const [loading, setLoading] = useState(false)

    const load = async () => {
        if (!ipc) return
        setLoading(true)
        try { setData(await ipc.invoke('db:report-defaulters') || []) }
        finally { setLoading(false) }
    }

    useEffect(() => { load() }, [])

    const totalDue = data.reduce((s, r) => s + r.total_due, 0)
    const totalUnpaidBills = data.reduce((s, r) => s + r.unpaid_count, 0)

    const handleExport = () => {
        if (data.length === 0) return
        const exportData = data.map(r => ({
            plot_number:  r.plot_number,
            plot_type:    r.plot_type?.replace(/_/g, ' '),
            owner_name:   r.owner_name || '—',
            phone:        r.phone || '—',
            unpaid_bills: r.unpaid_count,
            amount_due:   r.total_due,
            oldest_due:   r.oldest_due_date,
            days_overdue: r.days_overdue,
            severity:     r.days_overdue > 180 ? 'Critical'
                        : r.days_overdue > 90 ? 'High'
                        : r.days_overdue > 30 ? 'Medium' : 'Low',
        }))
        exportTableExcel('defaulters', 'Defaulters Report', exportData, [])
    }

    return (
        <div>
            {/* ── KPI strip ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
                gap: '1rem', marginBottom: '1.75rem' }}>
                {[
                    {
                        label: 'DEFAULTING PLOTS',
                        val: String(data.length),
                        clr: data.length > 0 ? 'var(--c-overdue)' : 'var(--c-paid)'
                    },
                    {
                        label: 'TOTAL OUTSTANDING',
                        val: `Rs. ${totalDue.toLocaleString()}`,
                        clr: totalDue > 0 ? 'var(--c-overdue)' : 'var(--c-paid)'
                    },
                    {
                        label: 'UNPAID BILLS',
                        val: String(totalUnpaidBills),
                        clr: totalUnpaidBills > 0 ? 'var(--c-partial)' : 'var(--c-paid)'
                    },
                ].map(k => (
                    <div key={k.label} style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r-lg)',
                        padding: '1.25rem 1.5rem',
                        boxShadow: 'var(--shadow-card)'
                    }}>
                        <div style={{
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            color: 'var(--t-faint)',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            marginBottom: '0.5rem'
                        }}>
                            {k.label}
                        </div>
                        <div style={{
                            fontSize: '1.35rem',
                            fontWeight: 700,
                            fontFamily: 'IBM Plex Mono',
                            color: k.clr
                        }}>
                            {k.val}
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Toolbar ── */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                <button className="btn btn-ghost" onClick={handleExport}>
                    <Download size={15}/> Export Excel
                </button>
            </div>

            {/* ── Table ── */}
            <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)',
                overflow: 'hidden',
                boxShadow: 'var(--shadow-card)'
            }}>
                <table className="data-table" style={{ margin: 0 }}>
                    <thead>
                        <tr>
                            <th>Plot</th>
                            <th>Type</th>
                            <th>Owner</th>
                            <th>Phone</th>
                            <th style={{ textAlign: 'center' }}>Unpaid Bills</th>
                            <th>Oldest Unpaid</th>
                            <th style={{ textAlign: 'right' }}>Outstanding (Rs.)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={7} className="empty-row">
                                <RefreshCw size={14} className="spin" style={{ marginRight: 6 }}/>
                                Loading…
                            </td></tr>
                        ) : data.length === 0 ? (
                            <tr><td colSpan={7} className="empty-row">
                                🎉 No defaulters — all plots are clear
                            </td></tr>
                        ) : data.map((r, i) => (
                            <tr key={i}>
                                <td style={{ fontWeight: 700, fontFamily: 'IBM Plex Mono' }}>
                                    {r.plot_number}
                                </td>
                                <td>
                                    <span style={{
                                        fontSize: '0.78rem',
                                        color: 'var(--t-faint)',
                                        textTransform: 'capitalize'
                                    }}>
                                        {r.plot_type?.replace(/_/g, ' ')}
                                    </span>
                                </td>
                                <td style={{ fontSize: '0.875rem' }}>
                                    {r.owner_name || '—'}
                                </td>
                                <td style={{
                                    fontFamily: 'IBM Plex Mono',
                                    fontSize: '0.83rem',
                                    color: 'var(--t-muted)'
                                }}>
                                    {r.phone || '—'}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    <span style={{
                                        background: 'rgba(239,68,68,0.1)',
                                        color: 'var(--c-overdue)',
                                        borderRadius: 4,
                                        padding: '2px 10px',
                                        fontSize: '0.8rem',
                                        fontWeight: 700,
                                        fontFamily: 'IBM Plex Mono'
                                    }}>
                                        {r.unpaid_count}
                                    </span>
                                </td>
                                <td style={{
                                    fontFamily: 'IBM Plex Mono',
                                    fontSize: '0.83rem',
                                    color: 'var(--c-overdue)'
                                }}>
                                    {r.oldest_due_date || '—'}
                                </td>
                                <td style={{
                                    textAlign: 'right',
                                    fontWeight: 700,
                                    fontFamily: 'IBM Plex Mono',
                                    color: 'var(--c-overdue)',
                                    fontSize: '0.95rem'
                                }}>
                                    {r.total_due.toLocaleString()}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {data.length > 0 && (
                        <tfoot>
                            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                                <td colSpan={4}>TOTAL</td>
                                <td style={{ textAlign: 'center', fontFamily: 'IBM Plex Mono' }}>
                                    {totalUnpaidBills}
                                </td>
                                <td />
                                <td style={{
                                    textAlign: 'right',
                                    fontFamily: 'IBM Plex Mono',
                                    color: 'var(--c-overdue)'
                                }}>
                                    {totalDue.toLocaleString()}
                                </td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    )
}

// ── Collection Summary ────────────────────────────────────────

function CollectionSummary() {
    const [data, setData] = useState<any[]>([])
    const [year, setYear] = useState(() => new Date().getFullYear().toString())

    const load = useCallback(async () => {
        if (!ipc) return
        const rows = await ipc.invoke('db:report-collection-summary', { year })
        setData(rows)
    }, [year])

    useEffect(() => { load() }, [load])

    const grandTotal = data.reduce((s, r) => s + r.total, 0)
    const cashTotal = data.reduce((s, r) => s + r.cash_total, 0)
    const bankTotal = data.reduce((s, r) => s + r.bank_total, 0)

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    return (
        <div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem' }}>
                <select value={year} onChange={e => setYear(e.target.value)} style={{ padding: '0.5rem 1rem', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                    {Array.from({ length: 5 }, (_, i) => {
                        const y = new Date().getFullYear() - i
                        return <option key={y} value={y.toString()}>{y}</option>
                    })}
                </select>
                <div className="stat-mini" style={{ background: 'rgba(34,197,94,0.1)', padding: '0.5rem 1rem', borderRadius: '8px' }}>
                    <span className="text-muted" style={{ fontSize: '0.8rem' }}>Year Total</span>
                    <strong style={{ color: 'var(--success)' }}> Rs. {grandTotal.toLocaleString()}</strong>
                </div>
                <button className="btn btn-ghost" onClick={() => exportTableExcel('collection-summary', 'Collection Summary', data, ['Month', 'Payments', 'Cash', 'Bank', 'Total'])}>
                    <Download size={16} /> Export Excel
                </button>
            </div>

            <table className="data-table">
                <thead>
                    <tr>
                        <th>Month</th>
                        <th style={{ textAlign: 'center' }}>Payments</th>
                        <th style={{ textAlign: 'right' }}>Cash (Rs.)</th>
                        <th style={{ textAlign: 'right' }}>Bank (Rs.)</th>
                        <th style={{ textAlign: 'right' }}>Total (Rs.)</th>
                    </tr>
                </thead>
                <tbody>
                    {data.length === 0 ? (
                        <tr><td colSpan={5} className="empty-row">No payments recorded for {year}.</td></tr>
                    ) : data.map((r, i) => {
                        const monthIdx = parseInt(r.month.split('-')[1]) - 1
                        return (
                            <tr key={i}>
                                <td style={{ fontWeight: 600 }}>{monthNames[monthIdx]} {year}</td>
                                <td style={{ textAlign: 'center' }}>{r.payment_count}</td>
                                <td style={{ textAlign: 'right' }}>{r.cash_total.toLocaleString()}</td>
                                <td style={{ textAlign: 'right' }}>{r.bank_total.toLocaleString()}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--success)' }}>{r.total.toLocaleString()}</td>
                            </tr>
                        )
                    })}
                </tbody>
                {data.length > 0 && (
                    <tfoot>
                        <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                            <td>TOTAL</td>
                            <td style={{ textAlign: 'center' }}>{data.reduce((s, r) => s + r.payment_count, 0)}</td>
                            <td style={{ textAlign: 'right' }}>{cashTotal.toLocaleString()}</td>
                            <td style={{ textAlign: 'right' }}>{bankTotal.toLocaleString()}</td>
                            <td style={{ textAlign: 'right', color: 'var(--success)' }}>{grandTotal.toLocaleString()}</td>
                        </tr>
                    </tfoot>
                )}
            </table>
        </div>
    )
}

// ── Income & Expenditure Statement ────────────────────────────

function IncomeExpenditureReport() {
    const [data, setData] = useState<any>({ 
        revenue: [], 
        expenses: [], 
        billRevenue: 0, 
        directExpenses: 0,
        specialChargesIncome: [],
        expenseCategories: []
    })
    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setMonth(0); d.setDate(1); return d.toISOString().split('T')[0]
    })
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

    const load = useCallback(async () => {
        if (!ipc) return
        const result = await ipc.invoke('db:report-income-expenditure', { startDate, endDate })
        setData(result)
    }, [startDate, endDate])

    useEffect(() => { load() }, [load])

    const totalRevenue = data.revenue.reduce((s: number, r: any) => s + r.net_amount, 0)
    const totalExpenses = data.expenses.reduce((s: number, r: any) => s + r.net_amount, 0)
    const totalSpecialIncome = data.specialChargesIncome?.reduce((s: number, r: any) => s + (r.collected || 0), 0) || 0
    const totalExpenseCategories = data.expenseCategories?.reduce((s: number, r: any) => s + (r.total_amount || 0), 0) || 0
    
    const netIncome = (totalRevenue || data.billRevenue) - (totalExpenses || data.directExpenses)
    const simpleSurplus = data.billRevenue - data.directExpenses

    const fmt = (n: number) => Math.round(n).toLocaleString()

    return (
        <div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem' }}>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="month-input" />
                <span className="text-muted">to</span>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="month-input" />
                <button className="btn btn-ghost" onClick={load}>
                    <RefreshCw size={14} /> Refresh
                </button>
            </div>

            {/* Simple Overview Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '12px', padding: '1.25rem' }}>
                    <div className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Total Revenue</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--success)' }}>Rs. {fmt(totalRevenue || data.billRevenue)}</div>
                </div>
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', padding: '1.25rem' }}>
                    <div className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Total Expenses</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--danger)' }}>Rs. {fmt(totalExpenses || data.directExpenses)}</div>
                </div>
                <div style={{ background: netIncome >= 0 || simpleSurplus >= 0 ? 'rgba(59,130,246,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${netIncome >= 0 || simpleSurplus >= 0 ? 'rgba(59,130,246,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: '12px', padding: '1.25rem' }}>
                    <div className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Net {netIncome >= 0 || simpleSurplus >= 0 ? 'Surplus' : 'Deficit'}</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 700, color: netIncome >= 0 || simpleSurplus >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                        Rs. {fmt(netIncome || simpleSurplus)}
                    </div>
                </div>
            </div>

            {/* Special Charges Income Section */}
            {data.specialChargesIncome && data.specialChargesIncome.length > 0 && (
                <div style={{ marginBottom: '2rem' }}>
                    <h3 style={{ marginBottom: '1rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
                        <TrendingUp size={16} /> Special Challan Income
                        <span style={{ marginLeft: 'auto', fontSize: '0.85rem', fontWeight: 600 }}>
                            Total: Rs. {fmt(totalSpecialIncome)}
                        </span>
                    </h3>
                    <div className="table-wrap">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 40 }}>#</th>
                                    <th>Charge Name</th>
                                    <th style={{ textAlign: 'center', width: 80 }}>Bills</th>
                                    <th style={{ textAlign: 'right', width: 140 }}>Collected (Rs.)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.specialChargesIncome.map((r: any, i: number) => (
                                    <tr key={r.charge_name}>
                                        <td style={{ color: 'var(--t-faint)' }}>{i + 1}</td>
                                        <td style={{ fontWeight: 500 }}>{r.charge_name}</td>
                                        <td style={{ textAlign: 'center' }}>{r.bill_count}</td>
                                        <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', color: 'var(--success)' }}>
                                            {fmt(r.collected)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ background: 'var(--bg-subtle)', fontWeight: 700 }}>
                                    <td colSpan={3}>TOTAL SPECIAL INCOME</td>
                                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', color: 'var(--success)' }}>
                                        {fmt(totalSpecialIncome)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* Expense Categories Section */}
            {data.expenseCategories && data.expenseCategories.length > 0 && (
                <div style={{ marginBottom: '2rem' }}>
                    <h3 style={{ marginBottom: '1rem', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
                        <TrendingUp size={16} style={{ transform: 'rotate(180deg)' }} /> Expense Categories
                        <span style={{ marginLeft: 'auto', fontSize: '0.85rem', fontWeight: 600 }}>
                            Total: Rs. {fmt(totalExpenseCategories)}
                        </span>
                    </h3>
                    <div className="table-wrap">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 40 }}>#</th>
                                    <th>Category</th>
                                    <th style={{ textAlign: 'center', width: 80 }}>Count</th>
                                    <th style={{ textAlign: 'right', width: 140 }}>Amount (Rs.)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.expenseCategories.map((r: any, i: number) => (
                                    <tr key={r.category}>
                                        <td style={{ color: 'var(--t-faint)' }}>{i + 1}</td>
                                        <td style={{ fontWeight: 500 }}>{r.category}</td>
                                        <td style={{ textAlign: 'center' }}>{r.count}</td>
                                        <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', color: 'var(--danger)' }}>
                                            {fmt(r.total_amount)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ background: 'var(--bg-subtle)', fontWeight: 700 }}>
                                    <td colSpan={3}>TOTAL EXPENSES</td>
                                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', color: 'var(--danger)' }}>
                                        {fmt(totalExpenseCategories)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* Detailed Breakdown from Journal */}
            {data.revenue.length > 0 || data.expenses.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                    <div>
                        <h3 style={{ marginBottom: '1rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <TrendingUp size={18} /> Revenue (Ledger)
                        </h3>
                        <table className="data-table">
                            <thead><tr><th>Account</th><th style={{ textAlign: 'right' }}>Amount (Rs.)</th></tr></thead>
                            <tbody>
                                {data.revenue.map((r: any, i: number) => (
                                    <tr key={i}>
                                        <td>{r.account_code} - {r.account_name}</td>
                                        <td style={{ textAlign: 'right', color: 'var(--success)' }}>{fmt(r.net_amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ fontWeight: 700 }}>
                                    <td>Total Revenue</td>
                                    <td style={{ textAlign: 'right', color: 'var(--success)' }}>{fmt(totalRevenue)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <div>
                        <h3 style={{ marginBottom: '1rem', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <TrendingUp size={18} style={{ transform: 'rotate(180deg)' }} /> Expenses (Ledger)
                        </h3>
                        <table className="data-table">
                            <thead><tr><th>Account</th><th style={{ textAlign: 'right' }}>Amount (Rs.)</th></tr></thead>
                            <tbody>
                                {data.expenses.map((r: any, i: number) => (
                                    <tr key={i}>
                                        <td>{r.account_code} - {r.account_name}</td>
                                        <td style={{ textAlign: 'right', color: 'var(--danger)' }}>{fmt(r.net_amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ fontWeight: 700 }}>
                                    <td>Total Expenses</td>
                                    <td style={{ textAlign: 'right', color: 'var(--danger)' }}>{fmt(totalExpenses)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            ) : (
                (data.specialChargesIncome?.length === 0 && data.expenseCategories?.length === 0) && (
                    <div className="empty-row" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        No entries found for this period.
                    </div>
                )
            )}
        </div>
    )
}


// ── Fund Summary ──────────────────────────────────────────────

function FundSummaryReport() {
  const [data,       setData]       = useState<any[]>([])
  const [startMonth, setStartMonth] = useState(() => {
    const d = new Date(); d.setMonth(0); return d.toISOString().slice(0, 7)
  })
  const [endMonth,   setEndMonth]   = useState(() => new Date().toISOString().slice(0, 7))
  const [loading,    setLoading]    = useState(false)

  const load = useCallback(async () => {
    if (!ipc) return
    setLoading(true)
    try {
      const rows = await ipc.invoke('db:get-fund-summary', {
        startDate: startMonth,
        endDate:   endMonth,
      })
      setData(rows || [])
    } finally { setLoading(false) }
  }, [startMonth, endMonth])

  useEffect(() => { load() }, [load])

  // Split into monthly vs special
  const MONTHLY_CHARGES = [
    'Monthly Contribution', 'Base Contribution',
    'Mosque Contribution', 'Mosque Fund',
    'Garbage Collection', 'Garbage Charges',
    'Aquifer Contribution', 'Aquifer Charges',
    'Monthly Tenant Challan',
  ]
  const monthly = data.filter(r =>
    r.bill_type === 'monthly' || r.bill_type === 'tenant' ||
    MONTHLY_CHARGES.includes(r.charge_name)
  )
  const special = data.filter(r =>
    r.bill_type === 'special' &&
    !MONTHLY_CHARGES.includes(r.charge_name)
  )

  const monthlyTotal  = monthly.reduce((s, r) => s + r.total_collected, 0)
  const specialTotal  = special.reduce((s, r) => s + r.total_collected, 0)
  const grandTotal    = monthlyTotal + specialTotal

  const fmt = (n: number) => n.toLocaleString()

  const SectionTable = ({ rows, sectionTotal }: { rows: any[]; sectionTotal: number }) => (
    <table className="data-table" style={{ margin: 0 }}>
      <thead>
        <tr>
          <th>Charge / Fund</th>
          <th style={{ textAlign: 'right' }}>Collected (Rs.)</th>
          <th style={{ textAlign: 'right' }}>Outstanding (Rs.)</th>
          <th style={{ width: 160 }}>Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={4} className="empty-row">No data for this period</td></tr>
        ) : rows.map((r, i) => {
          const pct = sectionTotal > 0 ? (r.total_collected / sectionTotal) * 100 : 0
          return (
            <tr key={i}>
              <td style={{ fontWeight: 500 }}>{r.charge_name}</td>
              <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono',
                fontWeight: 600, color: 'var(--c-paid)' }}>
                {fmt(r.total_collected)}
              </td>
              <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono',
                color: r.total_outstanding > 0 ? 'var(--c-overdue)' : 'var(--t-faint)' }}>
                {r.total_outstanding > 0 ? fmt(r.total_outstanding) : '—'}
              </td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 6, background: 'var(--bg-subtle)',
                    borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%',
                      background: 'var(--accent)', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono',
                    color: 'var(--t-faint)', width: 36, textAlign: 'right' }}>
                    {pct.toFixed(1)}%
                  </span>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
          <td>Total</td>
          <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono',
            color: 'var(--c-paid)' }}>{fmt(sectionTotal)}</td>
          <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono',
            color: 'var(--c-overdue)' }}>
            {fmt(rows.reduce((s, r) => s + r.total_outstanding, 0))}
          </td>
          <td />
        </tr>
      </tfoot>
    </table>
  )

  return (
    <div>
      {/* ── Filter bar ── */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center',
        marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input type="month" value={startMonth}
          onChange={e => setStartMonth(e.target.value)} />
        <span style={{ color: 'var(--t-faint)' }}>to</span>
        <input type="month" value={endMonth}
          onChange={e => setEndMonth(e.target.value)} />
        <button className="btn btn-ghost" onClick={load} disabled={loading}>
          {loading ? <><RefreshCw size={14} className="spin"/> Loading…</> : 'Load'}
        </button>
        <button className="btn btn-ghost" style={{ marginLeft: 'auto' }}
          onClick={() => exportTableExcel('fund-summary', 'Fund Summary', data,
            ['Charge', 'Type', 'Collected', 'Outstanding'])}>
          <Download size={16} /> Export Excel
        </button>
      </div>

      {/* ── Grand total strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
        gap: '1rem', marginBottom: '1.75rem' }}>
        {[
          { label: 'MONTHLY COLLECTED',  val: fmt(monthlyTotal), clr: 'var(--c-paid)'    },
          { label: 'SPECIAL COLLECTED',  val: fmt(specialTotal), clr: 'var(--accent)'    },
          { label: 'GRAND TOTAL',        val: fmt(grandTotal),   clr: 'var(--t-primary)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--bg-card)',
            border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
            padding: '1.1rem 1.4rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--t-faint)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              marginBottom: '0.4rem' }}>{k.label}</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700,
              fontFamily: 'IBM Plex Mono', color: k.clr }}>Rs. {k.val}</div>
          </div>
        ))}
      </div>

      {/* ── Section 1: Monthly ── */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
          fontFamily: 'IBM Plex Mono', marginBottom: '0.75rem',
          borderBottom: '2px solid var(--accent)', paddingBottom: 4 }}>
          Monthly Collections
        </div>
        <SectionTable rows={monthly} sectionTotal={monthlyTotal} />
      </div>

      {/* ── Section 2: Special ── */}
      <div>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--t-muted)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
          fontFamily: 'IBM Plex Mono', marginBottom: '0.75rem',
          borderBottom: '2px solid var(--border)', paddingBottom: 4 }}>
          Special Charges
        </div>
        <SectionTable rows={special} sectionTotal={specialTotal} />
      </div>
    </div>
  )
}

// ── Balance Sheet ─────────────────────────────────────────────

function BalanceSheetReport() {
    const [data, setData] = useState<any[]>([])
    const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().split('T')[0])

    const load = useCallback(async () => {
        if (!ipc) return
        const rows = await ipc.invoke('db:report-balance-sheet', { asOfDate })
        setData(rows || [])
    }, [asOfDate])

    useEffect(() => { load() }, [load])

    const assets      = data.filter(r => r.account_type === 'asset')
    const liabilities = data.filter(r => r.account_type === 'liability')
    const equity      = data.filter(r => r.account_type === 'equity')

    const totalAssets      = assets.reduce((s, r) => s + r.balance, 0)
    const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0)
    const totalEquity      = equity.reduce((s, r) => s + r.balance, 0)
    const balanced         = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1

    const fmt = (n: number) => n.toLocaleString()

    const Section = ({ title, rows, total, color }: { title: string; rows: any[]; total: number; color: string }) => (
        <div style={{ marginBottom: '1.5rem' }}>
            <div style={{
                fontSize: 10.5, fontWeight: 700, color, letterSpacing: '0.08em',
                textTransform: 'uppercase', fontFamily: 'IBM Plex Mono',
                borderBottom: `2px solid ${color}`, paddingBottom: 4, marginBottom: 2
            }}>{title}</div>
            <table className="data-table" style={{ margin: 0 }}>
                <tbody>
                    {rows.length === 0 ? (
                        <tr><td colSpan={3} style={{ color: 'var(--t-faint)', fontSize: 12, padding: '8px 16px' }}>No entries</td></tr>
                    ) : rows.map((r, i) => (
                        <tr key={i}>
                            <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--t-faint)', width: 60 }}>{r.account_code}</td>
                            <td style={{ fontSize: 13 }}>{r.account_name}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: 13, fontWeight: 500 }}>
                                {fmt(r.balance)}
                            </td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
                        <td colSpan={2} style={{ padding: '8px 16px', fontWeight: 700, fontSize: 12, fontFamily: 'IBM Plex Mono', color }}>
                            Total {title}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 700, fontSize: 13, color, padding: '8px 16px' }}>
                            {fmt(total)}
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    )

    return (
        <div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 12.5, color: 'var(--t-faint)' }}>As of date:</label>
                    <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} />
                </div>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                    borderRadius: 6, fontSize: 12, fontWeight: 600,
                    background: balanced ? 'rgba(21,128,61,0.1)' : 'rgba(185,28,28,0.1)',
                    color: balanced ? '#15803d' : '#b91c1c',
                    border: `1px solid ${balanced ? 'rgba(21,128,61,0.25)' : 'rgba(185,28,28,0.25)'}`
                }}>
                    <Scale size={13} />
                    {balanced ? '✓ Balanced' : `Out of balance by Rs. ${fmt(Math.abs(totalAssets - totalLiabilities - totalEquity))}`}
                </div>
                <button className="btn btn-ghost" style={{ marginLeft: 'auto' }}
                    onClick={() => exportTableExcel('balance-sheet', 'Balance Sheet', data, ['Code', 'Account', 'Type', 'Balance'])}>
                    <Download size={16} /> Export Excel
                </button>
            </div>

            {/* Equation banner */}
            <div style={{
                display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', gap: 4,
                alignItems: 'center', background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '12px 20px', marginBottom: '1.5rem', textAlign: 'center'
            }}>
                <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-faint)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'IBM Plex Mono', marginBottom: 4 }}>ASSETS</div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'IBM Plex Mono', color: '#1d4ed8' }}>Rs. {fmt(totalAssets)}</div>
                </div>
                <div style={{ fontSize: 20, color: 'var(--t-faint)', padding: '0 8px' }}>=</div>
                <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-faint)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'IBM Plex Mono', marginBottom: 4 }}>LIABILITIES</div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'IBM Plex Mono', color: '#b45309' }}>Rs. {fmt(totalLiabilities)}</div>
                </div>
                <div style={{ fontSize: 20, color: 'var(--t-faint)', padding: '0 8px' }}>+</div>
                <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-faint)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'IBM Plex Mono', marginBottom: 4 }}>EQUITY</div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'IBM Plex Mono', color: '#15803d' }}>Rs. {fmt(totalEquity)}</div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div>
                    <Section title="Assets"      rows={assets}      total={totalAssets}      color="#1d4ed8" />
                </div>
                <div>
                    <Section title="Liabilities" rows={liabilities} total={totalLiabilities} color="#b45309" />
                    <Section title="Equity"      rows={equity}      total={totalEquity}      color="#15803d" />
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', padding: '10px 16px',
                        background: 'var(--bg-subtle)', borderRadius: 6, fontWeight: 700,
                        border: '1px solid var(--border)', fontFamily: 'IBM Plex Mono', fontSize: 13
                    }}>
                        <span>Total Liabilities + Equity</span>
                        <span style={{ color: balanced ? '#15803d' : '#b91c1c' }}>
                            Rs. {fmt(totalLiabilities + totalEquity)}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── CSV Export Utility ────────────────────────────────────────

async function exportTableExcel(name: string, title: string, data: any[], _headers: string[]) {
    if (data.length === 0) return
    const keys = Object.keys(data[0])
    const numericColumns = keys
        .map((key, index) => ({ key, index: index + 1 }))
        .filter(({ key }) => data.some(row => typeof row[key] === 'number'))
        .map(({ index }) => index)

    await exportExcelFile({
        fileName: `${name}_${new Date().toISOString().split('T')[0]}`,
        sheetName: title,
        title: 'River View Cooperative Housing Society Ltd.',
        subtitle: title,
        meta: [`Generated: ${new Date().toLocaleDateString('en-PK')} | Records: ${data.length}`],
        headers: keys.map(key => key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())),
        rows: data.map(row => keys.map(key => row[key] ?? '')),
        numericColumns,
    })
}