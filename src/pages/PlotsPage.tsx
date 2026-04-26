import { useState, useEffect, useCallback, useRef } from 'react'
import {
    Plus, X, Search, Home, User, ArrowRightLeft, History,
    Check, Trash2, Edit2, Printer, CreditCard, RefreshCw, Landmark, Download
} from 'lucide-react'
import { exportExcelFile } from '../utils/exportExcel'

const ipc = (window as any).ipcRenderer
const fmt = (n: number) => `Rs. ${(n || 0).toLocaleString()}`

// ── CNIC & Phone Constants ─────────────────────────────────────
const CNIC_MAX_LEN = 15 // 35201-1234567-1
const PHONE_MAX_LEN = 12 // 0300-1234567

function normalizeCnicInput(value: string) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 13)
    const p1 = digits.slice(0, 5)
    const p2 = digits.slice(5, 12)
    const p3 = digits.slice(12, 13)
    if (!p1) return ''
    if (!p2) return p1
    if (!p3) return `${p1}-${p2}`
    return `${p1}-${p2}-${p3}`
}

function normalizePhoneInput(value: string) {
    let digits = String(value || '').replace(/\D/g, '')
    // Accept +92XXXXXXXXXX and normalize to 03XXXXXXXXX.
    if (digits.startsWith('92') && digits.length >= 12) {
        digits = `0${digits.slice(2)}`
    }
    digits = digits.slice(0, 11)
    const p1 = digits.slice(0, 4)
    const p2 = digits.slice(4, 11)
    if (!p1) return ''
    if (!p2) return p1
    return `${p1}-${p2}`
}

function isValidCnic(value: string) {
    const digits = String(value || '').replace(/\D/g, '')
    return digits.length === 13
}

function isValidPhone(value: string) {
    const digits = String(value || '').replace(/\D/g, '')
    return digits.length === 11
}

// ── Constants ──────────────────────────────────────────────────
const PLOT_TYPES = [
    { value: 'residential_constructed', label: 'Residential (Constructed)' },
    { value: 'residential_vacant', label: 'Residential (Vacant)' },
    { value: 'commercial', label: 'Commercial' },
]
const MARLA_SIZES = ['5 Marla', '8 Marlai', '10 Marla', '1 Kanal', '2 Kanal']
const TYPE_BADGE: Record<string, string> = {
    residential_constructed: 'badge-blue',
    residential_vacant: 'badge-purple',
    commercial: 'badge-orange',
}
const TYPE_LABEL: Record<string, string> = {
    residential_constructed: 'Residential',
    residential_vacant: 'Vacant',
    commercial: 'Commercial',
}
const emptyPlot = {
    plot_number: '', marla_size: '5 Marla',
    plot_type: 'residential_vacant', commercial_floors: 0,
    has_water_connection: 0, has_sewerage_connection: 0,
    has_mosque_contribution: 1,
    upper_floors_residential: 0, notes: ''
}

// ── Toggle ─────────────────────────────────────────────────────
function Toggle({ checked, onChange, label }: { checked: boolean, onChange: (v: boolean) => void, label: string }) {
    return (
        <button type="button" onClick={() => onChange(!checked)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0
        }}>
            <div style={{
                width: 36, height: 20, borderRadius: 10,
                background: checked ? 'var(--accent)' : 'var(--border-strong)',
                position: 'relative', transition: 'background .15s', flexShrink: 0
            }}>
                <div style={{
                    position: 'absolute', top: 2, left: checked ? 18 : 2,
                    width: 16, height: 16, borderRadius: '50%', background: '#fff',
                    boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .15s'
                }} />
            </div>
            <span style={{ fontSize: 13, color: 'var(--t-secondary)', fontWeight: 500 }}>{label}</span>
        </button>
    )
}

// ── Status badge ───────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { label: string, cls: string }> = {
        paid: { label: 'Paid', cls: 'badge-paid' },
        partial: { label: 'Partial', cls: 'badge-partial' },
        overdue: { label: 'Overdue', cls: 'badge-overdue' },
        unpaid: { label: 'Unpaid', cls: 'badge-unpaid' },
        voided: { label: 'Voided', cls: 'badge-gray' },
    }
    const s = map[status] || { label: status, cls: 'badge-gray' }
    return <span className={`badge ${s.cls}`}>{s.label}</span>
}

