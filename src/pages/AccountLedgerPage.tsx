import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Search, TrendingUp, TrendingDown, Minus, Printer, BookMarked, ScrollText, BarChart3, ArrowRight, FileDown } from 'lucide-react'
import { exportExcelFile } from '../utils/exportExcel'

const ipc = (window as any).ipcRenderer
const fmt  = (n: number) => `Rs. ${(n || 0).toLocaleString()}`
const fmtN = (n: number) => n === 0 ? '—' : fmt(n)

// ── Account type colour coding ────────────────────────────────
const typeColour: Record<string, string> = {
  asset:     '#1d4ed8',
  liability: '#b45309',
  equity:    '#7c3aed',
  revenue:   '#15803d',
  expense:   '#b91c1c',
}

const typeBg: Record<string, string> = {
  asset:     '#eff6ff',
  liability: '#fffbeb',
  equity:    '#f5f3ff',
  revenue:   '#f0fdf4',
  expense:   '#fef2f2',
}

const typeLabel: Record<string, string> = {
  asset:     'Asset',
  liability: 'Liability',
  equity:    'Equity',
  revenue:   'Revenue',
  expense:   'Expense',
}

// ── Ref type label ────────────────────────────────────────────
const refLabel: Record<string, string> = {
  payment:              'Payment',
  expenditure:          'Expenditure',
  expenditure_reversal: 'Reversal',
  manual:               'Manual Entry',
}

