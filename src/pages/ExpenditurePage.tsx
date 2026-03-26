import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, X, RotateCcw, Download, Search, Check, AlertTriangle } from 'lucide-react'

const ipc = (window as any).ipcRenderer
const fmt = (n: number) => `Rs. ${(n || 0).toLocaleString()}`

// ── Built-in categories — clerk recognises these immediately ──
const BUILTIN_CATEGORIES = [
    'Salaries',
    'Generator / Fuel',
    'Maintenance & Repairs',
    'Utilities',
    'Stationery & Office',
    'Security',
    'Cleaning',
    'Bank Charges',
    'Electricity Bill Tube-well',
    'Electricity Bill Streetlight',
    'Electricity Bill Office',
    'Telephone Bill Office',
    'Telephone Bill Security',
    'Repair & Maintenance Electricity Equipments',
    'Repair & Maintenance Machinery & Equipments',
    'Repair & Maintenance Office & Equipments',
    'Advertisement (AGM)',
    'Books & Periodicals & Newspapers',
    'Oil & Lubricants Expenses',
    'Post & Telegram Contribution',
    'Printing & Stationery Contribution',
    'Audit fee',
    'Professional fee',
    'Punjab Employees Social Security',
    'Travelling & Conveyance Contribution',
    'Tree Plantation',
    'Entertainment',
    'Entertainment AGM',
    'Repair & Maintenance of Building/Boundary wall',
    'Maintenance of Water Pipe Line',
    'Maintenance of Sewerage Pipeline/Gutters',
    'Repair & Maintenance of Internal Roads',
    'Miscellaneous Expenses',
    'Unexpected Expenses',
    'Other',
]

const PAYMENT_METHODS = [
    { value: 'cash', label: 'Cash' },
    { value: 'bank', label: 'Bank Transfer' },
    { value: 'cheque', label: 'Cheque' },
]

const empty = {
    expenditureDate: new Date().toISOString().split('T')[0],
    category: '',
    customCategory: '',
    description: '',
    amount: '',
    paymentMethod: 'cash' as 'cash' | 'bank' | 'cheque',
    vendorName: '',
    receiptNumber: '',
    accountId: '',
}

function ModalOverlay({ onClose, children }: { onClose:()=>void; children:React.ReactNode }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:999, background:'rgba(0,0,0,0.35)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      {children}
    </div>
  )
}

function PanelShell({ width=480, children }: { width?:number; children:React.ReactNode }) {
  return (
    <div onMouseDown={e => e.stopPropagation()}
      style={{ position:'fixed', right:0, top:0, width, height:'100vh', zIndex:1000,
        overflowY:'auto', background:'var(--bg-card)',
        boxShadow:'-4px 0 24px rgba(0,0,0,0.18)', display:'flex', flexDirection:'column' }}>
      {children}
    </div>
  )
}