// ══════════════════════════════════════════════════════════════
// PAYMENT PANEL (identical to BillingPage's)
// ══════════════════════════════════════════════════════════════
function PaymentPanel({ bill, detail, onClose, onSaved }: {
    bill: any, detail: any, onClose: () => void, onSaved: () => void
}) {
    const [amount, setAmount] = useState(bill.balance_due?.toString() || '')
    const [method, setMethod] = useState<'cash' | 'bank'>('cash')
    const [bankId, setBankId] = useState('')
    const [banks, setBanks] = useState<any[]>([])
    const [banksLoading, setBanksLoading] = useState(false)
    const [notes, setNotes] = useState('')
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState('')
    const [liveDetail, setLiveDetail] = useState<any>(detail)
    const amountRef = useRef<HTMLInputElement>(null)

    const billRow = liveDetail?.bill || bill

    useEffect(() => { setTimeout(() => amountRef.current?.focus(), 150) }, [])

    useEffect(() => { setLiveDetail(detail) }, [detail?.bill?.id])

    const loadBanks = useCallback(async () => {
        if (!ipc) return
        setBanksLoading(true)
        try {
            const list = await ipc.invoke('db:get-banks')
            setBanks(list || [])
        } catch {
            setBanks([])
        } finally {
            setBanksLoading(false)
        }
    }, [])

    useEffect(() => {
        loadBanks()
        const timer = window.setInterval(loadBanks, 15000)
        return () => window.clearInterval(timer)
    }, [loadBanks])

    useEffect(() => {
        if (method !== 'bank') {
            setBankId('')
            return
        }
        if (!banks.length) {
            setBankId('')
            return
        }
        const stillAvailable = bankId && banks.some((bank: any) => String(bank.id) === String(bankId))
        if (!stillAvailable) {
            const preferredBank = banks.find((bank: any) => bank.is_default) || banks[0]
            setBankId(preferredBank ? String(preferredBank.id) : '')
        }
    }, [method, banks, bankId])

    const handleSave = async () => {
        const amt = parseFloat(amount)
        if (!amt || amt <= 0) { setMsg('Enter a valid amount'); return }
        if (amt > billRow.balance_due + 0.01) {
            setMsg(`Exceeds balance due (Rs. ${billRow.balance_due.toLocaleString()})`); return
        }
        if (method === 'bank' && !bankId) {
            setMsg('Select a bank account'); return
        }
        setSaving(true)
        try {
            await ipc.invoke('db:record-payment', {
                billId: bill.id,
                amount: amt,
                paymentMethod: method,
                bankId: method === 'bank' ? Number(bankId) : null,
                notes: notes || null
            })
            onSaved(); onClose()
        } catch (e: any) { setMsg(e.message); setSaving(false) }
    }

    return (
        <div className="panel-overlay" style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.3)' }}
            onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="panel" style={{ width: 700, position: 'fixed', right: 0, top: 0, height: '100vh', zIndex: 1000, overflowY: 'auto' }}>
                <div className="panel-header">
                    <div>
                        <h2>Record Payment</h2>
                        <div style={{ fontSize: 11, color: 'var(--t-faint)', fontFamily: 'IBM Plex Mono', marginTop: 1 }}>
                            Plot {bill.plot_number} · {bill.bill_number}
                        </div>
                    </div>
                    <button className="panel-close" onClick={onClose}><X size={16} /></button>
                </div>

                <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
                    <div style={{
                        background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                        borderRadius: 'var(--r)', padding: '12px 14px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <div>
                                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-primary)' }}>
                                    {billRow.owner_name || 'No owner'}
                                </span>
                                {billRow.bill_type === 'special' && (
                                    <span className="badge badge-purple" style={{ fontSize: 10, marginLeft: 8 }}>Special</span>
                                )}
                            </div>
                            <StatusBadge status={billRow.status} />
                        </div>

                        <div style={{ display: 'grid', gap: 6 }}>
                            {detail?.items?.map((item: any) => (
                                <div key={item.id} style={{
                                    display: 'grid', gridTemplateColumns: '1fr auto',
                                    gap: 12, padding: '4px 0', borderTop: '1px solid var(--border)', fontSize: 12.5
                                }}>
                                    <span style={{ color: 'var(--t-muted)' }}>{item.charge_name}</span>
                                    <span style={{ fontFamily: 'IBM Plex Mono', color: 'var(--t-secondary)' }}>
                                        Rs. {(item.amount || 0).toLocaleString()}
                                    </span>
                                </div>
                            ))}
                            <div style={{ borderTop: '1px solid var(--border-strong)', marginTop: 6, paddingTop: 6 }}>
                                {bill.amount_paid > 0 && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                                        <span style={{ color: 'var(--t-faint)' }}>Already paid</span>
                                        <span style={{ fontFamily: 'IBM Plex Mono', color: 'var(--c-paid)' }}>
                                            Rs. {bill.amount_paid.toLocaleString()}
                                        </span>
                                    </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                                    <span style={{ fontWeight: 600 }}>Balance due</span>
                                    <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 700, color: 'var(--c-overdue)', fontSize: 15 }}>
                                        Rs. {bill.balance_due.toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gap: 14, border: '1px solid var(--border-strong)', borderRadius: 10, background: 'var(--bg-subtle)', padding: '12px 14px' }}>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label>Amount Received (Rs.)</label>
                                <input ref={amountRef} type="number" className="input-mono"
                                    value={amount} onChange={e => setAmount(e.target.value)}
                                    placeholder="0" min="0"
                                    style={{ fontSize: 18, height: 44, fontWeight: 600 }} />
                            </div>

                            <div>
                                <label style={{
                                    fontSize: 11, fontWeight: 600, color: 'var(--t-muted)',
                                    textTransform: 'uppercase', letterSpacing: '0.04em',
                                    fontFamily: 'IBM Plex Mono', display: 'block', marginBottom: 6
                                }}>Payment Method</label>
                                <div className="method-group">
                                    {(['cash', 'bank'] as const).map(m => (
                                        <button key={m}
                                            className={`method-btn ${method === m ? 'selected' : ''}`}
                                            onClick={() => setMethod(m)}>
                                            {m === 'cash' ? 'Cash' : 'Bank Transfer'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {method === 'bank' && (
                                <div className="form-group" style={{ margin: 0 }}>
                                    <label>Bank Account</label>
                                    <select value={bankId} onChange={e => setBankId(e.target.value)} disabled={banksLoading}>
                                        <option value="">{banksLoading ? 'Loading banks...' : banks.length ? 'Select a bank' : 'No active banks found'}</option>
                                        {banks.map((bank: any) => (
                                            <option key={bank.id} value={bank.id}>
                                                {bank.bank_name}{bank.linked_account_name ? ` · ${bank.linked_account_name}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <div style={{ fontSize: 12, color: 'var(--t-faint)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Landmark size={12} />
                                        Bank list is live.
                                    </div>
                                </div>
                            )}

                            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                                <div className="form-group" style={{ margin: 0 }}>
                                    <label>Notes</label>
                                    <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
                                </div>
                            </div>

                            {msg && (
                                <div className="msg msg-error">
                                    <span>{msg}</span>
                                </div>
                            )}
                        </div>
                </div>

                <div className="panel-footer">
                    <button className="btn btn-primary btn-lg" style={{ flex: 1, justifyContent: 'center' }}
                        onClick={handleSave} disabled={saving || !amount}>
                        <Check size={16} />
                        {saving ? 'Saving...' : `Record — Rs. ${parseFloat(amount || '0').toLocaleString()}`}
                    </button>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    )
}

// ══════════════════════════════════════════════════════════════
// PLOT STATEMENT TAB
// ══════════════════════════════════════════════════════════════
function PlotStatement({ plotId, onPaymentSaved }: { plotId: number, onPaymentSaved: () => void }) {
    const [data, setData] = useState<any>(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [payBill, setPayBill] = useState<any>(null)
    const [payDetail, setPayDetail] = useState<any>(null)
    const [filter, setFilter] = useState<'all' | 'monthly' | 'special' | 'general' | 'unpaid'>('all')

    const loadStatement = useCallback(async () => {
        if (!ipc || !plotId) return
        setRefreshing(true)
        setError('')
        try {
            setData(await ipc.invoke('db:get-plot-statement', plotId))
        }
        catch (e: any) {
            console.error(e)
            setData(null)
            setError(e?.message || 'Failed to load plot statement')
        }
        finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [plotId])

    useEffect(() => { loadStatement() }, [loadStatement])

    const openPayment = async (bill: any) => {
        if (bill.status === 'paid') return
        setPayBill(bill)
        try { setPayDetail(await ipc.invoke('db:get-bill-detail', bill.id)) }
        catch (e) { console.error(e) }
    }

    const handlePrintUnpaid = async () => {
        if (!data || !ipc) return
        const unpaid = data.bills.filter((b: any) => ['unpaid', 'partial', 'overdue'].includes(b.status))
        for (const b of unpaid) {
            await ipc.invoke('db:print-challan', { billId: b.id, amount: null })
        }
    }

    if (loading) return (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--t-faint)', fontSize: 13 }}>
            Loading statement...
        </div>
    )
    if (error) return (
        <div style={{ padding: 22 }}>
            <div className="msg msg-error">
                <span>{error}</span>
            </div>
        </div>
    )
    if (!data) return null

    const { summary, bills, plot } = data

    const displayed = bills.filter((b: any) => {
        if (filter === 'monthly') return b.bill_type === 'monthly'
        if (filter === 'special') return b.bill_type === 'special'
        if (filter === 'general') return b.bill_type === 'general'
        if (filter === 'unpaid') return ['unpaid', 'partial', 'overdue'].includes(b.status)
        return true
    })

    return (
        <div>
            {/* ── Summary strip (same 4-cell layout as MemberStatement) ── */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
                gap: 1, background: 'var(--border)',
                border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                overflow: 'hidden', marginBottom: 14, boxShadow: 'var(--shadow-card)'
            }}>
                {[
                    { label: 'Total Billed', value: fmt(summary.totalBilled), color: 'var(--t-primary)' },
                    { label: 'Total Paid', value: fmt(summary.totalPaid), color: 'var(--c-paid)' },
                    { label: 'Outstanding', value: fmt(summary.totalOutstanding), color: summary.totalOutstanding > 0 ? 'var(--c-overdue)' : 'var(--t-primary)' },
                    { label: 'Unpaid Bills', value: String(summary.unpaidCount), color: summary.unpaidCount > 0 ? 'var(--c-overdue)' : 'var(--t-primary)' },
                ].map(s => (
                    <div key={s.label} style={{ background: 'var(--bg)', padding: '14px 16px' }}>
                        <div style={{
                            fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.07em', color: 'var(--t-faint)',
                            fontFamily: 'IBM Plex Mono', marginBottom: 6
                        }}>{s.label}</div>
                        <div style={{
                            fontSize: 16, fontWeight: 700, fontFamily: 'IBM Plex Mono',
                            color: s.color, letterSpacing: '-0.02em'
                        }}>{s.value}</div>
                    </div>
                ))}
            </div>

            {/* ── Owner info chip ── */}
            {plot.owner_name && (
                <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        background: 'var(--accent-light)', border: '1px solid var(--accent-border)',
                        borderRadius: 'var(--r)', padding: '5px 10px', fontSize: 12.5
                    }}>
                        <User size={12} style={{ color: 'var(--accent)' }} />
                        <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{plot.owner_name}</span>
                        {plot.owner_phone && (
                            <span style={{ color: 'var(--t-muted)', fontSize: 11, fontFamily: 'IBM Plex Mono' }}>
                                {plot.owner_phone}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* ── Filter + print bar ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                    {([
                        { key: 'all', label: `All (${bills.length})` },
                        { key: 'monthly', label: `Monthly (${summary.monthlyCount})` },
                        { key: 'special', label: `Special (${summary.specialCount})` },
                        { key: 'general', label: `General (${summary.generalCount})` },
                        { key: 'unpaid', label: `Unpaid (${summary.unpaidCount})` },
                    ] as const).map(f => (
                        <button key={f.key}
                            onClick={() => setFilter(f.key)}
                            style={{
                                padding: '4px 10px', borderRadius: 'var(--r)', fontSize: 11.5,
                                fontWeight: filter === f.key ? 600 : 400,
                                background: filter === f.key ? 'var(--accent-light)' : 'transparent',
                                border: `1px solid ${filter === f.key ? 'var(--accent-border)' : 'transparent'}`,
                                color: filter === f.key ? 'var(--accent)' : 'var(--t-muted)',
                                cursor: 'pointer'
                            }}>
                            {f.label}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={loadStatement}
                        disabled={refreshing}
                        title="Refresh statement"
                    >
                        <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
                        {refreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                    {summary.unpaidCount > 0 && (
                        <button className="btn btn-ghost btn-sm" onClick={handlePrintUnpaid}>
                            <Printer size={12} /> Print Unpaid
                        </button>
                    )}
                </div>
            </div>

            {/* ── Bills table ── */}
            <div className="table-wrap">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Bill #</th>
                            <th style={{ width: 80 }}>Type</th>
                            <th>Month / Date</th>
                            <th style={{ textAlign: 'right' }}>Total</th>
                            <th style={{ textAlign: 'right' }}>Paid</th>
                            <th style={{ textAlign: 'right' }}>Balance</th>
                            <th>Status</th>
                            <th style={{ width: 80 }} />
                        </tr>
                    </thead>
                    <tbody>
                        {displayed.length === 0 ? (
                            <tr><td colSpan={8} style={{
                                textAlign: 'center', padding: 32,
                                color: 'var(--t-faint)', fontSize: 13
                            }}>
                                No bills match this filter.
                            </td></tr>
                        ) : displayed.map((b: any) => (
                            <tr key={b.id}>
                                <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 11.5, color: 'var(--t-faint)' }}>
                                    {b.bill_number}
                                </td>
                                <td>
                                    <span className={`badge ${b.bill_type === 'special' ? 'badge-purple' : b.bill_type === 'general' ? 'badge-blue' : 'badge-gray'}`}
                                        style={{ fontSize: 10 }}>
                                        {b.bill_type === 'special' ? 'Special' : b.bill_type === 'general' ? 'General' : 'Monthly'}
                                    </span>
                                </td>
                                <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-muted)' }}>
                                    {b.billing_month || b.bill_date}
                                </td>
                                <td className="td-mono">{(b.total_amount || 0).toLocaleString()}</td>
                                <td className="td-mono" style={{ color: 'var(--c-paid)' }}>
                                    {b.amount_paid > 0 ? b.amount_paid.toLocaleString() : '—'}
                                </td>
                                <td className="td-mono"
                                    style={{ color: (b.actual_balance ?? b.balance_due) > 0 ? 'var(--c-overdue)' : 'var(--t-faint)' }}>
                                    {(b.actual_balance ?? b.balance_due) > 0 ? (b.actual_balance ?? b.balance_due).toLocaleString() : '—'}
                                </td>
                                <td><StatusBadge status={b.status} /></td>
                                <td>
                                    {(b.actual_balance ?? b.balance_due) > 0.01 && ['unpaid', 'partial', 'overdue'].includes(b.status) && (
                                        <button className="btn btn-ghost btn-sm"
                                            style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent)' }}
                                            onClick={() => openPayment(b)}>
                                            <CreditCard size={11} /> Collect
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {displayed.length > 0 && (
                        <tfoot>
                            <tr style={{ borderTop: '2px solid var(--border-strong)', background: 'var(--bg-subtle)' }}>
                                <td colSpan={3} style={{
                                    padding: '8px 16px', fontSize: 11, fontFamily: 'IBM Plex Mono',
                                    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                                    color: 'var(--t-muted)'
                                }}>
                                    {displayed.length} bills
                                </td>
                                <td className="td-mono" style={{ fontWeight: 700, fontSize: 13 }}>
                                    {displayed.reduce((s: number, b: any) => s + (b.total_amount || 0), 0).toLocaleString()}
                                </td>
                                <td className="td-mono" style={{ fontWeight: 700, fontSize: 13, color: 'var(--c-paid)' }}>
                                    {displayed.reduce((s: number, b: any) => s + (b.amount_paid || 0), 0).toLocaleString()}
                                </td>
                                <td className="td-mono" style={{ fontWeight: 700, fontSize: 13, color: 'var(--c-overdue)' }}>
                                    {displayed.reduce((s: number, b: any) => s + ((b.actual_balance ?? b.balance_due) || 0), 0).toLocaleString()}
                                </td>
                                <td /><td />
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            {payBill && (
                <PaymentPanel
                    bill={payBill} detail={payDetail}
                    onClose={() => { setPayBill(null); setPayDetail(null) }}
                    onSaved={() => { loadStatement(); onPaymentSaved() }}
                />
            )}
        </div>
    )
}

// ══════════════════════════════════════════════════════════════
// PLOT FORM (add / edit)
// ══════════════════════════════════════════════════════════════
function PlotForm({ form, onChange }: { form: any, onChange: (f: any) => void }) {
    const set = (k: string, v: any) => onChange({ ...form, [k]: v })
    const isCommercial = form.plot_type === 'commercial'
    const isResidentialConstructed = form.plot_type === 'residential_constructed'
    const showFloors = isCommercial || isResidentialConstructed
    const maxFloors = isResidentialConstructed ? 4 : 20
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
                <label>Plot Number *</label>
                <input type="text" value={form.plot_number}
                    onChange={e => set('plot_number', e.target.value)}
                    placeholder="e.g. 122-A"
                    style={{ fontFamily: 'IBM Plex Mono', fontWeight: 600 }} autoFocus />
            </div>
            <div className="form-grid">
                <div className="form-group">
                    <label>Size</label>
                    <select value={form.marla_size} onChange={e => set('marla_size', e.target.value)}>
                        {MARLA_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label>Plot Type</label>
                    <select value={form.plot_type} onChange={e => {
                        const nextType = e.target.value
                        const nextFloors = nextType === 'residential_constructed'
                            ? Math.min(Number(form.commercial_floors || 0), 4)
                            : Number(form.commercial_floors || 0)
                        onChange({ ...form, plot_type: nextType, commercial_floors: nextFloors })
                    }}>
                        {PLOT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                </div>
            </div>
            {showFloors && (
                <div style={{
                    background: 'var(--bg-subtle)', border: '1px solid var(--accent-border)',
                    borderRadius: 'var(--r-lg)', padding: '14px 16px',
                    display: 'flex', flexDirection: 'column', gap: 12
                }}>
                    <div style={{
                        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.07em', color: 'var(--accent)', fontFamily: 'IBM Plex Mono'
                    }}>
                        Building Details
                    </div>
                    <div className="form-grid">
                        <div className="form-group">
                            <label>{isCommercial ? 'No. of Commercial Floors' : 'No. of Residential Floors'}</label>
                            <input type="number" min="0" max={maxFloors} value={form.commercial_floors}
                                onChange={e => {
                                    const raw = parseInt(e.target.value, 10)
                                    const next = Number.isFinite(raw) ? Math.max(0, Math.min(raw, maxFloors)) : 0
                                    set('commercial_floors', next)
                                }}
                                style={{ fontFamily: 'IBM Plex Mono', fontWeight: 600 }} />
                            <span style={{ fontSize: 11, color: 'var(--t-faint)', marginTop: 2 }}>
                                {isCommercial ? 'Rs. 700/floor added to monthly bill' : 'Maximum 4 floors for residential constructed plots'}
                            </span>
                        </div>
                        {isCommercial && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
                                <Toggle checked={!!form.upper_floors_residential}
                                    onChange={v => set('upper_floors_residential', v ? 1 : 0)}
                                    label="Upper floors residential" />
                            </div>
                        )}
                    </div>
                    {isCommercial && (
                        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                            <Toggle checked={!!form.has_water_connection}
                                onChange={v => set('has_water_connection', v ? 1 : 0)}
                                label="Water connection" />
                        </div>
                    )}
                </div>
            )}
            {!isCommercial && (
                <div style={{ display: 'flex', gap: 24, paddingTop: 4 }}>
                    <Toggle checked={!!form.has_water_connection}
                        onChange={v => set('has_water_connection', v ? 1 : 0)}
                        label="Water connection" />
                </div>
            )}
            <div style={{ display: 'flex', gap: 24, paddingTop: 4 }}>
                <Toggle checked={!!form.has_mosque_contribution}
                    onChange={v => {
                        if (!v) {
                            const ok = window.confirm('Disable Mosque Contribution for this plot? It will be excluded from future monthly bills.');
                            if (!ok) return;
                        }
                        set('has_mosque_contribution', v ? 1 : 0)
                    }}
                    label="Include Mosque Contribution in monthly bill" />
            </div>
            <div className="form-group">
                <label>Notes</label>
                <textarea value={form.notes}
                    onChange={e => set('notes', e.target.value)} rows={2} placeholder="optional" />
            </div>
        </div>
    )
}

// ══════════════════════════════════════════════════════════════
// READ-ONLY PLOT INFO (matches MemberInfo style)
// ══════════════════════════════════════════════════════════════
function PlotInfo({ plot, owner }: { plot: any, owner: any }) {
    const row = (label: string, value: any, mono = false) => (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 0', borderBottom: '1px solid var(--border)'
        }}>
            <span style={{
                fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--t-faint)', fontFamily: 'IBM Plex Mono'
            }}>
                {label}
            </span>
            <span style={{
                fontSize: 13,
                color: (value !== null && value !== undefined && value !== '') ? 'var(--t-secondary)' : 'var(--t-faint)',
                fontFamily: mono ? 'IBM Plex Mono' : undefined,
                fontStyle: (value !== null && value !== undefined && value !== '') ? 'normal' : 'italic'
            }}>
                {(value !== null && value !== undefined && value !== '') ? value : '—'}
            </span>
        </div>
    )
    return (
        <div>
            {row('Plot Number', plot.plot_number, true)}
            {row('Size', plot.marla_size)}
            {row('Type', TYPE_LABEL[plot.plot_type] || plot.plot_type)}
            {(plot.plot_type === 'commercial' || plot.plot_type === 'residential_constructed') && row('Floors', `${plot.commercial_floors || 0} floor(s)`)}
            {plot.plot_type === 'commercial' && row('Upper Floors Residential', plot.upper_floors_residential ? 'Yes' : 'No')}
            {row('Water Connection', plot.has_water_connection ? 'Yes' : 'No')}
            {row('Mosque Contribution', plot.has_mosque_contribution ? 'Included' : 'Excluded')}
            {owner
                ? row('Current Owner', `${owner.owner_name} (since ${owner.start_date})`)
                : row('Current Owner', null)}
            {plot.notes && row('Notes', plot.notes)}
        </div>
    )
}

// ══════════════════════════════════════════════════════════════
// OWNERSHIP TAB
// ══════════════════════════════════════════════════════════════
function OwnershipTab({ plot, members, history, onRefresh }: {
    plot: any, members: any[], history: any[], onRefresh: () => void
}) {
    const [mode, setMode] = useState<'view' | 'assign' | 'transfer'>('view')
    const [assignId, setAssignId] = useState('')
    const [assignDate, setAssignDate] = useState(new Date().toISOString().split('T')[0])
    const [transferId, setTransferId] = useState('')
    const [transferDate, setTransferDate] = useState(new Date().toISOString().split('T')[0])
    const [transferDeed, setTransferDeed] = useState('')
    const [transferNotes, setTransferNotes] = useState('')
    const [err, setErr] = useState('')
    const activeOwner = history.find(o => !o.end_date)

    const handleAssign = async () => {
        if (!assignId) return; setErr('')
        try {
            await ipc.invoke('db:assign-owner', { plotId: plot.id, memberId: parseInt(assignId), startDate: assignDate })
            onRefresh(); setMode('view')
        } catch (e: any) { setErr(e.message) }
    }

    const handleTransfer = async () => {
        if (!transferId) return; setErr('')
        try {
            await ipc.invoke('db:transfer-ownership', {
                plotId: plot.id, newMemberId: parseInt(transferId),
                transferDate, deedAmount: parseFloat(transferDeed) || null, notes: transferNotes || null
            })
            onRefresh(); setMode('view')
        } catch (e: any) { setErr(e.message) }
    }

    return (
        <div>
            {/* Current owner card */}
            <div style={{
                background: activeOwner ? 'var(--accent-light)' : 'var(--bg-subtle)',
                border: `1px solid ${activeOwner ? 'var(--accent-border)' : 'var(--border)'}`,
                borderRadius: 'var(--r-lg)', padding: '14px 16px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <User size={15} style={{ color: activeOwner ? 'var(--accent)' : 'var(--t-faint)' }} />
                    <div>
                        <div style={{
                            fontSize: 13, fontWeight: 600,
                            color: activeOwner ? 'var(--accent)' : 'var(--t-faint)'
                        }}>
                            {activeOwner ? activeOwner.owner_name : 'No owner assigned'}
                        </div>
                        {activeOwner && (
                            <div style={{ fontSize: 11, color: 'var(--t-muted)', fontFamily: 'IBM Plex Mono' }}>
                                Since {activeOwner.start_date}
                            </div>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    {!activeOwner && mode !== 'assign' && (
                        <button className="btn btn-primary btn-sm" onClick={() => setMode('assign')}>
                            <User size={12} /> Assign Owner
                        </button>
                    )}
                    {activeOwner && mode !== 'transfer' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setMode('transfer')}>
                            <ArrowRightLeft size={12} /> Transfer
                        </button>
                    )}
                </div>
            </div>

            {mode === 'assign' && (
                <div style={{
                    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-lg)', padding: 16, marginBottom: 16
                }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Assign Owner</div>
                    <div className="form-grid" style={{ marginBottom: 12 }}>
                        <div className="form-group">
                            <label>Member *</label>
                            <select value={assignId} onChange={e => setAssignId(e.target.value)}>
                                <option value="">Select member...</option>
                                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Start Date</label>
                            <input type="date" value={assignDate} onChange={e => setAssignDate(e.target.value)} />
                        </div>
                    </div>
                    {err && <div className="msg msg-error" style={{ marginBottom: 10 }}><span>{err}</span></div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setMode('view'); setErr('') }}>Cancel</button>
                        <button className="btn btn-primary btn-sm" onClick={handleAssign} disabled={!assignId}>
                            <Check size={12} /> Confirm
                        </button>
                    </div>
                </div>
            )}

            {mode === 'transfer' && (
                <div style={{
                    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-lg)', padding: 16, marginBottom: 16
                }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Transfer Ownership</div>
                    <div className="form-grid" style={{ marginBottom: 12 }}>
                        <div className="form-group">
                            <label>New Owner *</label>
                            <select value={transferId} onChange={e => setTransferId(e.target.value)}>
                                <option value="">Select member...</option>
                                {members.filter(m => m.id !== activeOwner?.member_id)
                                    .map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Transfer Date</label>
                            <input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>Deed Amount (Rs.) <span style={{ color: 'var(--t-faint)', fontWeight: 400 }}>(opt)</span></label>
                            <input type="number" value={transferDeed} onChange={e => setTransferDeed(e.target.value)}
                                placeholder="0" style={{ fontFamily: 'IBM Plex Mono' }} />
                        </div>
                        <div className="form-group">
                            <label>Notes <span style={{ color: 'var(--t-faint)', fontWeight: 400 }}>(opt)</span></label>
                            <input type="text" value={transferNotes} onChange={e => setTransferNotes(e.target.value)} />
                        </div>
                    </div>
                    {err && <div className="msg msg-error" style={{ marginBottom: 10 }}><span>{err}</span></div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setMode('view'); setErr('') }}>Cancel</button>
                        <button className="btn btn-primary btn-sm" onClick={handleTransfer} disabled={!transferId}>
                            <ArrowRightLeft size={12} /> Confirm
                        </button>
                    </div>
                </div>
            )}

            <div style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--t-faint)',
                fontFamily: 'IBM Plex Mono', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6
            }}>
                <History size={11} /> Ownership History
            </div>
            <div className="table-wrap">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Owner</th><th>From</th><th>To</th>
                            <th style={{ textAlign: 'right' }}>Deed Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.length === 0 ? (
                            <tr><td colSpan={4} style={{
                                textAlign: 'center', padding: 28,
                                color: 'var(--t-faint)', fontSize: 13
                            }}>No ownership records yet.</td></tr>
                        ) : history.map((o: any) => (
                            <tr key={o.id}>
                                <td style={{ fontWeight: 500 }}>{o.owner_name}</td>
                                <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-faint)' }}>{o.start_date}</td>
                                <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12 }}>
                                    {o.end_date
                                        ? <span style={{ color: 'var(--t-faint)' }}>{o.end_date}</span>
                                        : <span className="badge badge-paid" style={{ fontSize: 10 }}>Active</span>}
                                </td>
                                <td className="td-mono">
                                    {o.transfer_deed_amount ? o.transfer_deed_amount.toLocaleString() : '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

// ══════════════════════════════════════════════════════════════
// TENANTS TAB
// ══════════════════════════════════════════════════════════════
function TenantsTab({ plot, onMsg }: { plot: any, onMsg: (m: string) => void }) {
    const [tenants, setTenants] = useState<any[]>([])
    const [showForm, setShowForm] = useState(false)
    const [editId, setEditId] = useState<number | null>(null)
    const [expandedNotes, setExpandedNotes] = useState<Record<number, boolean>>({})
    const [form, setForm] = useState({
        tenant_id: '', name: '', cnic: '', phone: '',
        start_date: new Date().toISOString().split('T')[0],
        end_date: '', monthly_rent: '2500', notes: ''
    })

    const load = useCallback(async () => {
        const data = await ipc.invoke('db:get-tenants', plot.id)
        setTenants(data || [])
    }, [plot.id])

    useEffect(() => { load() }, [load])

    const openAdd = () => {
        setForm({
            tenant_id: '', name: '', cnic: '', phone: '',
            start_date: new Date().toISOString().split('T')[0],
            end_date: '', monthly_rent: '2500', notes: ''
        })
        setEditId(null); setShowForm(true)
    }
    const openEdit = (t: any) => {
        setForm({
            tenant_id: t.tenant_id || '', name: t.name, cnic: t.cnic || '', phone: t.phone || '',
            start_date: t.start_date || '', end_date: t.end_date || '',
            monthly_rent: t.monthly_rent?.toString() || '2500', notes: t.notes || ''
        })
        setEditId(t.id); setShowForm(true)
    }
    const handleSave = async () => {
        if (!form.tenant_id.trim() || !form.name.trim() || !isValidCnic(form.cnic) || !isValidPhone(form.phone) || !form.start_date) return
        if (editId) {
            await ipc.invoke('db:update-tenant', { ...form, id: editId, monthly_rent: parseFloat(form.monthly_rent) || 0 })
        } else {
            await ipc.invoke('db:add-tenant', { ...form, plot_id: plot.id, monthly_rent: parseFloat(form.monthly_rent) || 0 })
        }
        await load(); setShowForm(false)
        onMsg(editId ? 'Tenant updated' : 'Tenant added')
    }
    const handleRemove = async () => {
        if (!editId) return
        await ipc.invoke('db:remove-tenant', editId)
        await load(); setShowForm(false); onMsg('Tenant removed')
    }
    const isActive = (t: any) => !t.end_date || new Date(t.end_date) >= new Date()
    const toggleNoteExpand = (tenantId: number) => {
        setExpandedNotes(prev => ({ ...prev, [tenantId]: !prev[tenantId] }))
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 12.5, color: 'var(--t-muted)' }}>{tenants.length} tenant(s)</span>
                <button className="btn btn-primary btn-sm" onClick={openAdd}><Plus size={12} /> Add Tenant</button>
            </div>
            {tenants.map((t: any) => (
                <div key={t.id} style={{
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-lg)', padding: '12px 14px', marginBottom: 8,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    boxShadow: 'var(--shadow-sm)'
                }}>
                    <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t.name}</span>
                            <span className={`badge ${isActive(t) ? 'badge-paid' : 'badge-gray'}`} style={{ fontSize: 10 }}>
                                {isActive(t) ? 'Active' : 'Ended'}
                            </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--t-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            {t.tenant_id && <span style={{ fontFamily: 'IBM Plex Mono' }}>Tenant ID: {t.tenant_id}</span>}
                            {t.cnic && <span style={{ fontFamily: 'IBM Plex Mono' }}>CNIC: {t.cnic}</span>}
                            {t.phone && <span style={{ fontFamily: 'IBM Plex Mono' }}>{t.phone}</span>}
                            <span style={{ fontFamily: 'IBM Plex Mono' }}>Rs. {(t.monthly_rent || 0).toLocaleString()}/mo</span>
                            {t.start_date && <span>From {t.start_date}</span>}
                        </div>
                        {!!String(t.notes || '').trim() && (() => {
                            const noteText = String(t.notes).trim()
                            const showToggle = noteText.length > 140
                            const expanded = !!expandedNotes[t.id]
                            return (
                                <div style={{
                                    marginTop: 8,
                                    background: 'var(--bg-subtle)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--r)',
                                    padding: '8px 10px'
                                }}>
                                    <div style={{
                                        fontSize: 10,
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.06em',
                                        color: 'var(--t-faint)',
                                        fontFamily: 'IBM Plex Mono',
                                        marginBottom: 4
                                    }}>
                                        Note
                                    </div>
                                    <div style={{
                                        fontSize: 12,
                                        color: 'var(--t-secondary)',
                                        lineHeight: 1.5,
                                        whiteSpace: 'pre-wrap',
                                        overflowWrap: 'anywhere',
                                        wordBreak: 'break-word',
                                        overflow: !expanded && showToggle ? 'hidden' : 'visible',
                                        maxHeight: !expanded && showToggle ? '3.6em' : 'none'
                                    }}>
                                        {noteText}
                                    </div>
                                    {showToggle && (
                                        <button
                                            className="btn btn-ghost btn-sm"
                                            style={{ marginTop: 6, padding: '2px 8px', fontSize: 11 }}
                                            onClick={() => toggleNoteExpand(t.id)}
                                        >
                                            {expanded ? 'Show less' : 'Show more'}
                                        </button>
                                    )}
                                </div>
                            )
                        })()}
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(t)}><Edit2 size={12} /></button>
                </div>
            ))}
            {tenants.length === 0 && !showForm && (
                <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--t-faint)', fontSize: 13 }}>
                    No tenants recorded for this plot.
                </div>
            )}
            {showForm && (
                <div style={{
                    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-lg)', padding: 16, marginTop: 12
                }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
                        {editId ? 'Edit Tenant' : 'Add Tenant'}
                    </div>
                    <div className="form-grid" style={{ marginBottom: 12 }}>
                        <div className="form-group">
                            <label>Tenant ID *</label>
                            <input type="text" value={form.tenant_id}
                                onChange={e => setForm({ ...form, tenant_id: e.target.value })}
                                style={{ fontFamily: 'IBM Plex Mono' }} />
                        </div>
                        <div className="form-group">
                            <label>Name *</label>
                            <input type="text" value={form.name}
                                onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
                        </div>
                        <div className="form-group">
                            <label>CNIC *</label>
                            <input type="text" value={form.cnic}
                                onChange={e => setForm({ ...form, cnic: normalizeCnicInput(e.target.value) })}
                                maxLength={CNIC_MAX_LEN}
                                placeholder="35201-1234567-1"
                                style={{ fontFamily: 'IBM Plex Mono', letterSpacing: '0.02em' }} />
                        </div>
                        <div className="form-group">
                            <label>Phone *</label>
                            <input type="text" value={form.phone}
                                onChange={e => setForm({ ...form, phone: normalizePhoneInput(e.target.value) })}
                                maxLength={PHONE_MAX_LEN}
                                placeholder="0300-1234567"
                                style={{ fontFamily: 'IBM Plex Mono' }} />
                        </div>
                        <div className="form-group">
                            <label>Monthly Rent (Rs.)</label>
                            <input type="number" value={form.monthly_rent}
                                onChange={e => setForm({ ...form, monthly_rent: e.target.value })}
                                style={{ fontFamily: 'IBM Plex Mono' }} />
                        </div>
                        <div className="form-group">
                            <label>Start Date *</label>
                            <input type="date" value={form.start_date}
                                onChange={e => setForm({ ...form, start_date: e.target.value })} />
                        </div>
                        <div className="form-group">
                            <label>End Date <span style={{ color: 'var(--t-faint)', fontWeight: 400 }}>(opt)</span></label>
                            <input type="date" value={form.end_date}
                                onChange={e => setForm({ ...form, end_date: e.target.value })} />
                        </div>
                        <div className="form-group full-width">
                            <label>Notes</label>
                            <textarea value={form.notes}
                                onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div>
                            {editId && (
                                <button className="btn btn-ghost btn-sm"
                                    style={{ color: 'var(--c-overdue)', borderColor: 'var(--c-overdue-border)' }}
                                    onClick={handleRemove}>
                                    <Trash2 size={12} /> Remove
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!form.tenant_id.trim() || !form.name.trim() || !isValidCnic(form.cnic) || !isValidPhone(form.phone) || !form.start_date}>
                                <Check size={12} /> Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ══════════════════════════════════════════════════════════════
// PLOT DETAIL PANEL  (Overview | Ownership | Tenants | Statement)
// ══════════════════════════════════════════════════════════════
type PlotTab = 'overview' | 'ownership' | 'tenants' | 'statement'
type PlotMode = 'view' | 'edit'

function PlotPanel({ plot, members, onClose, onSaved, onDeleted }: {
    plot: any, members: any[],
    onClose: () => void, onSaved: (msg: string) => void, onDeleted: () => void
}) {
    const [tab, setTab] = useState<PlotTab>('overview')
    const [mode, setMode] = useState<PlotMode>('view')
    const [form, setForm] = useState({ ...plot })
    const [ownerHistory, setOwnerHistory] = useState<any[]>([])
    const [saving, setSaving] = useState(false)
    const [confirm, setConfirm] = useState(false)
    const [msg, setMsg] = useState('')

    const loadHistory = useCallback(async () => {
        if (!ipc) return
        const h = await ipc.invoke('db:get-ownership-history', plot.id)
        setOwnerHistory(h || [])
    }, [plot.id])

    useEffect(() => {
        setForm({ ...plot, has_mosque_contribution: plot.has_mosque_contribution === 0 ? 0 : 1 });
        setTab('overview'); setMode('view'); setConfirm(false)
        loadHistory()
    }, [plot.id])

    const activeOwner = ownerHistory.find(o => !o.end_date)

    const handleSave = async () => {
        setSaving(true)
        try { await ipc.invoke('db:update-plot', { ...form, id: plot.id }); onSaved('Plot updated') }
        finally { setSaving(false) }
    }

    const cancelEdit = () => {
        setForm({ ...plot, has_mosque_contribution: plot.has_mosque_contribution === 0 ? 0 : 1 });
        setMode('view');
        setConfirm(false);
    }
    const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

    const TABS: { key: PlotTab, label: string }[] = [
        { key: 'overview', label: 'Overview' },
        { key: 'ownership', label: 'Ownership' },
        { key: 'tenants', label: 'Tenants' },
        { key: 'statement', label: 'Statement' },
    ]

    return (
        <div className="panel-overlay" style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.3)' }} onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="panel" style={{ width: 860, position: 'fixed', right: 0, top: 0, height: '100vh', zIndex: 1000, overflowY: 'auto' }}>

                {/* ── Header ── */}
                <div className="panel-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 32, height: 32, borderRadius: 'var(--r)',
                            background: 'var(--bg-muted)', border: '1px solid var(--border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <Home size={15} style={{ color: 'var(--t-muted)' }} />
                        </div>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{
                                    fontSize: 14, fontWeight: 700,
                                    fontFamily: 'IBM Plex Mono', color: 'var(--t-primary)'
                                }}>
                                    Plot {plot.plot_number}
                                </span>
                                <span className={`badge ${TYPE_BADGE[plot.plot_type] || 'badge-gray'}`}
                                    style={{ fontSize: 10 }}>
                                    {TYPE_LABEL[plot.plot_type] || plot.plot_type}
                                </span>
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--t-faint)' }}>
                                {plot.marla_size}
                                {activeOwner ? ` · ${activeOwner.owner_name}` : ' · Unassigned'}
                            </div>
                        </div>
                    </div>
                    <button className="panel-close" onClick={onClose}><X size={16} /></button>
                </div>

                {/* ── Tabs ── */}
                <div className="tabs" style={{ padding: '0 20px', marginBottom: 0 }}>
                    {TABS.map(t => (
                        <button key={t.key}
                            className={`tab-btn ${tab === t.key ? 'active' : ''}`}
                            onClick={() => { setTab(t.key); if (mode === 'edit') cancelEdit() }}>
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* ── Body ── */}
                <div className="panel-body">
                    {msg && (
                        <div className="msg msg-success" style={{ marginBottom: 14 }}>
                            <span>{msg}</span>
                        </div>
                    )}
                    {tab === 'overview' && mode === 'view' && <PlotInfo plot={plot} owner={activeOwner} />}
                    {tab === 'overview' && mode === 'edit' && <PlotForm form={form} onChange={setForm} />}
                    {tab === 'ownership' && (
                        <OwnershipTab plot={plot} members={members}
                            history={ownerHistory} onRefresh={loadHistory} />
                    )}
                    {tab === 'tenants' && <TenantsTab plot={plot} onMsg={showMsg} />}
                    {tab === 'statement' && (
                        <PlotStatement plotId={plot.id} onPaymentSaved={() => showMsg('Payment recorded')} />
                    )}
                </div>

                {/* ── Footer ── */}
                <div className="panel-footer" style={{ justifyContent: 'space-between' }}>
                    <div>
                        {tab === 'overview' && mode === 'view' && (
                            confirm ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: 12.5, color: 'var(--c-overdue)' }}>Delete permanently?</span>
                                    <button className="btn btn-danger btn-sm"
                                        onClick={async () => { await ipc.invoke('db:delete-plot', plot.id); onDeleted() }}>
                                        Yes, delete
                                    </button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Cancel</button>
                                </div>
                            ) : (
                                <button className="btn btn-ghost btn-sm"
                                    style={{ color: 'var(--c-overdue)', borderColor: 'var(--c-overdue-border)' }}
                                    onClick={() => setConfirm(true)}>
                                    <Trash2 size={13} /> Delete
                                </button>
                            )
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {mode === 'view' ? (
                            <>
                                <button className="btn btn-ghost" onClick={onClose}>Close</button>
                                {tab === 'overview' && (
                                    <button className="btn btn-primary" onClick={() => setMode('edit')}>
                                        <Edit2 size={13} /> Edit Plot
                                    </button>
                                )}
                            </>
                        ) : (
                            <>
                                <button className="btn btn-ghost" onClick={cancelEdit}>Cancel</button>
                                <button className="btn btn-primary" onClick={handleSave}
                                    disabled={saving || !form.plot_number.trim()}>
                                    <Check size={14} />
                                    {saving ? 'Saving...' : 'Save Changes'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

// ══════════════════════════════════════════════════════════════
// ADD PLOT PANEL
// ══════════════════════════════════════════════════════════════
function AddPlotPanel({ onClose, onSaved }: { onClose: () => void, onSaved: () => void }) {
    const [form, setForm] = useState({ ...emptyPlot })
    const [members, setMembers] = useState<any[]>([])
    const [assignOwnerId, setAssignOwnerId] = useState('')
    const [ownerStartDate, setOwnerStartDate] = useState(new Date().toISOString().split('T')[0])
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState('')

    useEffect(() => {
        if (!ipc) return
        ipc.invoke('db:get-members').then((rows: any[]) => setMembers(rows || [])).catch(() => setMembers([]))
    }, [])

    const handleSave = async () => {
        if (!form.plot_number.trim()) { setErr('Plot number is required'); return }
        setSaving(true)
        try {
            await ipc.invoke('db:add-plot', {
                ...form,
                assignOwnerId: assignOwnerId || null,
                ownerStartDate,
            })
            onSaved()
        }
        catch (e: any) { setErr(e.message || 'Failed to save'); setSaving(false) }
    }

    return (
        <div className="panel-overlay" style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.3)' }} onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="panel" style={{ width: 520, position: 'fixed', right: 0, top: 0, height: '100vh', zIndex: 1000, overflowY: 'auto' }}>
                <div className="panel-header">
                    <h2>Add New Plot</h2>
                    <button className="panel-close" onClick={onClose}><X size={16} /></button>
                </div>
                <div className="panel-body">
                    <PlotForm form={form} onChange={setForm} />
                    <div style={{
                        marginTop: 14,
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r-lg)',
                        padding: '12px 14px'
                    }}>
                        <div style={{
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            color: 'var(--t-faint)',
                            fontFamily: 'IBM Plex Mono',
                            marginBottom: 8
                        }}>
                            Assign Current Owner (Optional)
                        </div>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>Owner</label>
                                <select value={assignOwnerId} onChange={e => setAssignOwnerId(e.target.value)}>
                                    <option value="">No owner now</option>
                                    {members.map((m: any) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Start Date</label>
                                <input type="date" value={ownerStartDate} onChange={e => setOwnerStartDate(e.target.value)} disabled={!assignOwnerId} />
                            </div>
                        </div>
                    </div>
                    {err && (
                        <div className="msg msg-error" style={{ marginTop: 14 }}>
                            <span>{err}</span>
                            <button className="msg-close" onClick={() => setErr('')}>✕</button>
                        </div>
                    )}
                </div>
                <div className="panel-footer" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary btn-lg" onClick={handleSave}
                        disabled={saving || !form.plot_number.trim()}>
                        <Check size={15} />
                        {saving ? 'Saving...' : 'Save Plot'}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
export default function PlotsPage() {
    const [plots, setPlots] = useState<any[]>([])
    const [members, setMembers] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [filterType, setFilterType] = useState('')
    const [search, setSearch] = useState('')
    const [selected, setSelected] = useState<any>(null)
    const [showAdd, setShowAdd] = useState(false)
    const [msg, setMsg] = useState('')

    const load = useCallback(async () => {
        if (!ipc) return
        setLoading(true)
        try {
            const [p, m] = await Promise.all([
                ipc.invoke('db:get-plots'),
                ipc.invoke('db:get-members')
            ])
            setPlots(p); setMembers(m)
        } finally { setLoading(false) }
    }, [])

    useEffect(() => { load() }, [load])

    const showSuccess = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500) }

    const q = search.toLowerCase()
    const displayed = plots
        .filter(p => !filterType || p.plot_type === filterType)
        .filter(p => !q ||
            p.plot_number?.toLowerCase().includes(q) ||
            p.owner_name?.toLowerCase().includes(q))

    const counts = {
        total: plots.length,
        commercial: plots.filter(p => p.plot_type === 'commercial').length,
        unassigned: plots.filter(p => !p.owner_name).length,
    }

    const handleExportPlots = async () => {
        const headers = ['Plot#', 'Area (Marla)', 'Type', 'Floors', 'Owner', 'Status']
        const rows: (string | number)[][] = plots.map(p => {
            const plotType = p.plot_type === 'commercial' ? 'Commercial' : p.plot_type === 'residential_constructed' ? 'Constructed' : 'Vacant'
            return [
                p.plot_number || '',
                p.marla_size || '',
                plotType,
                p.commercial_floors > 0 ? p.commercial_floors : '',
                p.owner_name || 'Unassigned',
                'Active',
            ]
        })

        await exportExcelFile({
            fileName: `plots-registry-${new Date().toISOString().split('T')[0]}`,
            sheetName: 'Plots',
            title: 'River View Cooperative Housing Society Ltd.',
            subtitle: 'Plots Registry',
            meta: [`Generated: ${new Date().toLocaleDateString('en-PK')} | Total Plots: ${plots.length} | Commercial: ${counts.commercial} | Unassigned: ${counts.unassigned}`],
            headers,
            rows,
            numericColumns: [1, 2, 4],
        })
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>Plots Registry</h1>
                    <p className="subtitle">
                        {counts.total} plots
                        {counts.commercial > 0 && ` · ${counts.commercial} commercial`}
                        {counts.unassigned > 0 && (
                            <span style={{ color: 'var(--c-partial)' }}>
                                {` · ${counts.unassigned} unassigned`}
                            </span>
                        )}
                    </p>
                </div>
                <div className="header-actions">
                    <select value={filterType} onChange={e => setFilterType(e.target.value)}>
                        <option value="">All Types</option>
                        {PLOT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <button className="btn btn-ghost" onClick={handleExportPlots} title="Export to Excel">
                        <Download size={15} /> Export
                    </button>
                    <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                        <Plus size={15} /> Add Plot
                    </button>
                </div>
            </div>

            {msg && (
                <div className="msg msg-success" style={{ marginBottom: 16 }}>
                    <span>{msg}</span>
                    <button className="msg-close" onClick={() => setMsg('')}>✕</button>
                </div>
            )}

            <div className="table-wrap">
                <div className="table-search">
                    <Search size={14} style={{ color: 'var(--t-faint)' }} />
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search plot number, owner..." />
                    {search && (
                        <button onClick={() => setSearch('')} style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--t-faint)', padding: '0 4px', display: 'flex'
                        }}><X size={13} /></button>
                    )}
                </div>

                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width: 90 }}>Plot #</th>
                            <th style={{ width: 90 }}>Size</th>
                            <th>Type</th>
                            <th>Owner</th>
                            <th style={{ width: 80 }}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={5} style={{
                                textAlign: 'center', padding: 36,
                                color: 'var(--t-faint)', fontSize: 13
                            }}>Loading...</td></tr>
                        ) : displayed.length === 0 ? (
                            <tr><td colSpan={5} style={{
                                textAlign: 'center', padding: 40,
                                color: 'var(--t-faint)', fontSize: 13
                            }}>
                                {search || filterType ? 'No plots match your filters.' : 'No plots registered yet.'}
                            </td></tr>
                        ) : displayed.map(p => (
                            <tr key={p.id} onClick={() => setSelected(p)}>
                                <td>
                                    <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 700, fontSize: 13 }}>
                                        {p.plot_number}
                                    </span>
                                </td>
                                <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-muted)' }}>
                                    {p.marla_size}
                                </td>
                                <td>
                                    <span className={`badge ${TYPE_BADGE[p.plot_type] || 'badge-gray'}`}
                                        style={{ fontSize: 10.5 }}>
                                        {TYPE_LABEL[p.plot_type] || p.plot_type}
                                    </span>
                                    {(p.plot_type === 'commercial' || p.plot_type === 'residential_constructed') && p.commercial_floors > 0 && (
                                        <span style={{
                                            fontSize: 10.5, color: 'var(--t-faint)',
                                            marginLeft: 5, fontFamily: 'IBM Plex Mono'
                                        }}>
                                            {p.commercial_floors}F
                                        </span>
                                    )}
                                </td>
                                <td style={{
                                    color: p.owner_name ? 'var(--t-secondary)' : 'var(--t-faint)',
                                    fontStyle: p.owner_name ? 'normal' : 'italic', fontSize: 12.5
                                }}>
                                    {p.owner_name || 'Unassigned'}
                                </td>
                                <td><span className="badge badge-paid" style={{ fontSize: 10 }}>Active</span></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="table-footer">
                    <span>{displayed.length} plots</span>
                    <span style={{ color: 'var(--t-faint)', fontSize: 11 }}>Click row to view details</span>
                </div>
            </div>

            {showAdd && (
                <AddPlotPanel
                    onClose={() => setShowAdd(false)}
                    onSaved={() => { showSuccess('Plot added'); setShowAdd(false); load() }}
                />
            )}
            {selected && (
                <PlotPanel
                    plot={selected} members={members}
                    onClose={() => setSelected(null)}
                    onSaved={(m) => { showSuccess(m); setSelected(null); load() }}
                    onDeleted={() => { showSuccess('Plot deleted'); setSelected(null); load() }}
                />
            )}
        </div>
    )
}