import { useState, useEffect, useCallback } from 'react'
import { Plus, DollarSign } from 'lucide-react'
import Modal from '../components/Modal'

const ipc = (window as any).ipcRenderer
const MAX_REMARKS_LENGTH = 200

export default function SpecialBillsPage() {
    const [charges, setCharges] = useState<any[]>([])
    const [plots, setPlots] = useState<any[]>([])
    const [bills, setBills] = useState<any[]>([])
    const [selectedItems, setSelectedItems] = useState<Array<{ chargeName: string; amount: number }>>([])
    const [showForm, setShowForm] = useState(false)
    const [message, setMessage] = useState('')
    const [form, setForm] = useState({
        plotId: '', chargeId: '', amount: 0, notes: '', customName: '', transferAmount: 0, dueDate: ''
    })

    const load = useCallback(async () => {
        if (!ipc) return
        const [c, p, b] = await Promise.all([
            ipc.invoke('db:get-onetime-charges'),
            ipc.invoke('db:get-plots'),
            ipc.invoke('db:get-bills', { billType: 'special' }),
        ])
        setCharges(c)
        setPlots(p)
        setBills(b)
    }, [])

    useEffect(() => { load() }, [load])

    const selectedCharge = charges.find((c: any) => c.id === parseInt(form.chargeId))

    // Helper to calculate the base amount based on plot size
    const calculateBaseAmount = (charge: any, plotIdStr: string) => {
        if (!charge) return 0
        let amt = charge.base_amount || 0

        if (charge.varies_by_marla && plotIdStr) {
            const plot = plots.find((p: any) => p.id === parseInt(plotIdStr))
            if (plot && plot.marla_size && plot.marla_size.toString().includes('10')) {
                amt = amt / 2 // Apply the half for 10 Marla rule
            }
        }
        return amt
    }

    const computeAmount = () => {
        if (!selectedCharge) return 0
        if (selectedCharge.is_percentage && form.transferAmount > 0) {
            return Math.round(form.transferAmount * (selectedCharge.percentage_value / 100))
        }
        return calculateBaseAmount(selectedCharge, form.plotId)
    }

    const addChargeToBill = () => {
        if (!form.chargeId) return
        const chargeName = form.chargeId === 'custom'
            ? form.customName.trim()
            : (selectedCharge?.charge_name || '')
        const amount = form.amount || computeAmount()
        if (!chargeName || amount <= 0) return

        setSelectedItems((prev) => [...prev, { chargeName, amount }])
        setForm((prev) => ({ ...prev, chargeId: '', amount: 0, customName: '', transferAmount: 0 }))
    }

    const removeItem = (index: number) => {
        setSelectedItems((prev) => prev.filter((_, i) => i !== index))
    }

    const createBill = async () => {
        if (!form.plotId || selectedItems.length === 0) return
        const totalAmount = selectedItems.reduce((sum, item) => sum + item.amount, 0)

        try {
            await ipc.invoke('db:create-special-bill', {
                plotId: parseInt(form.plotId),
                items: selectedItems,
                notes: form.notes,
                dueDate: form.dueDate || undefined
            })
            setMessage(`Special bill created with ${selectedItems.length} charge(s) — Rs. ${totalAmount.toLocaleString()}`)
            setShowForm(false)
            setForm({ plotId: '', chargeId: '', amount: 0, notes: '', customName: '', transferAmount: 0, dueDate: '' })
            setSelectedItems([])
            load()
        } catch (e: any) {
            setMessage(`Error: ${e.message}`)
        }
        setTimeout(() => setMessage(''), 4000)
    }

    const statusBadge = (status: string) => {
        const map: Record<string, string> = { unpaid: 'badge-red', partial: 'badge-yellow', paid: 'badge-green', overdue: 'badge-red' }
        return <span className={`badge ${map[status] || ''}`}>{status.toUpperCase()}</span>
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>Special Bills</h1>
                    <p className="subtitle">One-time charges: transfers, connections, NOC, membership</p>
                </div>
                <div className="header-actions">
                    <button className="btn btn-primary" onClick={() => setShowForm(true)}>
                        <Plus size={16} /> Generate Special Bill
                    </button>
                </div>
            </div>

            {message && <div className="toast-message">{message}</div>}

            <table className="data-table">
                <thead>
                    <tr>
                        <th>Bill #</th><th>Plot</th><th>Charge</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th><th>Date</th>
                    </tr>
                </thead>
                <tbody>
                    {bills.length === 0 ? (
                        <tr><td colSpan={8} className="empty-row">No special bills found.</td></tr>
                    ) : bills.map((b: any) => (
                        <tr key={b.id}>
                            <td>{b.bill_number}</td>
                            <td>{b.plot_number}</td>
                            <td>{b.charge_name || 'Special'}</td>
                            <td>Rs. {(b.total_amount || 0).toLocaleString()}</td>
                            <td>Rs. {(b.amount_paid || 0).toLocaleString()}</td>
                            <td>Rs. {(b.balance_due || 0).toLocaleString()}</td>
                            <td>{statusBadge(b.status)}</td>
                            <td>{b.bill_date}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Generate Special Bill Modal */}
            <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Generate Special Bill" width="520px">
                <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                    <div className="form-group">
                        <label>Select Plot *</label>
                        <select value={form.plotId} onChange={e => {
                            const newPlotId = e.target.value
                            setForm({ ...form, plotId: newPlotId, amount: calculateBaseAmount(selectedCharge, newPlotId) })
                        }}>
                            <option value="">-- Select Plot --</option>
                            {plots.map((p: any) => <option key={p.id} value={p.id}>{p.plot_number} {p.block ? `(Block ${p.block})` : ''}</option>)}
                        </select>
                    </div>

                    <div className="form-group">
                        <label>Charge Type *</label>
                        <select value={form.chargeId} onChange={e => {
                            const ch = charges.find((c: any) => c.id === parseInt(e.target.value))
                            setForm({ ...form, chargeId: e.target.value, amount: calculateBaseAmount(ch, form.plotId), customName: '' })
                        }}>
                            <option value="">-- Select Charge --</option>
                            {charges.map((c: any) => (
                                <option key={c.id} value={c.id}>
                                    {c.charge_name} {c.is_percentage ? `(${c.percentage_value}%)` : c.base_amount ? `(Rs. ${c.base_amount.toLocaleString()})` : ''}
                                </option>
                            ))}
                            <option value="custom">Custom Charge</option>
                        </select>
                    </div>

                    {form.chargeId === 'custom' && (
                        <div className="form-group">
                            <label>Custom Charge Name</label>
                            <input type="text" value={form.customName} onChange={e => setForm({ ...form, customName: e.target.value })} placeholder="e.g. Building Plan Fee" />
                        </div>
                    )}

                    {selectedCharge?.is_percentage ? (
                        <>
                            <div className="form-group">
                                <label>Transfer/Deed Amount (for {selectedCharge.percentage_value}% calculation)</label>
                                <input type="number" min="0" value={form.transferAmount} onChange={e => {
                                    const ta = parseFloat(e.target.value) || 0
                                    setForm({ ...form, transferAmount: ta, amount: Math.round(ta * (selectedCharge.percentage_value / 100)) })
                                }} />
                            </div>
                            <div className="calculated-amount">
                                Calculated: <strong>Rs. {(form.amount || computeAmount()).toLocaleString()}</strong>
                            </div>
                        </>
                    ) : (
                        <div className="form-group">
                            <label>Amount (Rs.)</label>
                            <input type="number" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
                        </div>
                    )}

                    <div className="form-group">
                        <button className="btn btn-secondary" type="button" onClick={addChargeToBill} disabled={!form.chargeId || (!selectedCharge && !form.customName.trim()) || form.amount <= 0}>
                            Add Charge To Bill
                        </button>
                    </div>

                    <div className="form-group">
                        <label>Selected Charges</label>
                        {selectedItems.length === 0 ? (
                            <div className="empty-row" style={{ padding: '8px 0' }}>No charges added yet.</div>
                        ) : (
                            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                                {selectedItems.map((item, idx) => (
                                    <div key={`${item.chargeName}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderBottom: idx === selectedItems.length - 1 ? 'none' : '1px solid #f1f5f9' }}>
                                        <span>{item.chargeName} - Rs. {item.amount.toLocaleString()}</span>
                                        <button className="btn btn-ghost" type="button" onClick={() => removeItem(idx)}>Remove</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="form-group">
                        <label>Due Date (Optional)</label>
                        <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
                    </div>

                    <div className="form-group">
                        <label>Notes <span style={{ color: 'var(--t-faint)', fontWeight: 400 }}>(optional, max 200)</span></label>
                        <textarea
                            value={form.notes}
                            onChange={e => setForm({ ...form, notes: e.target.value.slice(0, MAX_REMARKS_LENGTH) })}
                            rows={2}
                            maxLength={MAX_REMARKS_LENGTH}
                            style={{ resize: 'vertical', overflowWrap: 'anywhere', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
                        />
                        <div style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--t-faint)', textAlign: 'right' }}>
                            {(form.notes || '').length}/{MAX_REMARKS_LENGTH}
                        </div>
                    </div>
                </div>
                <div className="modal-actions">
                    <button className="btn btn-ghost" onClick={() => {
                        setShowForm(false)
                        setSelectedItems([])
                    }}>Cancel</button>
                    <button className="btn btn-primary" onClick={createBill} disabled={!form.plotId || selectedItems.length === 0}>
                        <DollarSign size={16} /> Generate Bill
                    </button>
                </div>
            </Modal>
        </div>
    )
}
