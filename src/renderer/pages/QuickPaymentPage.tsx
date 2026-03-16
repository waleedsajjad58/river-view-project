import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, CheckCircle, Printer, X } from 'lucide-react'

const ipc = (window as any).ipcRenderer

export default function QuickPaymentPage() {
    const [query, setQuery] = useState('')
    const [searchResults, setSearchResults] = useState<any[]>([])
    const [selectedBill, setSelectedBill] = useState<any>(null)
    const [billDetail, setBillDetail] = useState<any>(null)
    const [amount, setAmount] = useState('')
    const [method, setMethod] = useState<'cash' | 'bank' | 'cheque'>('cash')
    const [receiptNo, setReceiptNo] = useState('')
    const [notes, setNotes] = useState('')
    const [message, setMessage] = useState('')
    const [msgType, setMsgType] = useState<'success' | 'error'>('success')
    const [saving, setSaving] = useState(false)
    const [todayPayments, setTodayPayments] = useState<any[]>([])
    const searchRef = useRef<HTMLInputElement>(null)

    const today = new Date().toISOString().split('T')[0]

    const loadTodayPayments = useCallback(async () => {
        if (!ipc) return
        try {
            // Get all bills then filter payments — simplified approach
            const bills = await ipc.invoke('db:get-bills', { status: 'paid' })
            // Show today's most recently paid
            setTodayPayments(bills.slice(0, 10))
        } catch (e) { console.error(e) }
    }, [])

    useEffect(() => {
        loadTodayPayments()
        searchRef.current?.focus()
    }, [loadTodayPayments])

    // Search bills by plot number, owner name
    useEffect(() => {
        if (!query.trim() || query.length < 2) { setSearchResults([]); return }
        const search = async () => {
            if (!ipc) return
            try {
                const bills = await ipc.invoke('db:get-all-bills', {})
                const q = query.toLowerCase()
                const filtered = bills.filter((b: any) =>
                    (b.plot_number?.toLowerCase().includes(q) ||
                        b.owner_name?.toLowerCase().includes(q) ||
                        b.bill_number?.toLowerCase().includes(q)) &&
                    b.status !== 'paid'
                ).slice(0, 8)
                setSearchResults(filtered)
            } catch (e) { console.error(e) }
        }
        const timer = setTimeout(search, 250)
        return () => clearTimeout(timer)
    }, [query])

    const selectBill = async (bill: any) => {
        setSelectedBill(bill)
        setSearchResults([])
        setQuery(`${bill.plot_number} — ${bill.owner_name || 'Unknown'} — Bill #${bill.bill_number}`)
        setAmount(bill.balance_due?.toString() || '')
        try {
            const detail = await ipc.invoke('db:get-bill-detail', bill.id)
            setBillDetail(detail)
        } catch (e) { console.error(e) }
    }

    const clearSelection = () => {
        setSelectedBill(null)
        setBillDetail(null)
        setQuery('')
        setAmount('')
        setSearchResults([])
        searchRef.current?.focus()
    }

    const showMsg = (text: string, type: 'success' | 'error' = 'success') => {
        setMessage(text); setMsgType(type)
        if (type === 'success') setTimeout(() => setMessage(''), 5000)
    }

    const handleRecord = async () => {
        if (!selectedBill) { showMsg('Search and select a bill first', 'error'); return }
        const amt = parseFloat(amount)
        if (!amt || amt <= 0) { showMsg('Enter a valid amount', 'error'); return }
        if (amt > selectedBill.balance_due + 0.01) { showMsg(`Amount exceeds balance due (Rs. ${selectedBill.balance_due.toLocaleString()})`, 'error'); return }

        setSaving(true)
        try {
            await ipc.invoke('db:record-payment', {
                billId: selectedBill.id,
                amount: amt,
                paymentMethod: method,
                receiptNumber: receiptNo || null,
                notes: notes || null
            })
            showMsg(`✓ Payment of Rs. ${amt.toLocaleString()} recorded for Plot ${selectedBill.plot_number}`)
            clearSelection()
            setReceiptNo('')
            setNotes('')
            setMethod('cash')
            loadTodayPayments()
        } catch (e: any) {
            showMsg(`Error: ${e.message}`, 'error')
        } finally {
            setSaving(false)
        }
    }

    const statusColor: Record<string, string> = {
        paid: 'var(--accent)', partial: 'var(--warning)', unpaid: 'var(--danger)', overdue: 'var(--overdue)'
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>Receive Payment</h1>
                    <p className="subtitle">Search a plot or bill, then record payment</p>
                </div>
            </div>

            {message && (
                <div className={`msg ${msgType === 'error' ? 'msg-error' : 'msg-success'}`}>
                    <span>{message}</span>
                    <button className="msg-close" onClick={() => setMessage('')}>✕</button>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.5rem' }}>

                {/* Left — search + payment form */}
                <div>
                    {/* Search box */}
                    <div style={{ position: 'relative', marginBottom: '1.25rem' }}>
                        <div className="payment-search-box">
                            <Search size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            <input
                                ref={searchRef}
                                value={query}
                                onChange={e => { setQuery(e.target.value); if (selectedBill) clearSelection() }}
                                placeholder="Search plot number, owner name or bill number..."
                                style={{ fontSize: '1rem' }}
                            />
                            {selectedBill && (
                                <button onClick={clearSelection} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '2px' }}>
                                    <X size={16} />
                                </button>
                            )}
                        </div>

                        {/* Dropdown results */}
                        {searchResults.length > 0 && !selectedBill && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-lg)',
                                marginTop: '4px'
                            }}>
                                {searchResults.map((bill: any) => (
                                    <div key={bill.id} onClick={() => selectBill(bill)} style={{
                                        padding: '0.75rem 1rem', cursor: 'pointer', display: 'flex',
                                        justifyContent: 'space-between', alignItems: 'center',
                                        borderBottom: '1px solid var(--border)', transition: 'background 0.1s'
                                    }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    >
                                        <div>
                                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                                                Plot {bill.plot_number}
                                                <span style={{ marginLeft: '0.5rem', fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                                    {bill.bill_number}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                {bill.owner_name || 'No owner'} · {bill.billing_month || 'Special'}
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontFamily: 'var(--font-num)', fontWeight: 700, color: 'var(--danger)', fontSize: '0.9rem' }}>
                                                Rs. {(bill.balance_due || 0).toLocaleString()}
                                            </div>
                                            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: statusColor[bill.status] || 'gray', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                {bill.status}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Bill summary (once selected) */}
                    {selectedBill && billDetail && (
                        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-accent)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', marginBottom: '1.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>Plot {selectedBill.plot_number}</div>
                                    <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '2px' }}>{selectedBill.owner_name || '—'} · {selectedBill.bill_number}</div>
                                </div>
                                <span className={`badge badge-${selectedBill.status}`}>{selectedBill.status}</span>
                            </div>

                            {/* Bill items */}
                            <div style={{ marginBottom: '0.75rem' }}>
                                {billDetail.items?.map((item: any) => (
                                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.84rem' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>{item.charge_name}</span>
                                        <span style={{ fontFamily: 'var(--font-num)', color: 'var(--text-primary)' }}>Rs. {(item.amount || 0).toLocaleString()}</span>
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Total Amount</span>
                                <span style={{ fontFamily: 'var(--font-num)', fontWeight: 600 }}>Rs. {(selectedBill.total_amount || 0).toLocaleString()}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Already Paid</span>
                                <span style={{ fontFamily: 'var(--font-num)', color: 'var(--accent)' }}>Rs. {(selectedBill.amount_paid || 0).toLocaleString()}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Balance Due</span>
                                <span style={{ fontFamily: 'var(--font-num)', fontWeight: 700, fontSize: '1.1rem', color: 'var(--danger)' }}>
                                    Rs. {(selectedBill.balance_due || 0).toLocaleString()}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Payment form */}
                    {selectedBill && (
                        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.25rem' }}>
                            <div className="section-heading" style={{ marginBottom: '1rem' }}>Payment Details</div>

                            {/* Amount */}
                            <div className="form-group" style={{ marginBottom: '1rem' }}>
                                <label>Amount Received (Rs.)</label>
                                <input
                                    type="number"
                                    className="input-amount"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                    placeholder="0.00"
                                    min="0"
                                    max={selectedBill.balance_due}
                                    style={{ fontSize: '1.3rem', padding: '0.65rem 0.875rem', fontWeight: 700 }}
                                />
                            </div>

                            {/* Method */}
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.5rem' }}>
                                    Payment Method
                                </label>
                                <div className="method-group">
                                    {(['cash', 'bank', 'cheque'] as const).map(m => (
                                        <button key={m} className={`method-btn ${method === m ? 'selected' : ''}`} onClick={() => setMethod(m)}>
                                            {m === 'cash' ? '💵 Cash' : m === 'bank' ? '🏦 Bank' : '📋 Cheque'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Receipt + notes */}
                            <div className="form-grid" style={{ marginBottom: '1.25rem' }}>
                                <div className="form-group">
                                    <label>Receipt Number</label>
                                    <input type="text" value={receiptNo} onChange={e => setReceiptNo(e.target.value)} placeholder="Optional" />
                                </div>
                                <div className="form-group">
                                    <label>Notes</label>
                                    <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
                                </div>
                            </div>

                            <button
                                className="btn btn-primary btn-lg"
                                style={{ width: '100%', justifyContent: 'center' }}
                                onClick={handleRecord}
                                disabled={saving || !amount}
                            >
                                {saving
                                    ? 'Recording...'
                                    : <><CheckCircle size={18} /> Record Payment — Rs. {parseFloat(amount || '0').toLocaleString()}</>
                                }
                            </button>
                        </div>
                    )}

                    {/* Empty state */}
                    {!selectedBill && (
                        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)' }}>
                            <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.4 }}>💳</div>
                            <p style={{ fontSize: '0.95rem', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Search for a plot or bill to record payment</p>
                            <p style={{ fontSize: '0.82rem' }}>Type plot number, owner name, or bill number above</p>
                        </div>
                    )}
                </div>

                {/* Right — today's payments */}
                <div>
                    <div className="card" style={{ position: 'sticky', top: '1.75rem' }}>
                        <div className="card-header" style={{ marginBottom: '0.75rem' }}>
                            <span className="card-title">Recent Payments</span>
                        </div>
                        {todayPayments.length === 0
                            ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>No payments recorded yet</p>
                            : todayPayments.map((bill: any) => (
                                <div key={bill.id} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '0.6rem 0', borderBottom: '1px solid var(--border)'
                                }}>
                                    <div>
                                        <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>Plot {bill.plot_number}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{bill.owner_name || '—'}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontFamily: 'var(--font-num)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)' }}>
                                            Rs. {(bill.total_amount || 0).toLocaleString()}
                                        </div>
                                        <span className="badge badge-paid" style={{ fontSize: '0.68rem' }}>paid</span>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                </div>

            </div>
        </div>
    )
}