export default function AccountLedgerPage() {
  const navigate = useNavigate()
  const now  = new Date()
  const [view,        setView]        = useState<'general' | 'accounts'>('general')
  const [accounts,    setAccounts]    = useState<any[]>([])
  const [selected,    setSelected]    = useState<any>(null)
  const [entries,     setEntries]     = useState<any[]>([])
  const [headings,    setHeadings]    = useState<any[]>([])
  const [headingsLoading, setHeadingsLoading] = useState(false)
  const [search,      setSearch]      = useState('')
  const [loading,     setLoading]     = useState(false)
  const [startDate,   setStartDate]   = useState(
    `${now.getFullYear()}-01-01`
  )
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0])

  // ── Load chart of accounts ─────────────────────────────────
  useEffect(() => {
    if (!ipc) return
    ipc.invoke('db:get-accounts').then((r: any[]) => setAccounts(r || []))
  }, [])

  // ── Load ledger entries for selected account ───────────────
  const load = useCallback(async () => {
    if (!ipc || !selected) return
    setLoading(true)
    try {
      const r = await ipc.invoke('db:get-ledger-entries', {
        accountId: selected.id,
        startDate,
        endDate,
      })
      setEntries(r || [])
    } finally {
      setLoading(false)
    }
  }, [selected, startDate, endDate])

  useEffect(() => { load() }, [load])

  const loadHeadings = useCallback(async () => {
    if (!ipc) return
    setHeadingsLoading(true)
    try {
      const rows = await ipc.invoke('db:get-ledger-headings-summary', { startDate, endDate })
      setHeadings(rows || [])
    } finally {
      setHeadingsLoading(false)
    }
  }, [startDate, endDate])

  useEffect(() => { loadHeadings() }, [loadHeadings])

  // ── Running balance ────────────────────────────────────────
  // For asset/expense: normal debit balance → debit increases, credit decreases
  // For liability/equity/revenue: normal credit balance → credit increases, debit decreases
  const normalBalance = selected?.normal_balance || 'debit'

  let running = 0
  const rows = entries.map(e => {
    if (normalBalance === 'debit') {
      running += (e.debit || 0) - (e.credit || 0)
    } else {
      running += (e.credit || 0) - (e.debit || 0)
    }
    return { ...e, balance: running }
  })

  const totalDebit  = entries.reduce((s, e) => s + (e.debit  || 0), 0)
  const totalCredit = entries.reduce((s, e) => s + (e.credit || 0), 0)
  const closingBal  = rows[rows.length - 1]?.balance ?? 0

  // ── Filter accounts list ───────────────────────────────────
  const filteredAccounts = accounts.filter(a =>
    a.account_name.toLowerCase().includes(search.toLowerCase()) ||
    a.account_code.toLowerCase().includes(search.toLowerCase())
  )

  // Group by type
  const grouped = filteredAccounts.reduce((g: Record<string, any[]>, a) => {
    const t = a.account_type || 'other'
    if (!g[t]) g[t] = []
    g[t].push(a)
    return g
  }, {})

  const typeOrder = ['asset', 'liability', 'equity', 'revenue', 'expense']

  const groupedHeadings = typeOrder.reduce((acc: Record<string, any>, type) => {
    const rows = headings.filter((h: any) => h.account_type === type)
    const totalDebit = rows.reduce((s: number, h: any) => s + (h.total_debit || 0), 0)
    const totalCredit = rows.reduce((s: number, h: any) => s + (h.total_credit || 0), 0)
    acc[type] = {
      rows,
      totalDebit,
      totalCredit,
      net: totalDebit - totalCredit,
    }
    return acc
  }, {})

  // ── Print ──────────────────────────────────────────────────
  const handlePrint = async () => {
    if (!selected) return
    const { default: jsPDF }     = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF('landscape')

    doc.setFontSize(16); doc.setFont('helvetica', 'bold')
    doc.text('River View Co-operative Housing Society', 148, 14, { align: 'center' })
    doc.setFontSize(12)
    doc.text(`Ledger Account: ${selected.account_code} — ${selected.account_name}`, 148, 21, { align: 'center' })
    doc.setFontSize(10); doc.setFont('helvetica', 'normal')
    doc.text(`Period: ${startDate}  to  ${endDate}`, 148, 27, { align: 'center' })

    autoTable(doc, {
      startY: 33,
      head: [['Date', 'Description', 'Voucher / Ref', 'Type', 'Debit (Rs.)', 'Credit (Rs.)', 'Balance (Rs.)']],
      body: rows.map(r => [
        r.entry_date,
        r.description,
        r.voucher_number || '—',
        refLabel[r.reference_type] || r.reference_type,
        r.debit  > 0 ? r.debit.toLocaleString()  : '—',
        r.credit > 0 ? r.credit.toLocaleString() : '—',
        r.balance.toLocaleString(),
      ]),
      foot: [[
        '', '', '', 'TOTALS',
        totalDebit.toLocaleString(),
        totalCredit.toLocaleString(),
        closingBal.toLocaleString() + (normalBalance === 'debit' ? ' Dr' : ' Cr'),
      ]],
      theme: 'grid',
      headStyles:   { fillColor: [29, 78, 216] },
      footStyles:   { fillColor: [241, 245, 249], textColor: [17, 17, 17], fontStyle: 'bold' },
      styles:       { fontSize: 9 },
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    })

    doc.save(`ledger-${selected.account_code}-${startDate}-${endDate}.pdf`)
  }

  const headingRowsForExport = typeOrder.flatMap((type) =>
    (groupedHeadings[type]?.rows || []).map((a: any) => ({
      account_type: typeLabel[a.account_type] || a.account_type,
      account_code: a.account_code,
      account_name: a.account_name,
      debit: Number(a.total_debit || 0),
      credit: Number(a.total_credit || 0),
      entry_count: Number(a.entry_count || 0),
    }))
  )

  const exportHeadingsExcel = async () => {
    if (!headingRowsForExport.length) return
    await exportExcelFile({
      fileName: `general-ledger-headers-${startDate}-to-${endDate}`,
      sheetName: 'General Ledger',
      title: 'River View Cooperative Housing Society Ltd.',
      subtitle: `General Ledger Header Summary (${startDate} to ${endDate})`,
      headers: ['Type', 'Code', 'Header', 'Debit (Rs.)', 'Credit (Rs.)', 'Entries'],
      rows: headingRowsForExport.map((r: any) => [
        r.account_type,
        r.account_code,
        r.account_name,
        r.debit,
        r.credit,
        r.entry_count,
      ]),
      numericColumns: [3, 4, 5],
    })
  }

  const printHeadingsPdf = async () => {
    if (!headingRowsForExport.length) return
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF('landscape')

    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text('River View Co-operative Housing Society', 148, 14, { align: 'center' })
    doc.setFontSize(12)
    doc.text('General Ledger Header Summary', 148, 21, { align: 'center' })
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Period: ${startDate} to ${endDate}`, 148, 27, { align: 'center' })

    autoTable(doc, {
      startY: 33,
      head: [['Type', 'Code', 'Header', 'Debit (Rs.)', 'Credit (Rs.)', 'Entries']],
      body: headingRowsForExport.map((r: any) => [
        r.account_type,
        r.account_code,
        r.account_name,
        r.debit > 0 ? r.debit.toLocaleString() : '0',
        r.credit > 0 ? r.credit.toLocaleString() : '0',
        String(r.entry_count || 0),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [29, 78, 216] },
      styles: { fontSize: 8.5 },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
    })

    doc.save(`general-ledger-headers-${startDate}-to-${endDate}.pdf`)
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="page" style={{ padding: 0, display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ── Account list (left panel) ──────────────────────── */}
      <div style={{
        width: 260, minWidth: 260, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', background: '#fff', height: '100vh', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--t-primary)', marginBottom: 10, letterSpacing: '-0.01em' }}>
            Ledger Accounts
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--t-faint)', pointerEvents: 'none' }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search accounts…"
              style={{ paddingLeft: 30, width: '100%', boxSizing: 'border-box', height: 32, fontSize: 12.5 }}
            />
          </div>
        </div>

        {/* Grouped account list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>

          {/* ── General option ─────────────────────────────── */}
          <button onClick={() => { setView('general'); setSelected(null) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '9px 16px', border: 'none', cursor: 'pointer', textAlign: 'left',
              background: view === 'general' ? '#eff6ff' : 'transparent',
              borderLeft: view === 'general' ? '3px solid #1d4ed8' : '3px solid transparent',
              transition: 'all 0.1s', marginBottom: 4,
            }}
          >
            <BookMarked size={15} style={{ color: '#1d4ed8', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: view === 'general' ? 700 : 500, color: 'var(--t-primary)' }}>
                General
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--t-faint)' }}>
                Overview & quick access
              </div>
            </div>
          </button>

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 16px 8px' }} />

          {typeOrder.map(type => {
            const list = grouped[type]
            if (!list?.length) return null
            return (
              <div key={type}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: typeColour[type], padding: '10px 16px 4px', fontFamily: 'IBM Plex Mono',
                }}>
                  {typeLabel[type]}
                </div>
                {list.map((a: any) => (
                  <button key={a.id} onClick={() => { setView('accounts'); setSelected(a) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                      padding: '7px 16px', border: 'none', cursor: 'pointer', textAlign: 'left',
                      background: selected?.id === a.id ? typeBg[type] : 'transparent',
                      borderLeft: selected?.id === a.id ? `3px solid ${typeColour[type]}` : '3px solid transparent',
                      transition: 'all 0.1s',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: selected?.id === a.id ? 600 : 400, color: 'var(--t-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.account_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--t-faint)', fontFamily: 'IBM Plex Mono' }}>
                        {a.account_code}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Main ledger view (right) ───────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-subtle)' }}>

        {view === 'general' ? (
          /* ── General hub view ──────────────────────────── */
          <div style={{ flex: 1, overflowY: 'auto', padding: '32px 28px' }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t-primary)', letterSpacing: '-0.01em' }}>
                General Ledger
              </div>
              <div style={{ fontSize: 13, color: 'var(--t-faint)', marginTop: 4 }}>
                Access all ledger modules from here, or select an account from the left panel.
              </div>
            </div>

            <div style={{
              background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--r-lg, 8px)',
              padding: '12px 14px', marginBottom: 16,
              display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: 12, marginBottom: 4 }}>From</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ height: 32, fontSize: 12.5 }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: 12, marginBottom: 4 }}>To</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ height: 32, fontSize: 12.5 }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" style={{ height: 32, fontSize: 12.5 }} onClick={printHeadingsPdf} disabled={headingsLoading || headingRowsForExport.length === 0}>
                  <Printer size={13} /> Print PDF
                </button>
                <button className="btn btn-ghost" style={{ height: 32, fontSize: 12.5 }} onClick={exportHeadingsExcel} disabled={headingsLoading || headingRowsForExport.length === 0}>
                  <FileDown size={13} /> Export Excel
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                {
                  icon: BookOpen, label: 'Cash Book', route: '/cashbook', color: '#1d4ed8', bg: '#eff6ff',
                  desc: 'Daily cash & bank transactions with running balances',
                },
                {
                  icon: ScrollText, label: 'Journal Entries', route: '/journal', color: '#7c3aed', bg: '#f5f3ff',
                  desc: 'Double-entry journal with debit & credit lines',
                },
                {
                  icon: BarChart3, label: 'Reports', route: '/reports', color: '#15803d', bg: '#f0fdf4',
                  desc: 'Trial Balance, Fund Summary & Income/Expenditure',
                },
              ].map(item => {
                const Icon = item.icon
                return (
                  <button
                    key={item.route}
                    onClick={() => navigate(item.route)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 14,
                      padding: '20px', border: '1px solid var(--border)', borderRadius: 'var(--r-lg, 8px)',
                      background: '#fff', cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = item.color
                      e.currentTarget.style.boxShadow = `0 2px 8px ${item.color}18`
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--border)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  >
                    <div style={{
                      width: 40, height: 40, borderRadius: 8, background: item.bg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <Icon size={20} style={{ color: item.color }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-primary)' }}>
                          {item.label}
                        </span>
                        <ArrowRight size={13} style={{ color: 'var(--t-faint)' }} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--t-faint)', marginTop: 4, lineHeight: 1.4 }}>
                        {item.desc}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Account summary */}
            {accounts.length > 0 && (
              <div style={{ marginTop: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-muted)', fontFamily: 'IBM Plex Mono', letterSpacing: '0.04em' }}>
                    CHART OF ACCOUNTS MASTER RECORDS ({startDate} to {endDate})
                  </div>
                </div>
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--r-lg, 8px)', overflow: 'hidden' }}>
                  {typeOrder.map(type => {
                    const list = groupedHeadings[type]?.rows || []
                    if (!list.length) return null
                    return (
                      <div key={type} style={{ borderBottom: '1px solid var(--border)' }}>
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 16px', background: typeBg[type],
                        }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: typeColour[type], fontFamily: 'IBM Plex Mono', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                            {typeLabel[type]}
                          </span>
                          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--t-faint)', fontFamily: 'IBM Plex Mono' }}>
                            <span>{list.length} account{list.length !== 1 ? 's' : ''}</span>
                            <span>Dr {fmt(groupedHeadings[type].totalDebit)}</span>
                            <span>Cr {fmt(groupedHeadings[type].totalCredit)}</span>
                          </div>
                        </div>
                        {list.map((a: any) => (
                          <button key={a.id}
                            onClick={() => { setView('accounts'); setSelected(a) }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                              padding: '7px 16px', border: 'none', borderBottom: '1px solid var(--border)',
                              cursor: 'pointer', textAlign: 'left', background: 'transparent',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-subtle)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <span style={{ fontSize: 11.5, fontFamily: 'IBM Plex Mono', color: 'var(--t-faint)', minWidth: 44 }}>
                              {a.account_code}
                            </span>
                            <span style={{ fontSize: 12.5, color: 'var(--t-primary)', flex: 1 }}>
                              {a.account_name}
                            </span>
                            <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: '#b91c1c', minWidth: 88, textAlign: 'right' }}>
                              Dr {fmtN(a.total_debit || 0)}
                            </span>
                            <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: '#15803d', minWidth: 88, textAlign: 'right' }}>
                              Cr {fmtN(a.total_credit || 0)}
                            </span>
                            <span style={{ fontSize: 10.5, color: a.entry_count > 0 ? 'var(--t-faint)' : '#b91c1c', minWidth: 56, textAlign: 'right' }}>
                              {a.entry_count > 0 ? `${a.entry_count} in` : 'No input'}
                            </span>
                            <span style={{ fontSize: 10.5, color: (a.parent_id || a.child_count > 0) ? 'var(--t-faint)' : '#b91c1c', minWidth: 78, textAlign: 'right' }}>
                              {(a.parent_id || a.child_count > 0) ? 'Linked' : 'No link'}
                            </span>
                            <ArrowRight size={12} style={{ color: 'var(--t-faint)' }} />
                          </button>
                        ))}
                      </div>
                    )
                  })}
                </div>
                {headingsLoading && (
                  <div style={{ fontSize: 12, color: 'var(--t-faint)', marginTop: 8 }}>Syncing ledger heading summaries…</div>
                )}
              </div>
            )}
          </div>
        ) : !selected ? (
          /* Empty state */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--t-faint)' }}>
            <BookOpen size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
            <div style={{ fontSize: 14, fontWeight: 500 }}>Select an account</div>
            <div style={{ fontSize: 12.5, marginTop: 4 }}>Choose an account from the list to view its ledger</div>
          </div>
        ) : (
          <>
            {/* ── Top bar ─────────────────────────────────── */}
            <div style={{
              padding: '14px 24px', borderBottom: '1px solid var(--border)',
              background: '#fff', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, flexWrap: 'wrap',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
                    background: typeBg[selected.account_type], color: typeColour[selected.account_type],
                    fontFamily: 'IBM Plex Mono', letterSpacing: '0.04em',
                  }}>
                    {typeLabel[selected.account_type] || selected.account_type}
                  </span>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-faint)' }}>
                    {selected.account_code}
                  </span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--t-primary)', marginTop: 3, letterSpacing: '-0.01em' }}>
                  {selected.account_name}
                </div>
              </div>

              {/* Date range */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  style={{ height: 32, fontSize: 12.5 }} />
                <span style={{ color: 'var(--t-faint)', fontSize: 12 }}>to</span>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  style={{ height: 32, fontSize: 12.5 }} />
              </div>

              <button className="btn btn-ghost" onClick={handlePrint} style={{ height: 32, fontSize: 12.5 }}>
                <Printer size={14} /> Print PDF
              </button>
            </div>

            {/* ── KPI strip ───────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              {[
                {
                  label: 'TOTAL DEBITS', val: fmt(totalDebit),
                  icon: <TrendingUp size={14} />, clr: '#b91c1c',
                },
                {
                  label: 'TOTAL CREDITS', val: fmt(totalCredit),
                  icon: <TrendingDown size={14} />, clr: '#15803d',
                },
                {
                  label: 'CLOSING BALANCE', val: fmt(Math.abs(closingBal)),
                  sub: closingBal >= 0
                    ? (normalBalance === 'debit' ? 'Debit Balance' : 'Credit Balance')
                    : (normalBalance === 'debit' ? 'Credit Balance' : 'Debit Balance'),
                  icon: <Minus size={14} />, clr: typeColour[selected.account_type],
                },
              ].map(k => (
                <div key={k.label} style={{ background: '#fff', padding: '14px 20px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'IBM Plex Mono', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: k.clr }}>{k.icon}</span> {k.label}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'IBM Plex Mono', color: k.clr }}>
                    {k.val}
                  </div>
                  {k.sub && <div style={{ fontSize: 11, color: 'var(--t-faint)', marginTop: 3 }}>{k.sub}</div>}
                </div>
              ))}
            </div>

            {/* ── Ledger table ─────────────────────────────── */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
                <table className="data-table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th style={{ width: '38%' }}>Description</th>
                      <th>Voucher / Ref</th>
                      <th>Type</th>
                      <th style={{ textAlign: 'right', color: '#b91c1c' }}>Debit</th>
                      <th style={{ textAlign: 'right', color: '#15803d' }}>Credit</th>
                      <th style={{ textAlign: 'right' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={7} className="empty-row">Loading…</td></tr>
                    ) : rows.length === 0 ? (
                      <tr><td colSpan={7} className="empty-row">No entries found for this account in the selected period</td></tr>
                    ) : rows.map((r: any, i: number) => {
                      const balPositive = r.balance >= 0
                      return (
                        <tr key={i}>
                          <td style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{r.entry_date}</td>
                          <td style={{ fontSize: '0.83rem', color: 'var(--t-secondary)' }}>{r.description}</td>
                          <td style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.75rem', color: 'var(--t-faint)' }}>{r.voucher_number || '—'}</td>
                          <td>
                            {r.reference_type && (
                              <span style={{
                                fontSize: 10.5, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                                background: 'var(--bg-subtle)', color: 'var(--t-muted)',
                                fontFamily: 'IBM Plex Mono', border: '1px solid var(--border)',
                              }}>
                                {refLabel[r.reference_type] || r.reference_type}
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: '0.83rem', color: r.debit > 0 ? '#b91c1c' : 'var(--t-faint)' }}>
                            {fmtN(r.debit)}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: '0.83rem', color: r.credit > 0 ? '#15803d' : 'var(--t-faint)' }}>
                            {fmtN(r.credit)}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: '0.83rem', fontWeight: 600, color: balPositive ? 'var(--t-primary)' : '#b91c1c' }}>
                            {fmt(Math.abs(r.balance))}
                            <span style={{ fontSize: 9.5, fontWeight: 500, marginLeft: 4, color: 'var(--t-faint)' }}>
                              {balPositive ? 'Dr' : 'Cr'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>

                  {/* Totals footer */}
                  {rows.length > 0 && (
                    <tfoot>
                      <tr style={{ background: 'var(--bg-subtle)', borderTop: '2px solid var(--border)' }}>
                        <td colSpan={4} style={{ textAlign: 'right', fontSize: '0.8rem', fontWeight: 700, fontFamily: 'IBM Plex Mono', color: 'var(--t-muted)', padding: '10px 16px' }}>
                          PERIOD TOTALS
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 700, color: '#b91c1c', padding: '10px 16px' }}>
                          {fmt(totalDebit)}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 700, color: '#15803d', padding: '10px 16px' }}>
                          {fmt(totalCredit)}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 700, color: typeColour[selected.account_type], padding: '10px 16px' }}>
                          {fmt(Math.abs(closingBal))}
                          <span style={{ fontSize: 9.5, marginLeft: 4, color: 'var(--t-faint)' }}>
                            {closingBal >= 0 ? 'Dr' : 'Cr'}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}