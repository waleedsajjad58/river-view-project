import { useState, useEffect, useCallback } from 'react'
import { Search, Printer, FileDown } from 'lucide-react'
import { exportExcelFile } from '../utils/exportExcel'

const ipc = (window as any).ipcRenderer

function fmt(n: number) { return (n || 0).toLocaleString() }

function printCashBook(entries: any[], startDate: string, endDate: string) {
    const withBalance = computeRunning(entries)

    const totalCashIn = entries.reduce((s, e) => s + (e.cash_in || 0), 0)
    const totalCashOut = entries.reduce((s, e) => s + (e.cash_out || 0), 0)
    const totalBankIn = entries.reduce((s, e) => s + (e.bank_in || 0), 0)
    const totalBankOut = entries.reduce((s, e) => s + (e.bank_out || 0), 0)
    const closingCash = totalCashIn - totalCashOut
    const closingBank = totalBankIn - totalBankOut

    const rows = withBalance.map((e: any) => `
        <tr>
            <td>${e.entry_date || ''}</td>
            <td>${e.description || ''}${e.receipt_number ? ` <span class="muted">#${e.receipt_number}</span>` : ''}</td>
            <td class="num in">${e.cash_in > 0 ? fmt(e.cash_in) : '—'}</td>
            <td class="num out">${e.cash_out > 0 ? fmt(e.cash_out) : '—'}</td>
            <td class="num in">${e.bank_in > 0 ? fmt(e.bank_in) : '—'}</td>
            <td class="num out">${e.bank_out > 0 ? fmt(e.bank_out) : '—'}</td>
            <td class="num">${fmt(e.cash_balance)}</td>
            <td class="num">${fmt(e.bank_balance)}</td>
        </tr>
    `).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cash Book</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #111; padding: 16px; }
        h2 { font-size: 15px; text-align: center; margin-bottom: 2px; color: #1a2e5a; }
        .sub { text-align: center; font-size: 10px; color: #555; margin-bottom: 10px; }
        .meta { display: flex; justify-content: space-between; font-size: 10px; color: #666; margin-bottom: 10px; padding: 4px 0; border-bottom: 1px solid #ddd; }
        table { width: 100%; border-collapse: collapse; }
        thead th {
            background: #1a4a7a; color: #fff; padding: 5px 7px;
            font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
            border: 1px solid #0e3060;
        }
        tbody td { border-bottom: 1px dotted #d8e0ec; padding: 4px 7px; font-size: 10.5px; }
        td.num { text-align: right; font-family: 'Courier New', monospace; }
        td.in { color: #15803d; }
        td.out { color: #b91c1c; }
        .muted { color: #777; font-size: 10px; font-family: 'Courier New', monospace; }
        tfoot td { background: #1a4a7a; color: #fff; font-weight: 700; padding: 6px 7px; border-top: 2px solid #0e3060; }
        .numf { text-align: right; font-family: 'Courier New', monospace; }
        @media print { body { padding: 0; } }
    </style>
    </head><body>
    <h2>River View Cooperative Housing Society Ltd.</h2>
    <div class="sub">Cash Book — ${startDate} to ${endDate}</div>
    <div class="meta"><span>${entries.length} entries</span><span>Printed: ${new Date().toLocaleDateString('en-PK')}</span></div>
    <table>
      <thead><tr>
        <th style="width:92px">Date</th>
        <th>Description</th>
        <th style="width:84px">Cash In</th>
        <th style="width:84px">Cash Out</th>
        <th style="width:84px">Bank In</th>
        <th style="width:84px">Bank Out</th>
        <th style="width:90px">Cash Bal.</th>
        <th style="width:90px">Bank Bal.</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="2" style="letter-spacing:0.05em;font-size:10px;">TOTALS / CLOSING</td>
        <td class="numf">${fmt(totalCashIn)}</td>
        <td class="numf">${fmt(totalCashOut)}</td>
        <td class="numf">${fmt(totalBankIn)}</td>
        <td class="numf">${fmt(totalBankOut)}</td>
        <td class="numf">${fmt(closingCash)}</td>
        <td class="numf">${fmt(closingBank)}</td>
      </tr></tfoot>
    </table>
    <script>window.onload = () => { window.print(); }<\/script>
    </body></html>`

    if (ipc) ipc.invoke('db:print-html-report', html)
}

async function exportCashBookExcel(entries: any[], startDate: string, endDate: string) {
    const withBalance = computeRunning(entries)

    const totalCashIn = entries.reduce((s, e) => s + (e.cash_in || 0), 0)
    const totalCashOut = entries.reduce((s, e) => s + (e.cash_out || 0), 0)
    const totalBankIn = entries.reduce((s, e) => s + (e.bank_in || 0), 0)
    const totalBankOut = entries.reduce((s, e) => s + (e.bank_out || 0), 0)
    const closingCash = totalCashIn - totalCashOut
    const closingBank = totalBankIn - totalBankOut

    const rows: (string | number)[][] = withBalance.map((e: any) => ([
        e.entry_date || '',
        `${e.description || ''}${e.receipt_number ? ` #${e.receipt_number}` : ''}`,
        e.cash_in || 0,
        e.cash_out || 0,
        e.bank_in || 0,
        e.bank_out || 0,
        e.cash_balance || 0,
        e.bank_balance || 0,
    ]))

    rows.push([])
    rows.push([
        '',
        'TOTALS / CLOSING',
        totalCashIn,
        totalCashOut,
        totalBankIn,
        totalBankOut,
        closingCash,
        closingBank,
    ])

    await exportExcelFile({
        fileName: `cash-book-${startDate}-to-${endDate}`,
        sheetName: 'Cash Book',
        title: 'River View Cooperative Housing Society Ltd.',
        subtitle: `Cash Book - ${startDate} to ${endDate}`,
        meta: [`Generated: ${new Date().toLocaleDateString('en-PK')} | Entries: ${entries.length}`],
        headers: ['Date', 'Description', 'Cash In', 'Cash Out', 'Bank In', 'Bank Out', 'Cash Balance', 'Bank Balance'],
        rows,
        numericColumns: [3, 4, 5, 6, 7, 8],
    })
}

// Running cash and bank totals from a list of entries
function computeRunning(entries: any[]) {
    let cashBal = 0, bankBal = 0
    return entries.map(e => {
        cashBal += (e.cash_in || 0) - (e.cash_out || 0)
        bankBal += (e.bank_in || 0) - (e.bank_out || 0)
        return { ...e, cash_balance: cashBal, bank_balance: bankBal }
    })
}

// Group entries by date for the day-separator layout
function groupByDate(entries: any[]) {
    const groups: Record<string, any[]> = {}
    for (const e of entries) {
        const d = e.entry_date || 'Unknown'
        if (!groups[d]) groups[d] = []
        groups[d].push(e)
    }
    return groups
}

export default function CashBookPage() {
    const now = new Date()
    const [startDate, setStartDate] = useState(
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    )
    const [endDate, setEndDate] = useState(
        now.toISOString().split('T')[0]
    )
    const [entries, setEntries] = useState<any[]>([])
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(false)

    const load = useCallback(async () => {
        if (!ipc) return
        setLoading(true)
        try {
            const raw = await ipc.invoke('db:get-cashbook', { startDate, endDate })
            setEntries(raw)
        } catch (e) { console.error(e) }
        finally { setLoading(false) }
    }, [startDate, endDate])

    useEffect(() => { load() }, [load])

    // Filter by search
    const q = search.toLowerCase()
    const filtered = q
        ? entries.filter(e => e.description?.toLowerCase().includes(q))
        : entries

    // Add running balance
    const withBalance = computeRunning(filtered)

    // Period totals
    const totalCashIn = filtered.reduce((s, e) => s + (e.cash_in || 0), 0)
    const totalCashOut = filtered.reduce((s, e) => s + (e.cash_out || 0), 0)
    const totalBankIn = filtered.reduce((s, e) => s + (e.bank_in || 0), 0)
    const totalBankOut = filtered.reduce((s, e) => s + (e.bank_out || 0), 0)
    const closingCash = totalCashIn - totalCashOut
    const closingBank = totalBankIn - totalBankOut

    const groups = groupByDate(withBalance)

    return (
        <div className="page">

            {/* ── Header ── */}
            <div className="page-header">
                <div>
                    <h1>Cash Book</h1>
                    <p className="subtitle">Daily record of all cash and bank movements</p>
                </div>
                <div className="header-actions">
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                    {filtered.length > 0 && (
                        <>
                        <button className="btn btn-ghost" onClick={() => exportCashBookExcel(filtered, startDate, endDate)}>
                            <FileDown size={15} /> Export Excel
                        </button>
                        <button className="btn btn-ghost" onClick={() => printCashBook(filtered, startDate, endDate)}>
                            <Printer size={15} /> Print
                        </button>
                        </>
                    )}
                </div>
            </div>

            {/* ── Closing balances — the two numbers the clerk cares about ── */}
            <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20
            }}>
                {/* Cash balance */}
                <div className="card" style={{
                    padding: '20px 24px',
                    borderLeft: `3px solid ${closingCash >= 0 ? 'var(--c-paid)' : 'var(--c-overdue)'}`
                }}>
                    <div style={{
                        fontSize: 11, fontFamily: 'IBM Plex Mono', fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--t-faint)', marginBottom: 8
                    }}>
                        Cash in Hand
                    </div>
                    <div style={{
                        fontSize: 28, fontFamily: 'IBM Plex Mono', fontWeight: 600,
                        letterSpacing: '-0.03em', color: closingCash >= 0 ? 'var(--t-primary)' : 'var(--c-overdue)',
                        marginBottom: 6
                    }}>
                        Rs. {fmt(closingCash)}
                    </div>
                    <div style={{ display: 'flex', gap: 20, fontSize: 12, color: 'var(--t-faint)', fontFamily: 'IBM Plex Mono' }}>
                        <span style={{ color: 'var(--c-paid)' }}>In Rs. {fmt(totalCashIn)}</span>
                        <span style={{ color: 'var(--c-overdue)' }}>Out Rs. {fmt(totalCashOut)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t-faint)', marginTop: 6, fontStyle: 'italic' }}>
                        Count physical cash — should match this number
                    </div>
                </div>

                {/* Bank balance */}
                <div className="card" style={{
                    padding: '20px 24px',
                    borderLeft: `3px solid ${closingBank >= 0 ? 'var(--accent)' : 'var(--c-overdue)'}`
                }}>
                    <div style={{
                        fontSize: 11, fontFamily: 'IBM Plex Mono', fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--t-faint)', marginBottom: 8
                    }}>
                        Bank Balance
                    </div>
                    <div style={{
                        fontSize: 28, fontFamily: 'IBM Plex Mono', fontWeight: 600,
                        letterSpacing: '-0.03em', color: closingBank >= 0 ? 'var(--t-primary)' : 'var(--c-overdue)',
                        marginBottom: 6
                    }}>
                        Rs. {fmt(closingBank)}
                    </div>
                    <div style={{ display: 'flex', gap: 20, fontSize: 12, color: 'var(--t-faint)', fontFamily: 'IBM Plex Mono' }}>
                        <span style={{ color: 'var(--c-paid)' }}>In Rs. {fmt(totalBankIn)}</span>
                        <span style={{ color: 'var(--c-overdue)' }}>Out Rs. {fmt(totalBankOut)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t-faint)', marginTop: 6, fontStyle: 'italic' }}>
                        Compare against bank statement
                    </div>
                </div>
            </div>

            {/* ── Table ── */}
            <div className="table-wrap">

                {/* Search */}
                <div className="table-search">
                    <Search size={14} style={{ color: 'var(--t-faint)' }} />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search transactions..."
                    />
                </div>

                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width: 90 }}>Date</th>
                            <th>Description</th>
                            <th style={{ textAlign: 'right', color: 'var(--c-paid)', width: 110 }}>Cash In</th>
                            <th style={{ textAlign: 'right', color: 'var(--c-overdue)', width: 110 }}>Cash Out</th>
                            <th style={{ textAlign: 'right', color: 'var(--c-paid)', width: 110 }}>Bank In</th>
                            <th style={{ textAlign: 'right', color: 'var(--c-overdue)', width: 110 }}>Bank Out</th>
                            <th style={{ textAlign: 'right', width: 110 }}>Cash Bal.</th>
                            <th style={{ textAlign: 'right', width: 110 }}>Bank Bal.</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--t-faint)', fontSize: 13 }}>
                                Loading...
                            </td></tr>
                        ) : withBalance.length === 0 ? (
                            <tr><td colSpan={8} style={{ textAlign: 'center', padding: 36, color: 'var(--t-faint)', fontSize: 13 }}>
                                No transactions in this period
                            </td></tr>
                        ) : withBalance.map((e: any, idx: number) => {

                            // Insert a subtle date separator row when date changes
                            const prevDate = idx > 0 ? withBalance[idx - 1].entry_date : null
                            const showDateRow = e.entry_date !== prevDate

                            return [
                                showDateRow && (
                                    <tr key={`date-${e.entry_date}`}>
                                        <td colSpan={8} style={{
                                            background: 'var(--bg-subtle)',
                                            padding: '6px 16px',
                                            fontSize: 11,
                                            fontFamily: 'IBM Plex Mono',
                                            fontWeight: 600,
                                            color: 'var(--t-muted)',
                                            letterSpacing: '0.05em',
                                            borderBottom: '1px solid var(--border)',
                                            textTransform: 'uppercase'
                                        }}>
                                            {new Date(e.entry_date + 'T00:00:00').toLocaleDateString('en-PK', {
                                                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                                            })}
                                        </td>
                                    </tr>
                                ),
                                <tr key={e.id}>
                                    <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-faint)' }}>
                                        {e.entry_date}
                                    </td>
                                    <td>
                                        {e.description}
                                        {e.receipt_number && (
                                            <span style={{
                                                marginLeft: 6, fontSize: 11, color: 'var(--t-faint)',
                                                fontFamily: 'IBM Plex Mono'
                                            }}>
                                                #{e.receipt_number}
                                            </span>
                                        )}
                                    </td>
                                    <td style={{
                                        textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: 12,
                                        color: e.cash_in > 0 ? 'var(--c-paid)' : 'var(--t-faint)'
                                    }}>
                                        {e.cash_in > 0 ? fmt(e.cash_in) : '—'}
                                    </td>
                                    <td style={{
                                        textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: 12,
                                        color: e.cash_out > 0 ? 'var(--c-overdue)' : 'var(--t-faint)'
                                    }}>
                                        {e.cash_out > 0 ? fmt(e.cash_out) : '—'}
                                    </td>
                                    <td style={{
                                        textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: 12,
                                        color: e.bank_in > 0 ? 'var(--c-paid)' : 'var(--t-faint)'
                                    }}>
                                        {e.bank_in > 0 ? fmt(e.bank_in) : '—'}
                                    </td>
                                    <td style={{
                                        textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: 12,
                                        color: e.bank_out > 0 ? 'var(--c-overdue)' : 'var(--t-faint)'
                                    }}>
                                        {e.bank_out > 0 ? fmt(e.bank_out) : '—'}
                                    </td>
                                    <td style={{
                                        textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: 12,
                                        fontWeight: 500,
                                        color: e.cash_balance >= 0 ? 'var(--t-primary)' : 'var(--c-overdue)'
                                    }}>
                                        {fmt(e.cash_balance)}
                                    </td>
                                    <td style={{
                                        textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: 12,
                                        fontWeight: 500,
                                        color: e.bank_balance >= 0 ? 'var(--t-primary)' : 'var(--c-overdue)'
                                    }}>
                                        {fmt(e.bank_balance)}
                                    </td>
                                </tr>
                            ]
                        })}
                    </tbody>

                    {/* Period totals footer */}
                    {withBalance.length > 0 && (
                        <tfoot>
                            <tr style={{ borderTop: '2px solid var(--border-strong)', background: 'var(--bg-subtle)' }}>
                                <td colSpan={2} style={{
                                    padding: '10px 16px', fontSize: 11,
                                    fontFamily: 'IBM Plex Mono', fontWeight: 700,
                                    textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--t-muted)'
                                }}>
                                    Period Total
                                </td>
                                <td style={{
                                    textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 700,
                                    fontSize: 13, color: 'var(--c-paid)', padding: '10px 16px'
                                }}>
                                    {fmt(totalCashIn)}
                                </td>
                                <td style={{
                                    textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 700,
                                    fontSize: 13, color: 'var(--c-overdue)', padding: '10px 16px'
                                }}>
                                    {fmt(totalCashOut)}
                                </td>
                                <td style={{
                                    textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 700,
                                    fontSize: 13, color: 'var(--c-paid)', padding: '10px 16px'
                                }}>
                                    {fmt(totalBankIn)}
                                </td>
                                <td style={{
                                    textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 700,
                                    fontSize: 13, color: 'var(--c-overdue)', padding: '10px 16px'
                                }}>
                                    {fmt(totalBankOut)}
                                </td>
                                <td style={{
                                    textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 700,
                                    fontSize: 13, padding: '10px 16px',
                                    color: closingCash >= 0 ? 'var(--t-primary)' : 'var(--c-overdue)'
                                }}>
                                    {fmt(closingCash)}
                                </td>
                                <td style={{
                                    textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 700,
                                    fontSize: 13, padding: '10px 16px',
                                    color: closingBank >= 0 ? 'var(--t-primary)' : 'var(--c-overdue)'
                                }}>
                                    {fmt(closingBank)}
                                </td>
                            </tr>
                        </tfoot>
                    )}
                </table>

                <div className="table-footer">
                    <span>{filtered.length} entries</span>
                    <span style={{ fontFamily: 'IBM Plex Mono' }}>
                        {startDate} — {endDate}
                    </span>
                </div>
            </div>
        </div>
    )
}