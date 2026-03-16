import { useState, useEffect, useCallback } from 'react'
import { Printer, Calendar, ArrowUpRight, ArrowDownRight } from 'lucide-react'

const ipc = (window as any).ipcRenderer

export default function LedgerPage() {
    const [entries, setEntries] = useState<any[]>([])
    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
    })
    const [endDate, setEndDate] = useState(() => {
        const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(0); return d.toISOString().split('T')[0]
    })

    const load = useCallback(async () => {
        if (!ipc) return
        const data = await ipc.invoke('db:get-cashbook', { startDate, endDate })
        setEntries(data)
    }, [startDate, endDate])

    useEffect(() => { load() }, [load])

    // Calculate totals
    const totalCashIn = entries.reduce((s, e) => s + (e.cash_in || 0), 0)
    const totalBankIn = entries.reduce((s, e) => s + (e.bank_in || 0), 0)
    const totalCashOut = entries.reduce((s, e) => s + (e.cash_out || 0), 0)
    const totalBankOut = entries.reduce((s, e) => s + (e.bank_out || 0), 0)

    // We'll calculate opening balance historically later (Phase 5). For now, just Net Change.
    const netCash = totalCashIn - totalCashOut
    const netBank = totalBankIn - totalBankOut

    const printCashbook = async () => {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        const doc = new jsPDF('landscape')

        doc.setFontSize(16)
        doc.setFont('helvetica', 'bold')
        doc.text('River View Co-operative Housing Society', 148, 15, { align: 'center' })
        doc.setFontSize(12)
        doc.text(`Cash & Bank Book (${startDate} to ${endDate})`, 148, 22, { align: 'center' })

        const tableData = entries.map((e: any) => [
            e.entry_date,
            e.description,
            e.receipt_number || '-',
            e.cash_in > 0 ? e.cash_in.toLocaleString() : '-',
            e.bank_in > 0 ? e.bank_in.toLocaleString() : '-',
            e.cash_out > 0 ? e.cash_out.toLocaleString() : '-',
            e.bank_out > 0 ? e.bank_out.toLocaleString() : '-',
        ])

        autoTable(doc, {
            startY: 30,
            head: [['Date', 'Description', 'Receipt / Vr #', 'Cash In', 'Bank In', 'Cash Out', 'Bank Out']],
            body: tableData,
            theme: 'grid',
            headStyles: { fillColor: [30, 41, 59] },
            styles: { fontSize: 9 },
            columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } }
        })

        doc.save(`cashbook-${startDate}-${endDate}.pdf`)
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>Cash & Bank Book</h1>
                    <p className="subtitle">Physical money flow over a specific period</p>
                </div>
                <div className="header-actions">
                    <div className="date-range-picker">
                        <Calendar size={16} className="text-muted" />
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                        <span>to</span>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                    </div>
                    <button className="btn btn-ghost" onClick={printCashbook}>
                        <Printer size={16} /> Print Cashbook
                    </button>
                </div>
            </div>

            <div className="billing-summary" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <div className="summary-item">
                    <span className="summary-label"><ArrowDownRight size={14} className="text-green" /> Total Cash In</span>
                    <span className="summary-value text-green">Rs. {totalCashIn.toLocaleString()}</span>
                </div>
                <div className="summary-item">
                    <span className="summary-label"><ArrowDownRight size={14} className="text-green" /> Total Bank In</span>
                    <span className="summary-value text-green">Rs. {totalBankIn.toLocaleString()}</span>
                </div>
                <div className="summary-item">
                    <span className="summary-label"><ArrowUpRight size={14} className="text-red" /> Total Cash Out</span>
                    <span className="summary-value text-red">Rs. {totalCashOut.toLocaleString()}</span>
                </div>
                <div className="summary-item">
                    <span className="summary-label"><ArrowUpRight size={14} className="text-red" /> Total Bank Out</span>
                    <span className="summary-value text-red">Rs. {totalBankOut.toLocaleString()}</span>
                </div>
            </div>

            <div className="net-flow-bar" style={{ display: 'flex', gap: '2rem', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid var(--border)' }}>
                <div>Net Cash Flow: <strong className={netCash >= 0 ? 'text-green' : 'text-red'}>Rs. {netCash.toLocaleString()}</strong></div>
                <div>Net Bank Flow: <strong className={netBank >= 0 ? 'text-green' : 'text-red'}>Rs. {netBank.toLocaleString()}</strong></div>
            </div>

            <table className="data-table grouped-table">
                <thead>
                    <tr>
                        <th rowSpan={2} style={{ verticalAlign: 'middle' }}>Date</th>
                        <th rowSpan={2} style={{ verticalAlign: 'middle', width: '35%' }}>Description</th>
                        <th rowSpan={2} style={{ verticalAlign: 'middle' }}>Receipt / Vr #</th>
                        <th colSpan={2} style={{ textAlign: 'center', background: 'rgba(16, 185, 129, 0.05)' }}>RECEIPTS (IN)</th>
                        <th colSpan={2} style={{ textAlign: 'center', background: 'rgba(239, 68, 68, 0.05)' }}>PAYMENTS (OUT)</th>
                    </tr>
                    <tr>
                        <th style={{ textAlign: 'right', background: 'rgba(16, 185, 129, 0.05)' }}>Cash</th>
                        <th style={{ textAlign: 'right', background: 'rgba(16, 185, 129, 0.05)' }}>Bank</th>
                        <th style={{ textAlign: 'right', background: 'rgba(239, 68, 68, 0.05)' }}>Cash</th>
                        <th style={{ textAlign: 'right', background: 'rgba(239, 68, 68, 0.05)' }}>Bank</th>
                    </tr>
                </thead>
                <tbody>
                    {entries.length === 0 ? (
                        <tr><td colSpan={7} className="empty-row">No cashbook entries found for this period.</td></tr>
                    ) : entries.map((e: any) => (
                        <tr key={e.id}>
                            <td>{e.entry_date}</td>
                            <td>{e.description}</td>
                            <td>{e.receipt_number || '-'}</td>
                            <td style={{ textAlign: 'right' }} className="text-green">{e.cash_in > 0 ? e.cash_in.toLocaleString() : '-'}</td>
                            <td style={{ textAlign: 'right' }} className="text-green">{e.bank_in > 0 ? e.bank_in.toLocaleString() : '-'}</td>
                            <td style={{ textAlign: 'right' }} className="text-red">{e.cash_out > 0 ? e.cash_out.toLocaleString() : '-'}</td>
                            <td style={{ textAlign: 'right' }} className="text-red">{e.bank_out > 0 ? e.bank_out.toLocaleString() : '-'}</td>
                        </tr>
                    ))}
                    {/* Totals Row */}
                    {entries.length > 0 && (
                        <tr style={{ background: 'var(--bg-card)', fontWeight: 'bold' }}>
                            <td colSpan={3} style={{ textAlign: 'right' }}>TOTAL:</td>
                            <td style={{ textAlign: 'right' }} className="text-green">{totalCashIn.toLocaleString()}</td>
                            <td style={{ textAlign: 'right' }} className="text-green">{totalBankIn.toLocaleString()}</td>
                            <td style={{ textAlign: 'right' }} className="text-red">{totalCashOut.toLocaleString()}</td>
                            <td style={{ textAlign: 'right' }} className="text-red">{totalBankOut.toLocaleString()}</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    )
}
