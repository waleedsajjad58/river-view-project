import { useState, useEffect, useCallback } from 'react'
import { Search, ChevronDown, ChevronRight, Printer, FileDown } from 'lucide-react'
import { exportExcelFile } from '../utils/exportExcel'

const ipc = (window as any).ipcRenderer
const fmt = (n: number) => (n || 0).toLocaleString()

function printJournalEntries(entries: any[], startDate: string, endDate: string) {
    const refLabel: Record<string, string> = {
        payment: 'Payment', expenditure: 'Expenditure',
        expenditure_reversal: 'Reversal', manual: 'Manual', bank_deposit: 'Bank Deposit',
        bill_void: 'Bill Void',
    }
    let rows = ''
    let grandDr = 0, grandCr = 0
    for (const e of entries) {
        const entryDr = e.lines?.reduce((s: number, l: any) => s + (l.debit || 0), 0) || 0
        const entryCr = e.lines?.reduce((s: number, l: any) => s + (l.credit || 0), 0) || 0
        grandDr += entryDr; grandCr += entryCr
        const type = refLabel[e.reference_type] || (e.reference_type || '—')
        // Header row for the entry
        rows += `<tr class="entry-header">
            <td>${e.entry_date}</td>
            <td colspan="2"><strong>${e.description}</strong>${e.voucher_number ? ` <span class="vr">#${e.voucher_number}</span>` : ''}</td>
            <td class="type-cell">${type}</td>
            <td class="dr">${entryDr > 0 ? fmt(entryDr) : ''}</td>
            <td class="cr">${entryCr > 0 ? fmt(entryCr) : ''}</td>
        </tr>`
        // Lines
        for (const l of (e.lines || [])) {
            const indent = l.credit > 0 ? '&nbsp;&nbsp;&nbsp;&nbsp;' : ''
            rows += `<tr class="line-row">
                <td></td>
                <td class="acc-code">${l.account_code || ''}</td>
                <td>${indent}${l.account_name || ''}</td>
                <td></td>
                <td class="dr">${l.debit > 0 ? fmt(l.debit) : ''}</td>
                <td class="cr">${l.credit > 0 ? fmt(l.credit) : ''}</td>
            </tr>`
        }
    }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Journal Entries</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #111; padding: 16px; }
        h2 { font-size: 15px; text-align: center; margin-bottom: 2px; color: #1a2e5a; }
        .sub { text-align: center; font-size: 10px; color: #555; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; }
        thead th {
            background: #1a4a7a; color: #fff; padding: 5px 7px;
            font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
            border: 1px solid #0e3060;
        }
        thead th.dr { text-align: right; color: #ffcccc; }
        thead th.cr { text-align: right; color: #ccffcc; }
        tr.entry-header td {
            background: #eaf0fb; border-top: 2px solid #1a4a7a;
            border-bottom: 1px solid #b8c8e0; padding: 5px 7px; font-size: 11px;
        }
        tr.line-row td {
            background: #fff; border-bottom: 1px dotted #d8e0ec;
            padding: 3px 7px; font-size: 10.5px; color: #333;
        }
        td.acc-code { font-family: 'Courier New', monospace; font-size: 10px; color: #666; width: 55px; }
        td.type-cell { font-size: 10px; color: #555; width: 85px; }
        td.dr { text-align: right; font-family: 'Courier New', monospace; color: #b91c1c; width: 90px; }
        td.cr { text-align: right; font-family: 'Courier New', monospace; color: #15803d; width: 90px; }
        .vr { font-size: 9.5px; color: #777; font-family: 'Courier New', monospace; margin-left: 6px; }
        tfoot td { background: #1a4a7a; color: #fff; font-weight: 700; padding: 6px 7px; border-top: 2px solid #0e3060; }
        tfoot td.dr { text-align: right; color: #ffcccc; }
        tfoot td.cr { text-align: right; color: #ccffcc; }
        .meta { display: flex; justify-content: space-between; font-size: 10px; color: #666; margin-bottom: 10px; padding: 4px 0; border-bottom: 1px solid #ddd; }
        @media print { body { padding: 0; } }
    </style>
    </head><body>
    <h2>River View Cooperative Housing Society Ltd.</h2>
    <div class="sub">Journal Entries — ${startDate} to ${endDate}</div>
    <div class="meta"><span>${entries.length} entries</span><span>Printed: ${new Date().toLocaleDateString('en-PK')}</span></div>
    <table>
        <thead><tr>
            <th style="width:88px">Date</th>
            <th style="width:55px">Code</th>
            <th>Description / Account</th>
            <th style="width:85px">Type</th>
            <th class="dr">Debit (Rs.)</th>
            <th class="cr">Credit (Rs.)</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
            <td colspan="4" style="text-align:right;letter-spacing:0.05em;font-size:10px;">TOTALS</td>
            <td class="dr">${fmt(grandDr)}</td>
            <td class="cr">${fmt(grandCr)}</td>
        </tr></tfoot>
    </table>
    <script>window.onload = () => { window.print(); }<\/script>
    </body></html>`
    if (ipc) ipc.invoke('db:print-html-report', html)
}

async function exportJournalExcel(entries: any[], startDate: string, endDate: string) {
    const refLabel: Record<string, string> = {
        payment: 'Payment', expenditure: 'Expenditure',
        expenditure_reversal: 'Reversal', manual: 'Manual', bank_deposit: 'Bank Deposit',
        bill_void: 'Bill Void',
    }

    const rows: (string | number)[][] = []

    let grandDr = 0, grandCr = 0

    for (const e of entries) {
        const type = refLabel[e.reference_type] || (e.reference_type || '')
        rows.push([
            e.entry_date,
            e.voucher_number || '',
            type,
            e.description || '',
            '', '', '', '',
        ])
        for (const l of (e.lines || [])) {
            grandDr += (l.debit || 0)
            grandCr += (l.credit || 0)
            rows.push([
                '', '', '', '',
                l.account_code || '',
                l.account_name || '',
                l.debit  > 0 ? String(l.debit)  : '',
                l.credit > 0 ? String(l.credit) : '',
            ])
        }
    }

    rows.push([])
    rows.push(['', '', '', 'TOTALS', '', '', grandDr, grandCr])

    await exportExcelFile({
        fileName: `journal-entries-${startDate}-to-${endDate}`,
        sheetName: 'Journal Entries',
        title: 'River View Cooperative Housing Society Ltd.',
        subtitle: `Journal Entries - ${startDate} to ${endDate}`,
        meta: [`Generated: ${new Date().toLocaleDateString('en-PK')} | Entries: ${entries.length}`],
        headers: ['Date', 'Voucher No.', 'Type', 'Description', 'Account Code', 'Account Name', 'Debit (Rs.)', 'Credit (Rs.)'],
        rows,
        numericColumns: [7, 8],
    })
}

export default function JournalEntriesPage() {
    const now = new Date()
    const [startDate, setStartDate] = useState(
        `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
    )
    const [endDate,   setEndDate]   = useState(now.toISOString().split('T')[0])
    const [entries,   setEntries]   = useState<any[]>([])
    const [search,    setSearch]    = useState('')
    const [expanded,  setExpanded]  = useState<Set<number>>(new Set())
    const [loading,   setLoading]   = useState(false)

    const load = useCallback(async () => {
        if (!ipc) return
        setLoading(true)
        try {
            const data = await ipc.invoke('db:get-journal-entries', { startDate, endDate })
            setEntries(data || [])
        } catch(e) { console.error(e) }
        finally { setLoading(false) }
    }, [startDate, endDate])

    useEffect(() => { load() }, [load])

    const toggle = (id: number) => {
        setExpanded(prev => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }

    const refLabel: Record<string, string> = {
        payment:              'Payment',
        expenditure:          'Expenditure',
        expenditure_reversal: 'Reversal',
        manual:               'Manual',
        bill_void:            'Bill Void',
    }

    const refColour: Record<string, string> = {
        payment:              '#1d4ed8',
        expenditure:          '#b45309',
        expenditure_reversal: '#b91c1c',
        manual:               '#7c3aed',
        bill_void:            '#475569',
    }

    const q = search.toLowerCase()
    const filtered = q
        ? entries.filter(e =>
            e.description?.toLowerCase().includes(q) ||
            e.voucher_number?.toLowerCase().includes(q) ||
            e.reference_type?.toLowerCase().includes(q)
          )
        : entries

    const totalEntries = filtered.length
    const totalDebit   = filtered.reduce((s, e) =>
        s + (e.lines?.reduce((ls: number, l: any) => ls + (l.debit || 0), 0) || 0), 0)

    return (
        <div className="page">
            {/* ── Header ── */}
            <div className="page-header">
                <div>
                    <h1>Journal Entries</h1>
                    <p className="subtitle">Double-entry records posted by payments, expenses and manual entries</p>
                </div>
                <div className="header-actions">
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    <input type="date" value={endDate}   onChange={e => setEndDate(e.target.value)} />
                    {filtered.length > 0 && (
                        <>
                        <button className="btn btn-ghost" onClick={() => exportJournalExcel(filtered, startDate, endDate)}>
                            <FileDown size={15} /> Export Excel
                        </button>
                        <button className="btn btn-ghost" onClick={() => printJournalEntries(filtered, startDate, endDate)}>
                            <Printer size={15} /> Print
                        </button>
                        </>
                    )}
                </div>
            </div>

            {/* ── Summary strip ── */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:1, background:'var(--border)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', overflow:'hidden', marginBottom:20 }}>
                {[
                    { label:'TOTAL ENTRIES',  val: String(totalEntries),         sub: 'in period' },
                    { label:'TOTAL POSTED',   val: `Rs. ${fmt(totalDebit)}`,      sub: 'debits = credits' },
                    { label:'PERIOD',         val: `${startDate}`,                sub: `to ${endDate}` },
                ].map(k => (
                    <div key={k.label} style={{ background:'#fff', padding:'14px 20px' }}>
                        <div style={{ fontSize:10, fontWeight:700, color:'var(--t-faint)', letterSpacing:'0.08em', textTransform:'uppercase', fontFamily:'IBM Plex Mono', marginBottom:6 }}>{k.label}</div>
                        <div style={{ fontSize:17, fontWeight:700, fontFamily:'IBM Plex Mono', color:'var(--t-primary)' }}>{k.val}</div>
                        <div style={{ fontSize:11, color:'var(--t-faint)', marginTop:3 }}>{k.sub}</div>
                    </div>
                ))}
            </div>

            {/* ── Table ── */}
            <div className="table-wrap">
                <div className="table-search">
                    <Search size={14} style={{ color:'var(--t-faint)' }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search entries…" />
                </div>

                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width:32 }}></th>
                            <th style={{ width:100 }}>Date</th>
                            <th>Description</th>
                            <th style={{ width:160 }}>Voucher / Ref</th>
                            <th style={{ width:110 }}>Type</th>
                            <th style={{ textAlign:'right', width:120 }}>Debit</th>
                            <th style={{ textAlign:'right', width:120 }}>Credit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={7} style={{ textAlign:'center', padding:32, color:'var(--t-faint)', fontSize:13 }}>Loading…</td></tr>
                        ) : filtered.length === 0 ? (
                            <tr><td colSpan={7} style={{ textAlign:'center', padding:36, color:'var(--t-faint)', fontSize:13 }}>No journal entries in this period</td></tr>
                        ) : filtered.map((e: any) => {
                            const isOpen   = expanded.has(e.id)
                            const entryDr  = e.lines?.reduce((s: number, l: any) => s + (l.debit  || 0), 0) || 0
                            const entryCr  = e.lines?.reduce((s: number, l: any) => s + (l.credit || 0), 0) || 0
                            const colour   = refColour[e.reference_type] || 'var(--t-muted)'
                            const label    = refLabel[e.reference_type]  || e.reference_type

                            return [
                                /* ── Summary row ── */
                                <tr key={e.id} onClick={() => toggle(e.id)} style={{ cursor:'pointer' }}>
                                    <td style={{ color:'var(--t-faint)', paddingRight:0 }}>
                                        {isOpen ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
                                    </td>
                                    <td style={{ fontFamily:'IBM Plex Mono', fontSize:12, color:'var(--t-faint)', whiteSpace:'nowrap' }}>
                                        {e.entry_date}
                                    </td>
                                    <td style={{ fontSize:13 }}>
                                        {e.description}
                                        {e.voucher_number && (
                                            <span style={{ marginLeft:6, fontSize:11, color:'var(--t-faint)', fontFamily:'IBM Plex Mono' }}>
                                                #{e.voucher_number}
                                            </span>
                                        )}
                                    </td>
                                    <td style={{ fontFamily:'IBM Plex Mono', fontSize:11, color:'var(--t-faint)' }}>
                                        {e.voucher_number || '—'}
                                    </td>
                                    <td>
                                        <span style={{
                                            fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:3,
                                            background: colour + '18', color: colour,
                                            fontFamily:'IBM Plex Mono', border:`1px solid ${colour}33`
                                        }}>
                                            {label}
                                        </span>
                                    </td>
                                    <td style={{ textAlign:'right', fontFamily:'IBM Plex Mono', fontSize:12, fontWeight:500, color:'#b91c1c' }}>
                                        {fmt(entryDr)}
                                    </td>
                                    <td style={{ textAlign:'right', fontFamily:'IBM Plex Mono', fontSize:12, fontWeight:500, color:'#15803d' }}>
                                        {fmt(entryCr)}
                                    </td>
                                </tr>,

                                /* ── Expanded lines ── */
                                isOpen && (
                                    <tr key={`${e.id}-lines`}>
                                        <td colSpan={7} style={{ background:'var(--bg-subtle)', padding:'0 0 8px 48px', borderBottom:'1px solid var(--border)' }}>
                                            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                                                <thead>
                                                    <tr>
                                                        <th style={{ textAlign:'left', padding:'6px 12px 4px', fontFamily:'IBM Plex Mono', fontSize:10, fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase', color:'var(--t-faint)' }}>Account</th>
                                                        <th style={{ textAlign:'left', padding:'6px 12px 4px', fontFamily:'IBM Plex Mono', fontSize:10, fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase', color:'var(--t-faint)' }}>Code</th>
                                                        <th style={{ textAlign:'right', padding:'6px 12px 4px', fontFamily:'IBM Plex Mono', fontSize:10, fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase', color:'#b91c1c' }}>Dr</th>
                                                        <th style={{ textAlign:'right', padding:'6px 12px 4px', fontFamily:'IBM Plex Mono', fontSize:10, fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase', color:'#15803d' }}>Cr</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {e.lines?.map((l: any, i: number) => (
                                                        <tr key={i} style={{ borderTop:'1px solid var(--border)' }}>
                                                            <td style={{ padding:'5px 12px', color:'var(--t-secondary)' }}>{l.account_name}</td>
                                                            <td style={{ padding:'5px 12px', fontFamily:'IBM Plex Mono', fontSize:11, color:'var(--t-faint)' }}>{l.account_code}</td>
                                                            <td style={{ padding:'5px 12px', textAlign:'right', fontFamily:'IBM Plex Mono', color: l.debit  > 0 ? '#b91c1c' : 'var(--t-faint)' }}>
                                                                {l.debit  > 0 ? fmt(l.debit)  : '—'}
                                                            </td>
                                                            <td style={{ padding:'5px 12px', textAlign:'right', fontFamily:'IBM Plex Mono', color: l.credit > 0 ? '#15803d' : 'var(--t-faint)' }}>
                                                                {l.credit > 0 ? fmt(l.credit) : '—'}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </td>
                                    </tr>
                                )
                            ]
                        })}
                    </tbody>
                </table>

                <div className="table-footer">
                    <span>{filtered.length} entries</span>
                    <span style={{ fontFamily:'IBM Plex Mono' }}>{startDate} — {endDate}</span>
                </div>
            </div>
        </div>
    )
}