// ── Inline slide-down form (not a modal) ─────────────────────
function ExpenseForm({
    onSaved, onCancel
}: { accounts: any[], onSaved: () => void, onCancel: () => void }) {
    const [f, setF] = useState({ ...empty })
    const [cashBalance, setCashBalance] = useState(0)
    const [bankBalance, setBankBalance] = useState(0)
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState('')
    const amountRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        amountRef.current?.focus()
        if (!ipc) return
        Promise.all([
            ipc.invoke('db:get-cash-balance'),
            ipc.invoke('db:get-bank-balance'),
        ]).then(([cash, bank]) => {
            setCashBalance(Number(cash) || 0)
            setBankBalance(Number(bank) || 0)
        }).catch(() => {
            setCashBalance(0)
            setBankBalance(0)
        })
    }, [])

    const category = f.category === 'Other (custom)' ? f.customCategory : f.category
    const canSave = !!category && !!f.description && parseFloat(f.amount) > 0 && !!f.expenditureDate

    const handleSave = async () => {
        setErr('')
        const amt = parseFloat(f.amount)
        if (!category) { setErr('Select a category'); return }
        if (!f.description) { setErr('Enter a description'); return }
        if (!amt || amt <= 0) { setErr('Enter a valid amount'); return }
        setSaving(true)
        try {
            await ipc.invoke('db:add-expenditure', {
                expenditureDate: f.expenditureDate,
                category,
                description: f.description,
                amount: amt,
                paymentMethod: f.paymentMethod,
                vendorName: f.vendorName || null,
                receiptNumber: f.receiptNumber || null,
                accountId: f.accountId || null,
            })
            onSaved()
        } catch (e: any) {
            setErr(e.message || 'Failed to save')
            setSaving(false)
        }
    }

    // What journal entry will be posted — shown to user before they save
    const cashLabel = f.paymentMethod === 'bank' ? 'Allied Bank (1001)' : 'Cash in Hand (1000)'

    return (
    <PanelShell width={500}>
        <div className="panel-header">
            <h2 style={{ margin:0 }}>Record Expenditure</h2>
            <button className="panel-close" onClick={onCancel}><X size={16}/></button>
        </div>
        <div className="panel-body" style={{ flex:1 }}>

                {/* Row 1: Date + Category */}
                <div className="form-grid" style={{ marginBottom: 14 }}>
                    <div className="form-group">
                        <label>Date</label>
                        <input type="date" value={f.expenditureDate}
                            onChange={e => setF({ ...f, expenditureDate: e.target.value })} />
                    </div>
                    <div className="form-group">
                        <label>Category</label>
                        <select value={f.category}
                            onChange={e => setF({ ...f, category: e.target.value, customCategory: '' })}>
                            <option value="">Select category...</option>
                            {BUILTIN_CATEGORIES.map(c => (
                                <option key={c} value={c === 'Other' ? 'Other (custom)' : c}>
                                    {c}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Custom category input — only shown when "Other" is selected */}
                {f.category === 'Other (custom)' && (
                    <div className="form-group" style={{ marginBottom: 14 }}>
                        <label>Custom Category Name</label>
                        <input type="text"
                            value={f.customCategory}
                            onChange={e => setF({ ...f, customCategory: e.target.value })}
                            placeholder="e.g. Fumigation, Water tanker, Event..."
                            autoFocus
                        />
                    </div>
                )}

                {/* Row 2: Description (full width) */}
                <div className="form-group" style={{ marginBottom: 14 }}>
                    <label>Description</label>
                    <input type="text" value={f.description}
                        onChange={e => setF({ ...f, description: e.target.value })}
                        placeholder="What was this expense for?" />
                </div>

                {/* Row 3: Amount + Method */}
                <div className="form-grid" style={{ marginBottom: 14 }}>
                    <div className="form-group">
                        <label>Amount (Rs.)</label>
                        <input
                            ref={amountRef}
                            type="number" min="0"
                            value={f.amount}
                            onChange={e => setF({ ...f, amount: e.target.value })}
                            placeholder="0"
                            className="input-mono"
                            style={{ fontSize: 15, fontWeight: 600 }}
                        />
                    </div>
                    <div className="form-group">
                        <label>Paid By</label>
                        <div className="method-group">
                            {PAYMENT_METHODS.map(m => (
                                <button key={m.value}
                                    className={`method-btn ${f.paymentMethod === m.value ? 'selected' : ''}`}
                                    onClick={() => setF({ ...f, paymentMethod: m.value as any })}>
                                    {m.label}
                                </button>
                            ))}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--t-faint)', marginTop: 4 }}>
                            Available: <strong style={{ fontFamily: 'IBM Plex Mono' }}>
                                Rs. {(f.paymentMethod === 'bank' ? bankBalance : cashBalance).toLocaleString()}
                            </strong>
                        </div>
                    </div>
                </div>

                {/* Row 4: Vendor + Receipt (optional) */}
                <div className="form-grid" style={{ marginBottom: 14 }}>
                    <div className="form-group">
                        <label>Vendor / Paid To <span style={{ color: 'var(--t-faint)', fontWeight: 400 }}>(optional)</span></label>
                        <input type="text" value={f.vendorName}
                            onChange={e => setF({ ...f, vendorName: e.target.value })}
                            placeholder="e.g. Electrician, WASA, Contractor" />
                    </div>
                    <div className="form-group">
                        <label>Receipt / Voucher No. <span style={{ color: 'var(--t-faint)', fontWeight: 400 }}>(optional)</span></label>
                        <input type="text" value={f.receiptNumber}
                            onChange={e => setF({ ...f, receiptNumber: e.target.value })}
                            placeholder="e.g. V-001" />
                    </div>
                </div>

                {/* Journal preview — shows what will be posted */}
                {parseFloat(f.amount) > 0 && category && (
                    <div style={{
                        background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                        borderRadius: 'var(--r)', padding: '10px 14px',
                        marginBottom: 14, fontSize: 12
                    }}>
                        <div style={{
                            fontFamily: 'IBM Plex Mono', fontSize: 10, fontWeight: 700,
                            textTransform: 'uppercase', letterSpacing: '0.07em',
                            color: 'var(--t-faint)', marginBottom: 6
                        }}>
                            Will be posted as
                        </div>
                        <div style={{ display: 'flex', gap: 24 }}>
                            <div>
                                <span style={{ color: 'var(--c-paid)', fontWeight: 600 }}>Dr. </span>
                                <span style={{ color: 'var(--t-muted)' }}>{category} Expense</span>
                                <span style={{ fontFamily: 'IBM Plex Mono', marginLeft: 8, color: 'var(--t-secondary)' }}>
                                    Rs. {parseFloat(f.amount || '0').toLocaleString()}
                                </span>
                            </div>
                            <div>
                                <span style={{ color: 'var(--c-overdue)', fontWeight: 600 }}>Cr. </span>
                                <span style={{ color: 'var(--t-muted)' }}>{cashLabel}</span>
                                <span style={{ fontFamily: 'IBM Plex Mono', marginLeft: 8, color: 'var(--t-secondary)' }}>
                                    Rs. {parseFloat(f.amount || '0').toLocaleString()}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {err && (
                    <div className="msg msg-error" style={{ marginBottom: 12 }}>
                        <span>{err}</span>
                        <button className="msg-close" onClick={() => setErr('')}>✕</button>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        className="btn btn-primary btn-lg"
                        onClick={handleSave}
                        disabled={!canSave || saving}
                        style={{ minWidth: 180 }}
                    >
                        <Check size={15} />
                        {saving ? 'Saving...' : 'Save & Post to Journal'}
                    </button>
                    <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
                </div>
            </div>
        </PanelShell>
    )
}

// ── Reverse panel ─────────────────────────────────────────────
function ReversePanel({ exp, onClose, onDone }: { exp: any, onClose: () => void, onDone: () => void }) {
    const [reason, setReason] = useState('')
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState('')

    const handleReverse = async () => {
        if (!reason.trim()) { setErr('Enter a reason for the reversal'); return }
        setSaving(true)
        try {
            await ipc.invoke('db:reverse-expenditure', { id: exp.id, reason })
            onDone(); onClose()
        } catch (e: any) { setErr(e.message); setSaving(false) }
    }

    return (
        <ModalOverlay onClose={onClose}>
            <PanelShell width={460}>
                <div className="panel-header">
                    <h2>Expenditure Detail</h2>
                    <button className="panel-close" onClick={onClose}><X size={16} /></button>
                </div>
                <div className="panel-body">

                    {/* Detail rows */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20, fontSize: 13 }}>
                        <tbody>
                            {[
                                ['Date', exp.expenditure_date],
                                ['Category', exp.category],
                                ['Description', exp.description],
                                ['Amount', fmt(exp.amount)],
                                ['Paid by', exp.payment_method?.toUpperCase()],
                                ['Vendor', exp.vendor_name || '—'],
                                ['Receipt No.', exp.receipt_number || '—'],
                                ['Journal', exp.journal_entry_id ? `#${exp.journal_entry_id} — Posted` : 'Not yet posted'],
                            ].map(([k, v]) => (
                                <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{
                                        padding: '7px 0', color: 'var(--t-faint)', width: '38%',
                                        fontSize: 11, fontFamily: 'IBM Plex Mono', fontWeight: 600,
                                        textTransform: 'uppercase', letterSpacing: '0.05em'
                                    }}>
                                        {k}
                                    </td>
                                    <td style={{
                                        padding: '7px 0', fontWeight: k === 'Amount' ? 600 : 400,
                                        fontFamily: k === 'Amount' || k === 'Journal' ? 'IBM Plex Mono' : undefined,
                                        color: k === 'Amount' ? 'var(--c-overdue)' : 'var(--t-secondary)'
                                    }}>
                                        {v}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Reverse section */}
                    {exp.journal_entry_id ? (
                        <div style={{
                            border: '1px solid var(--c-overdue-border)',
                            borderRadius: 'var(--r)', padding: '14px',
                            background: 'var(--c-overdue-bg)'
                        }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 10 }}>
                                <AlertTriangle size={14} style={{ color: 'var(--c-overdue)', flexShrink: 0, marginTop: 1 }} />
                                <p style={{ fontSize: 12.5, color: 'var(--t-secondary)', lineHeight: 1.5 }}>
                                    Reversing will post a correcting journal entry to cancel this expense in the ledger.
                                    The original entry will be marked deleted. Re-enter the correct amount after reversing.
                                </p>
                            </div>
                            <div className="form-group" style={{ marginBottom: 10 }}>
                                <label>Reason for reversal</label>
                                <input type="text" value={reason}
                                    onChange={e => setReason(e.target.value)}
                                    placeholder="e.g. Wrong amount, duplicate entry..." />
                            </div>
                            {err && <div className="msg msg-error" style={{ marginBottom: 8 }}><span>{err}</span></div>}
                            <button
                                className="btn btn-danger btn-lg"
                                onClick={handleReverse}
                                disabled={saving || !reason.trim()}
                                style={{ width: '100%', justifyContent: 'center' }}
                            >
                                <RotateCcw size={15} /> {saving ? 'Reversing...' : 'Reverse This Entry'}
                            </button>
                        </div>
                    ) : (
                        <p style={{ fontSize: 12.5, color: 'var(--t-faint)', fontStyle: 'italic' }}>
                            This entry has not been posted to the journal yet.
                        </p>
                    )}
                </div>
            </PanelShell>
        </ModalOverlay>
    )
}

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
export default function ExpenditurePage() {
    const now = new Date()
    const [startDate, setStartDate] = useState(
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    )
    const [endDate, setEndDate] = useState(now.toISOString().split('T')[0])
    const [catFilter, setCatFilter] = useState('')
    const [search, setSearch] = useState('')
    const [expenditures, setExp] = useState<any[]>([])
    const [accounts, setAccounts] = useState<any[]>([])
    const [showForm, setShowForm] = useState(false)
    const [selected, setSelected] = useState<any>(null)
    const [msg, setMsg] = useState('')
    const [msgType, setMsgType] = useState<'success' | 'error'>('success')
    const [loading, setLoading] = useState(false)

    const load = useCallback(async () => {
        if (!ipc) return
        setLoading(true)
        try {
            const [exps, accs] = await Promise.all([
                ipc.invoke('db:get-expenditures', {
                    startDate, endDate,
                    category: catFilter || undefined
                }),
                ipc.invoke('db:get-accounts'),
            ])
            setExp(exps)
            setAccounts(accs.filter((a: any) => a.account_type === 'expense'))
        } catch (e) { console.error(e) }
        finally { setLoading(false) }
    }, [startDate, endDate, catFilter])

    useEffect(() => { load() }, [load])

    const showSuccess = (m: string) => {
        setMsg(m); setMsgType('success')
        setTimeout(() => setMsg(''), 4000)
    }

    // Filter by search
    const q = search.toLowerCase()
    const displayed = q
        ? expenditures.filter(e =>
            e.description?.toLowerCase().includes(q) ||
            e.vendor_name?.toLowerCase().includes(q) ||
            e.category?.toLowerCase().includes(q)
        )
        : expenditures

    // Totals
    const totalSpent = displayed.reduce((s, e) => s + (e.amount || 0), 0)
    const cashTotal = displayed.filter(e => e.payment_method === 'cash').reduce((s, e) => s + e.amount, 0)
    const bankTotal = displayed.filter(e => e.payment_method !== 'cash').reduce((s, e) => s + e.amount, 0)

    // Unique categories from data for filter dropdown
    const allCats = [...new Set(expenditures.map(e => e.category))].sort()

    return (
        <div className="page">

            {/* ── Header ── */}
            <div className="page-header">
                <div>
                    <h1>Expenditures</h1>
                    <p className="subtitle">Posted entries are immutable — use Reverse to correct errors</p>
                </div>
                <div className="header-actions">
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                    <select value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                        <option value="">All Categories</option>
                        {allCats.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button className="btn btn-ghost" onClick={async () => {
                        const r = await ipc.invoke('db:export-spreadsheet', 'expenditures')
                        if (r.success) showSuccess('Exported successfully')
                    }}>
                        <Download size={15} /> Export Excel
                    </button>
                    <button className="btn btn-primary"
                        onClick={() => setShowForm(s => !s)}>
                        <Plus size={15} /> Add Expenditure
                    </button>
                </div>
            </div>

            {msg && (
                <div className={`msg ${msgType === 'error' ? 'msg-error' : 'msg-success'}`} style={{ marginBottom: 16 }}>
                    <span>{msg}</span>
                    <button className="msg-close" onClick={() => setMsg('')}>✕</button>
                </div>
            )}

            {/* ── Inline form ── */}
            {showForm && (
                <ModalOverlay onClose={() => setShowForm(false)}>
                    <ExpenseForm
                        accounts={accounts}
                        onSaved={() => { setShowForm(false); load(); showSuccess('Expenditure posted') }}
                        onCancel={() => setShowForm(false)}
                    />
                </ModalOverlay>
            )}

            {/* ── KPI strip ── */}
            <div className="kpi-grid" style={{ marginBottom: 20 }}>
                <div className="kpi-cell">
                    <div className="kpi-label">Total Spent</div>
                    <div className="kpi-value" style={{ color: 'var(--c-overdue)' }}>
                        Rs. {totalSpent.toLocaleString()}
                    </div>
                    <div className="kpi-sub">{displayed.length} transactions</div>
                </div>
                <div className="kpi-cell">
                    <div className="kpi-label">Cash Payments</div>
                    <div className="kpi-value">Rs. {cashTotal.toLocaleString()}</div>
                    <div className="kpi-sub">from Cash in Hand</div>
                </div>
                <div className="kpi-cell">
                    <div className="kpi-label">Bank Payments</div>
                    <div className="kpi-value">Rs. {bankTotal.toLocaleString()}</div>
                    <div className="kpi-sub">from Bank account</div>
                </div>
                <div className="kpi-cell">
                    <div className="kpi-label">Period</div>
                    <div className="kpi-value" style={{ fontSize: 15, letterSpacing: '-0.01em' }}>
                        {startDate}
                    </div>
                    <div className="kpi-sub">to {endDate}</div>
                </div>
            </div>

            {/* ── Table ── */}
            <div className="table-wrap">
                <div className="table-search">
                    <Search size={14} style={{ color: 'var(--t-faint)' }} />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search description, vendor, category..."
                    />
                </div>
                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width: 90 }}>Date</th>
                            <th style={{ width: 130 }}>Category</th>
                            <th>Description</th>
                            <th style={{ width: 130 }}>Vendor</th>
                            <th style={{ width: 90 }}>Method</th>
                            <th style={{ textAlign: 'right', width: 110 }}>Amount</th>
                            <th style={{ width: 70 }}>Posted</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--t-faint)', fontSize: 13 }}>Loading...</td></tr>
                        ) : displayed.length === 0 ? (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 36, color: 'var(--t-faint)', fontSize: 13 }}>
                                No expenditures in this period.{' '}
                                <button onClick={() => setShowForm(true)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontSize: 13 }}>
                                    Add one
                                </button>
                            </td></tr>
                        ) : displayed.map((e: any) => (
                            <tr key={e.id} onClick={() => setSelected(e)}>
                                <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-faint)' }}>{e.expenditure_date}</td>
                                <td><span className="badge badge-gray" style={{ fontSize: 11 }}>{e.category}</span></td>
                                <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {e.description}
                                </td>
                                <td style={{ color: 'var(--t-muted)', fontSize: 12.5 }}>{e.vendor_name || '—'}</td>
                                <td>
                                    <span className={`badge ${e.payment_method === 'cash' ? 'badge-gray' : 'badge-blue'}`} style={{ fontSize: 10 }}>
                                        {e.payment_method?.toUpperCase()}
                                    </span>
                                </td>
                                <td className="td-mono" style={{ color: 'var(--c-overdue)' }}>
                                    {(e.amount || 0).toLocaleString()}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    {e.journal_entry_id
                                        ? <Check size={13} style={{ color: 'var(--c-paid)' }} />
                                        : <span style={{ fontSize: 10, color: 'var(--t-faint)' }}>—</span>
                                    }
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="table-footer">
                    <span>{displayed.length} records</span>
                    <span style={{ fontFamily: 'IBM Plex Mono', color: 'var(--c-overdue)' }}>
                        Total: Rs. {totalSpent.toLocaleString()}
                    </span>
                </div>
            </div>

            {/* ── Reverse panel ── */}
            {selected && (
                <ReversePanel
                    exp={selected}
                    onClose={() => setSelected(null)}
                    onDone={() => { load(); setSelected(null) }}
                />
            )}
        </div>
    )
}