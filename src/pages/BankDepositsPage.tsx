import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Search, Landmark, Trash2, Printer } from 'lucide-react'

const ipc = (window as any).ipcRenderer
const fmt = (n: any) => (Number(n) || 0).toLocaleString()

function printDepositSlip(d: any) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Bank Deposit Slip</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0ece4; padding: 16px; font-size: 12px; color: #111; }
        .slip { width: 520px; margin: 0 auto; border: 1.5px solid #999; background: #fff; }
        .header { background: #d0dff0; border-bottom: 1.5px solid #999; padding: 8px 14px; display: flex; align-items: center; gap: 10px; }
        .society { flex: 1; text-align: center; font-size: 16px; font-weight: 700; color: #1a2e5a; }
        .sub-header { text-align: center; font-size: 10px; color: #555; padding: 4px; border-bottom: 1px solid #ccc; background: #f7f5f0; }
        .body { padding: 14px 18px; }
        .title { font-size: 14px; font-weight: 700; text-align: center; text-decoration: underline; margin-bottom: 14px; letter-spacing: 0.5px; }
        .row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px dashed #ddd; gap: 10px; }
        .row:last-child { border-bottom: none; }
        .label { font-weight: 600; color: #444; white-space: nowrap; min-width: 130px; }
        .value { text-align: right; font-family: 'Courier New', monospace; }
        .amount-box { margin: 14px 0; border: 2px solid #1a4a7a; padding: 10px 14px; background: #eaf0fb; display: flex; justify-content: space-between; align-items: center; }
        .amount-label { font-weight: 700; font-size: 13px; color: #1a2e5a; }
        .amount-value { font-size: 20px; font-weight: 700; font-family: 'Courier New', monospace; color: #1a4a7a; }
        .footer { border-top: 1.5px solid #999; padding: 6px 14px; font-size: 9.5px; color: #555; text-align: center; background: #f7f5f0; }
        .sig-row { display: flex; justify-content: space-between; margin-top: 24px; padding: 0 10px; }
        .sig { text-align: center; width: 140px; }
        .sig-line { border-top: 1px solid #555; padding-top: 4px; font-size: 10px; color: #666; }
        @media print { body { background: #fff; padding: 0; } }
    </style>
    </head><body>
    <div class="slip">
        <div class="header">
            <div class="society">River View Cooperative Housing Society Ltd.</div>
        </div>
        <div class="sub-header">Bank Deposit Slip</div>
        <div class="body">
            <div class="title">BANK DEPOSIT VOUCHER</div>
            <div class="row"><span class="label">Date:</span><span class="value">${d.deposit_date || '—'}</span></div>
            <div class="row"><span class="label">Bank Name:</span><span class="value">${d.bank_name || '—'}</span></div>
            <div class="row"><span class="label">Account Number:</span><span class="value">${d.account_number || '—'}</span></div>
            <div class="row"><span class="label">Deposit Slip / Ref #:</span><span class="value">${d.reference_number || '—'}</span></div>
            <div class="row"><span class="label">Deposited By:</span><span class="value">${d.deposited_by || '—'}</span></div>
            <div class="row"><span class="label">Description:</span><span class="value">${d.description || '—'}</span></div>
            <div class="amount-box">
                <span class="amount-label">Amount Deposited:</span>
                <span class="amount-value">Rs. ${(Number(d.amount) || 0).toLocaleString()}</span>
            </div>
            <div class="sig-row">
                <div class="sig"><div class="sig-line">Depositor Signature</div></div>
                <div class="sig"><div class="sig-line">Cashier / Treasurer</div></div>
                <div class="sig"><div class="sig-line">Authorised By</div></div>
            </div>
        </div>
        <div class="footer">
            Direct / Online Bill Payment, A/C # 2029-0015385-0201, Bank Islami, Thokar Niazbaig Branch, Lahore.<br>
            WhatsApp: 03234148632, 03444000003 · Ph. # 042-32294375
        </div>
    </div>
    <script>window.onload = () => { window.print(); }<\/script>
    </body></html>`
    if (ipc) ipc.invoke('db:print-html-report', html)
}

const BANKS = [
    'Allied Bank Ltd',
    'Habib Bank Ltd (HBL)',
    'United Bank Ltd (UBL)',
    'National Bank of Pakistan',
    'MCB Bank',
    'Meezan Bank',
    'Bank Alfalah',
    'Faysal Bank',
    'Other',
]

function ModalOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.35)' }}
            onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
            {children}
        </div>
    )
}

function PanelShell({ children }: { children: React.ReactNode }) {
    return (
        <div onMouseDown={e => e.stopPropagation()}
            style={{
                position: 'fixed', right: 0, top: 0, width: 460, height: '100vh',
                zIndex: 1000, overflowY: 'auto', background: 'var(--bg-card)',
                boxShadow: '-4px 0 24px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column'
            }}>
            {children}
        </div>
    )
}

function AddDepositPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const today = new Date().toISOString().split('T')[0]
    const [form, setForm] = useState({
        depositDate: today, bankName: 'Allied Bank Ltd', accountNumber: '',
        amount: '', description: '', referenceNumber: '', depositedBy: ''
    })
    const [saving,  setSaving]  = useState(false)
    const [error,   setError]   = useState('')

    const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

    const handleSave = async () => {
        if (!form.amount || parseFloat(form.amount) <= 0) { setError('Enter a valid amount'); return }
        setSaving(true); setError('')
        try {
            await ipc.invoke('db:add-bank-deposit', {
                depositDate:     form.depositDate,
                bankName:        form.bankName,
                accountNumber:   form.accountNumber  || undefined,
                amount:          parseFloat(form.amount),
                description:     form.description    || undefined,
                referenceNumber: form.referenceNumber|| undefined,
                depositedBy:     form.depositedBy    || undefined,
            })
            onSaved()
        } catch (e: any) { setError(e.message) }
        finally { setSaving(false) }
    }

    return (
        <PanelShell>
            <div className="panel-header">
                <h3 style={{ margin: 0 }}>Record Bank Deposit</h3>
                <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
            </div>
            <div className="panel-body" style={{ flex: 1 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div className="form-group">
                        <label>Deposit Date</label>
                        <input type="date" value={form.depositDate} onChange={e => set('depositDate', e.target.value)} />
                    </div>
                    <div className="form-group">
                        <label>Amount (Rs.)</label>
                        <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)}
                            placeholder="0" min="0" style={{ fontFamily: 'IBM Plex Mono', fontWeight: 600 }} autoFocus />
                    </div>
                </div>
                <div className="form-group">
                    <label>Bank</label>
                    <select value={form.bankName} onChange={e => set('bankName', e.target.value)}>
                        {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label>Account Number <small style={{ color: 'var(--t-faint)' }}>(optional)</small></label>
                    <input type="text" value={form.accountNumber} onChange={e => set('accountNumber', e.target.value)}
                        placeholder="e.g. 0010-0000123456" style={{ fontFamily: 'IBM Plex Mono' }} />
                </div>
                <div className="form-group">
                    <label>Description <small style={{ color: 'var(--t-faint)' }}>(optional)</small></label>
                    <input type="text" value={form.description} onChange={e => set('description', e.target.value)}
                        placeholder="e.g. March maintenance collections" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div className="form-group">
                        <label>Deposit Slip / Ref # <small style={{ color: 'var(--t-faint)' }}>(optional)</small></label>
                        <input type="text" value={form.referenceNumber} onChange={e => set('referenceNumber', e.target.value)}
                            placeholder="Slip number" style={{ fontFamily: 'IBM Plex Mono' }} />
                    </div>
                    <div className="form-group">
                        <label>Deposited By <small style={{ color: 'var(--t-faint)' }}>(optional)</small></label>
                        <input type="text" value={form.depositedBy} onChange={e => set('depositedBy', e.target.value)}
                            placeholder="Name" />
                    </div>
                </div>
                {error && <div className="msg msg-error" style={{ marginBottom: '1rem' }}>{error}</div>}
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>
                        {saving ? <><RefreshCw size={15} className="spin" /> Saving…</> : <><Landmark size={15} /> Record Deposit</>}
                    </button>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </PanelShell>
    )
}

export default function BankDepositsPage() {
    const now = new Date()
    const [startDate, setStartDate] = useState(
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    )
    const [endDate,    setEndDate]    = useState(now.toISOString().split('T')[0])
    const [deposits,   setDeposits]   = useState<any[]>([])
    const [search,     setSearch]     = useState('')
    const [showAdd,    setShowAdd]    = useState(false)
    const [loading,    setLoading]    = useState(false)
    const [deleting,   setDeleting]   = useState<number | null>(null)

    const load = useCallback(async () => {
        if (!ipc) return
        setLoading(true)
        try {
            const data = await ipc.invoke('db:get-bank-deposits', { startDate, endDate })
            setDeposits(data || [])
        } catch (e) { console.error(e) }
        finally { setLoading(false) }
    }, [startDate, endDate])

    useEffect(() => { load() }, [load])

    const handleDelete = async (id: number) => {
        if (!confirm('Delete this deposit record?')) return
        setDeleting(id)
        try {
            await ipc.invoke('db:delete-bank-deposit', { id })
            load()
        } catch (e: any) { alert(e.message) }
        finally { setDeleting(null) }
    }

    const q = search.toLowerCase()
    const filtered = q
        ? deposits.filter(d =>
            d.description?.toLowerCase().includes(q) ||
            d.bank_name?.toLowerCase().includes(q) ||
            d.reference_number?.toLowerCase().includes(q) ||
            d.deposited_by?.toLowerCase().includes(q)
          )
        : deposits

    const totalAmount = filtered.reduce((s, d) => s + (d.amount || 0), 0)

    // Group by bank for summary
    const byBank: Record<string, number> = {}
    for (const d of filtered) {
        byBank[d.bank_name] = (byBank[d.bank_name] || 0) + d.amount
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>Bank Deposits</h1>
                    <p className="subtitle">Track cash deposited into society bank accounts</p>
                </div>
                <div className="header-actions">
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    <input type="date" value={endDate}   onChange={e => setEndDate(e.target.value)} />
                    <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                        <Plus size={15} /> Record Deposit
                    </button>
                    {filtered.length > 0 && (
                        <button className="btn btn-ghost" onClick={() => filtered.forEach(d => printDepositSlip(d))}>
                            <Printer size={15} /> Print All
                        </button>
                    )}
                </div>
            </div>

            {/* KPI strip */}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${1 + Object.keys(byBank).length}, 1fr)`, gap: 1, background: 'var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
                <div style={{ background: '#fff', padding: '14px 20px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'IBM Plex Mono', marginBottom: 6 }}>
                        TOTAL DEPOSITED
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'IBM Plex Mono', color: 'var(--t-primary)' }}>
                        Rs. {fmt(totalAmount)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t-faint)', marginTop: 3 }}>{filtered.length} deposit{filtered.length !== 1 ? 's' : ''}</div>
                </div>
                {Object.entries(byBank).map(([bank, amt]) => (
                    <div key={bank} style={{ background: '#fff', padding: '14px 20px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'IBM Plex Mono', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {bank.replace(' Ltd', '').replace(' Bank', '')}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'IBM Plex Mono', color: 'var(--accent)' }}>
                            Rs. {fmt(amt)}
                        </div>
                    </div>
                ))}
            </div>

            {/* Table */}
            <div className="table-wrap">
                <div className="table-search">
                    <Search size={14} style={{ color: 'var(--t-faint)' }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search deposits…" />
                </div>

                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width: 110 }}>Date</th>
                            <th>Bank</th>
                            <th>Account #</th>
                            <th>Description</th>
                            <th>Ref / Slip #</th>
                            <th>Deposited By</th>
                            <th style={{ textAlign: 'right', width: 130 }}>Amount (Rs.)</th>
                            <th style={{ width: 40 }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--t-faint)', fontSize: 13 }}>Loading…</td></tr>
                        ) : filtered.length === 0 ? (
                            <tr><td colSpan={8} style={{ textAlign: 'center', padding: 36, color: 'var(--t-faint)', fontSize: 13 }}>
                                No deposits recorded in this period
                            </td></tr>
                        ) : filtered.map((d: any) => (
                            <tr key={d.id}>
                                <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12 }}>{d.deposit_date}</td>
                                <td style={{ fontSize: 13 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Landmark size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                                        {d.bank_name}
                                    </div>
                                </td>
                                <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--t-faint)' }}>
                                    {d.account_number || '—'}
                                </td>
                                <td style={{ fontSize: 12.5, color: 'var(--t-secondary)' }}>{d.description || '—'}</td>
                                <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--t-faint)' }}>
                                    {d.reference_number || '—'}
                                </td>
                                <td style={{ fontSize: 12.5 }}>{d.deposited_by || '—'}</td>
                                <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                                    {fmt(d.amount)}
                                </td>
                                <td>
                                    <div style={{ display: 'flex', gap: 4 }}>
                                        <button className="btn btn-ghost btn-sm" title="Print Slip"
                                            onClick={() => printDepositSlip(d)}
                                            style={{ color: 'var(--accent)', opacity: 0.8 }}>
                                            <Printer size={13} />
                                        </button>
                                        <button className="btn btn-ghost btn-sm" title="Delete"
                                            disabled={deleting === d.id}
                                            onClick={() => handleDelete(d.id)}
                                            style={{ color: 'var(--c-overdue)', opacity: 0.7 }}>
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {filtered.length > 0 && (
                        <tfoot>
                            <tr style={{ borderTop: '2px solid var(--border-strong)', background: 'var(--bg-subtle)' }}>
                                <td colSpan={6} style={{ padding: '10px 16px', fontSize: 11, fontFamily: 'IBM Plex Mono', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--t-muted)' }}>
                                    Period Total — {filtered.length} deposits
                                </td>
                                <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 700, fontSize: 14, color: 'var(--accent)', padding: '10px 16px' }}>
                                    Rs. {fmt(totalAmount)}
                                </td>
                                <td />
                            </tr>
                        </tfoot>
                    )}
                </table>

                <div className="table-footer">
                    <span>{filtered.length} entries</span>
                    <span style={{ fontFamily: 'IBM Plex Mono' }}>{startDate} — {endDate}</span>
                </div>
            </div>

            {showAdd && (
                <ModalOverlay onClose={() => setShowAdd(false)}>
                    <AddDepositPanel
                        onClose={() => setShowAdd(false)}
                        onSaved={() => { setShowAdd(false); load() }}
                    />
                </ModalOverlay>
            )}
        </div>
    )
}