import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Zap, FileText, Users, Star, CreditCard, Plus, X,
  Search, ChevronDown, ChevronRight, RefreshCw,
  CheckCircle, AlertCircle, ScrollText
} from 'lucide-react'

const ipc = (window as any).ipcRenderer
const fmt = (n: any) => `Rs. ${(Number(n) || 0).toLocaleString()}`
const currentMonth = () => new Date().toISOString().slice(0, 7)

type MainTab = 'generate' | 'monthly' | 'tenant' | 'special'

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    paid: 'badge-paid', unpaid: 'badge-unpaid',
    partial: 'badge-partial', overdue: 'badge-overdue',
  }
  return <span className={`badge ${cls[status] || 'badge-gray'}`}>{status}</span>
}

function KpiStrip({ bills }: { bills: any[] }) {
  const billed      = bills.reduce((s, b) => s + (b.total_amount || 0), 0)
  const collected   = bills.reduce((s, b) => s + (b.amount_paid  || 0), 0)
  const outstanding = bills.reduce((s, b) => s + (b.balance_due  || 0), 0)
  const unpaid      = bills.filter(b => b.status !== 'paid').length
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1.5rem', marginBottom:'1.75rem' }}>
      {[
        { label:'TOTAL BILLED',  val: fmt(billed),      sub:`${bills.length} bills` },
        { label:'COLLECTED',     val: fmt(collected),   clr:'var(--c-paid)' },
        { label:'OUTSTANDING',   val: fmt(outstanding), clr: outstanding > 0 ? 'var(--c-overdue)' : undefined },
        { label:'UNPAID',        val: String(unpaid),   sub:'bills pending', clr: unpaid > 0 ? 'var(--c-partial)' : undefined },
      ].map((k: any) => (
        <div key={k.label} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:'1.35rem 1.6rem', boxShadow:'var(--shadow-card)' }}>
          <div style={{ fontSize:'0.72rem', fontWeight:600, color:'var(--t-faint)', letterSpacing:'0.07em', marginBottom:'0.4rem' }}>{k.label}</div>
          <div style={{ fontSize:'1.2rem', fontWeight:700, fontFamily:'IBM Plex Mono', color:k.clr }}>{k.val}</div>
          {k.sub && <div style={{ fontSize:'0.78rem', color:'var(--t-faint)', marginTop:'0.2rem' }}>{k.sub}</div>}
        </div>
      ))}
    </div>
  )
}

function FilterBar({ search, onSearch, month, onMonth, status, onStatus, allMonths, onAllMonths }: any) {
  return (
    <div style={{ display:'flex', gap:'0.85rem', alignItems:'center', flexWrap:'wrap', marginBottom:'1.5rem' }}>
      <div style={{ position:'relative', flex:'0 1 220px', minWidth:150 }}>
        <Search size={13} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--t-faint)', pointerEvents:'none' }} />
        <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Search…" style={{ paddingLeft:30, width:'100%', boxSizing:'border-box' }} />
      </div>
      {!allMonths && (
        <input type="month" value={month} onChange={e => onMonth(e.target.value)}
          style={{ padding:'0.44rem 0.75rem', borderRadius:'var(--r-md)', border:'1px solid var(--border)', fontSize:'0.875rem', background:'var(--bg-input)', color:'var(--text)' }} />
      )}
      <div style={{ display:'flex', gap:2, background:'var(--bg-page)', border:'1px solid var(--border)', borderRadius:'var(--r-md)', padding:2 }}>
        {[{v:'unpaid,partial,overdue',l:'Unpaid'},{v:'paid',l:'Paid'},{v:'all',l:'All'}].map(s => (
          <button key={s.v} onClick={() => onStatus(s.v)}
            style={{ padding:'0.3rem 0.7rem', borderRadius:'calc(var(--r-md) - 2px)', fontSize:'0.8rem', fontWeight:500, border:'none', cursor:'pointer', transition:'all 0.15s',
              background: status === s.v ? 'var(--accent)' : 'transparent',
              color:       status === s.v ? '#fff' : 'var(--t-faint)' }}>
            {s.l}
          </button>
        ))}
      </div>
      <label style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.83rem', color:'var(--t-faint)', cursor:'pointer', userSelect:'none' }}>
        <div onClick={onAllMonths} style={{ width:34, height:19, borderRadius:10, background: allMonths ? 'var(--accent)' : 'var(--border)', position:'relative', cursor:'pointer', transition:'background 0.2s', flexShrink:0 }}>
          <div style={{ width:15, height:15, borderRadius:'50%', background:'#fff', position:'absolute', top:2, left: allMonths ? 17 : 2, transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }} />
        </div>
        All Months
      </label>
    </div>
  )
}

const BILL_TYPE_BADGE: Record<string, { label:string; clr:string }> = {
  monthly: { label:'Owner',  clr:'var(--accent)' },
  tenant:  { label:'Tenant', clr:'#9333ea' },
}

function BillsTable({ bills, loading, mode, onCollect, onStatement, onPrint }: {
  bills:any[]; loading:boolean; mode:'monthly'|'tenant'|'combined';
  onCollect:(b:any)=>void; onStatement?:(b:any)=>void; onPrint:(b:any)=>void
}) {
  const colSpan = mode === 'combined' ? 10 : 9
  return (
    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', overflow:'hidden', boxShadow:'var(--shadow-card)' }}>
      <table className="data-table" style={{ margin:0 }}>
        <thead>
          <tr>
            <th>Bill #</th><th>Plot</th>
            {mode === 'combined' && <th>Type</th>}
            <th>{mode === 'tenant' ? 'Tenant' : 'Owner'}</th>
            <th>Month</th>
            <th style={{ textAlign:'right' }}>Total</th>
            <th style={{ textAlign:'right' }}>Paid</th>
            <th style={{ textAlign:'right' }}>Balance</th>
            <th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={colSpan} className="empty-row">Loading…</td></tr>
          ) : bills.length === 0 ? (
            <tr><td colSpan={colSpan} className="empty-row">No bills found for this period</td></tr>
          ) : bills.map(b => {
            const isTenantBill = b.bill_type === 'tenant'
            const personName = isTenantBill ? (b.tenant_name || '—') : (b.owner_name || '—')
            const typeMeta = BILL_TYPE_BADGE[b.bill_type]
            return (
              <tr key={b.id}>
                <td style={{ fontFamily:'IBM Plex Mono', fontSize:'0.78rem', color:'var(--t-faint)' }}>{b.bill_number}</td>
                <td><strong>{b.plot_number}</strong></td>
                {mode === 'combined' && (
                  <td>
                    {typeMeta && (
                      <span style={{ fontSize:'0.72rem', fontWeight:600, padding:'2px 7px', borderRadius:4,
                        background: isTenantBill ? 'rgba(147,51,234,0.1)' : 'var(--accent-light)',
                        color: typeMeta.clr, border:`1px solid ${isTenantBill ? 'rgba(147,51,234,0.25)' : 'var(--accent-border)'}` }}>
                        {typeMeta.label}
                      </span>
                    )}
                  </td>
                )}
                <td style={{ color:'var(--t-muted)', fontSize:'0.875rem' }}>{personName}</td>
                <td style={{ fontFamily:'IBM Plex Mono', fontSize:'0.83rem' }}>{b.billing_month}</td>
                <td style={{ textAlign:'right', fontFamily:'IBM Plex Mono' }}>{fmt(b.total_amount)}</td>
                <td style={{ textAlign:'right', fontFamily:'IBM Plex Mono', color:'var(--c-paid)' }}>{fmt(b.amount_paid)}</td>
                <td style={{ textAlign:'right', fontFamily:'IBM Plex Mono', color: b.balance_due > 0 ? 'var(--c-overdue)' : 'var(--t-faint)' }}>{fmt(b.balance_due)}</td>
                <td><StatusBadge status={b.status} /></td>
                <td>
                  <div style={{ display:'flex', gap:6 }}>
                    {(mode === 'tenant' || isTenantBill) && onStatement && b.tenant_id && (
                      <button className="btn btn-ghost btn-sm" onClick={() => onStatement(b)} title="View Statement">
                        <ScrollText size={13} />
                      </button>
                    )}
                    {b.status !== 'paid' && (
                      <button className="btn btn-primary btn-sm" onClick={() => onCollect(b)}>
                        <CreditCard size={13} /> Collect
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => onPrint(b)} title="Print Challan">🖨</button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// MODAL OVERLAY
// ══════════════════════════════════════════════════════════════
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

// ── Payment panel ─────────────────────────────────────────────
function PaymentPanel({ bill, detail, onClose, onSuccess }: any) {
  const [amount,  setAmount]  = useState('')
  const [method,  setMethod]  = useState('cash')
  const [receipt, setReceipt] = useState('')
  const [notes,   setNotes]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [posted,  setPosted]  = useState('')
  const [credit,  setCredit]  = useState(0)
  const [preview, setPreview] = useState<any>(null)

  // Separate current month charges from arrears
  const currentItems    = (detail?.items || []).filter(
    (it: any) => !it.charge_name?.toLowerCase().includes('arrears')
      && !it.charge_name?.toLowerCase().includes('late fee')
  )
  const previousBalance = 0  // arrears now merged into charge lines — section hidden
  const currentTotal    = bill?.total_amount || currentItems.reduce((s: number, i: any) => s + (i.amount || 0), 0)
  const alreadyPaid     = bill?.amount_paid || 0
  const balanceDue      = bill?.balance_due || 0

  useEffect(() => {
    setAmount(String(balanceDue || ''))
    setMethod('cash'); setReceipt(''); setNotes('')
    setError(''); setPosted(''); setPreview(null)
    if (bill?.plot_id && ipc) {
      ipc.invoke('db:get-plot-credit', bill.plot_id)
        .then((r: any) => setCredit(r?.balance || 0))
    }
  }, [bill?.id])

  // Live coverage preview — runs silently, shown simply
  useEffect(() => {
    const amt = parseFloat(amount)
    if (!bill?.plot_id || !amt || amt <= 0) { setPreview(null); return }
    ipc.invoke('db:get-payment-preview', { plotId: bill.plot_id, amount: amt })
      .then((r: any) => setPreview(r))
  }, [amount, bill?.plot_id])

  const handlePay = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    setLoading(true); setError('')
    try {
      const r = await ipc.invoke('db:record-payment', {
        billId: bill.id, amount: amt, paymentMethod: method,
        receiptNumber: receipt || undefined, notes: notes || undefined,
      })
      setPosted(r?.receiptNumber || '—')
      onSuccess()
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  // Human-readable coverage line e.g. "Clears Jan-26, Feb-26 · Mar-26 partial"
  const coverageLine = (() => {
    if (!preview?.breakdown?.length) return null
    const cleared = preview.breakdown.filter((b: any) => b.fully_cleared).map((b: any) => b.billing_month)
    const partial  = preview.breakdown.filter((b: any) => !b.fully_cleared)
    const parts = []
    if (cleared.length)  parts.push(`Clears ${cleared.join(', ')}`)
    if (partial.length)  parts.push(`${partial[0].billing_month} partial (Rs. ${partial[0].remaining_after.toLocaleString()} left)`)
    if (preview.advance_credit > 0) parts.push(`Rs. ${preview.advance_credit.toLocaleString()} saved as advance`)
    return parts.join(' · ')
  })()

  const row = (label: string, value: string, opts: any = {}) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
      fontSize: opts.large ? '0.95rem' : '0.845rem',
      fontWeight: opts.bold ? 700 : 400,
      padding: opts.large ? '0.5rem 0' : '0.22rem 0',
      borderTop: opts.separator ? '1px solid var(--border)' : undefined,
      marginTop: opts.separator ? '0.4rem' : undefined,
      color: opts.color || 'inherit' }}>
      <span style={{ color: opts.labelFaint ? 'var(--t-muted)' : 'inherit' }}>{label}</span>
      <span style={{ fontFamily:'IBM Plex Mono' }}>{value}</span>
    </div>
  )

  return (
    <PanelShell width={440}>
      <div className="panel-header">
        <div>
          <h3 style={{ margin:0 }}>{posted ? 'Payment Posted' : 'Collect Payment'}</h3>
          {!posted && (
            <div style={{ fontSize:'0.78rem', color:'var(--t-faint)', marginTop:2 }}>
              {bill.bill_number} · Plot {bill.plot_number}
              {bill.owner_name  && <span> · {bill.owner_name}</span>}
              {bill.tenant_name && <span> · {bill.tenant_name}</span>}
            </div>
          )}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16}/></button>
      </div>

      {/* ── Success state ── */}
      {posted ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center',
          justifyContent:'center', padding:'3rem 2rem', textAlign:'center' }}>
          <CheckCircle size={48} color="var(--c-paid)" style={{ marginBottom:'1rem' }}/>
          <h3 style={{ marginBottom:'0.5rem' }}>Payment Recorded</h3>
          <div style={{ color:'var(--t-faint)', fontSize:'0.875rem', marginBottom:'1.5rem' }}>
            Receipt: <strong style={{ fontFamily:'IBM Plex Mono', color:'var(--t-primary)' }}>{posted}</strong>
          </div>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      ) : (
        <div className="panel-body" style={{ flex:1 }}>

          {/* ────────────────────────────────────────────
              SECTION 1 — Previous Balance
          ──────────────────────────────────────────── */}
          {previousBalance > 0 && (
            <div style={{ background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)',
              borderRadius:8, padding:'0.85rem 1rem', marginBottom:'0.85rem' }}>
              <div style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--c-overdue)',
                letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:'0.4rem' }}>
                Previous Balance
              </div>
              {row('Outstanding dues', `Rs. ${previousBalance.toLocaleString()}`,
                { bold:true, color:'var(--c-overdue)' })}
            </div>
          )}

          {/* ────────────────────────────────────────────
              SECTION 2 — Current Month Charges
          ──────────────────────────────────────────── */}
          <div style={{ background:'var(--bg-page)', border:'1px solid var(--border)',
            borderRadius:8, padding:'0.85rem 1rem', marginBottom:'0.85rem' }}>
            <div style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--t-faint)',
              letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:'0.4rem' }}>
              {bill.billing_month || 'Current Month'} Charges
            </div>
            {currentItems.length > 0
              ? currentItems.map((it: any, i: number) =>
                  row(it.charge_name, `Rs. ${(it.amount || 0).toLocaleString()}`,
                    { labelFaint: true, key: i }))
              : row('Monthly charges', `Rs. ${currentTotal.toLocaleString()}`, { labelFaint:true })}
            {row('Current total', `Rs. ${currentTotal.toLocaleString()}`,
              { bold:true, separator:true })}
          </div>

          {/* ────────────────────────────────────────────
              SECTION 3 — Final Payable
          ──────────────────────────────────────────── */}
          <div style={{ background:'var(--bg-page)', border:'1px solid var(--border)',
            borderRadius:8, padding:'0.85rem 1rem', marginBottom:'1.1rem' }}>
            {previousBalance > 0 &&
              row('Previous balance', `Rs. ${previousBalance.toLocaleString()}`,
                { labelFaint:true, color:'var(--c-overdue)' })}
            {previousBalance > 0 &&
              row('Current total', `Rs. ${currentTotal.toLocaleString()}`,
                { labelFaint:true })}
            {alreadyPaid > 0 &&
              row('Already paid', `− Rs. ${alreadyPaid.toLocaleString()}`,
                { labelFaint:true, color:'var(--c-paid)' })}
            {credit > 0 &&
              row(`Advance credit available`, `Rs. ${credit.toLocaleString()}`,
                { labelFaint:true, color:'var(--accent)' })}
            {row('Total Payable',
              `Rs. ${balanceDue.toLocaleString()}`,
              { bold:true, large:true, separator: previousBalance > 0 || alreadyPaid > 0 })}
          </div>

          {/* ────────────────────────────────────────────
              SECTION 4 — Payment Input
          ──────────────────────────────────────────── */}
          <div className="form-group">
            <label>Amount (Rs.)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0" min="0" autoFocus
              style={{ fontSize:'1.1rem', fontWeight:700, fontFamily:'IBM Plex Mono' }} />
            {/* Coverage line — plain language, no "FIFO" jargon */}
            {coverageLine && (
              <div style={{ fontSize:'0.78rem', color:'var(--t-faint)', marginTop:'0.4rem',
                fontStyle:'italic', lineHeight:1.5 }}>
                {coverageLine}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Payment Method</label>
            <div style={{ display:'flex', gap:'0.5rem' }}>
              {(['cash','bank','cheque'] as const).map(m => (
                <button key={m} onClick={() => setMethod(m)}
                  className={`btn ${method === m ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex:1, fontSize:'0.82rem' }}>
                  {m === 'bank' ? 'Bank Transfer' : m === 'cheque' ? 'Cheque' : 'Cash'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
            <div className="form-group">
              <label>Receipt No. <small style={{ color:'var(--t-faint)' }}>(auto if blank)</small></label>
              <input type="text" value={receipt} onChange={e => setReceipt(e.target.value)}
                placeholder="Auto-generated" />
            </div>
            <div className="form-group">
              <label>Notes <small style={{ color:'var(--t-faint)' }}>(optional)</small></label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="e.g. cheque no." />
            </div>
          </div>

          {error && (
            <div className="msg msg-error" style={{ marginBottom:'1rem' }}>{error}</div>
          )}

          <div style={{ display:'flex', gap:'0.75rem' }}>
            <button className="btn btn-primary" style={{ flex:1 }}
              onClick={handlePay} disabled={loading}>
              {loading
                ? <><RefreshCw size={15} className="spin"/> Posting…</>
                : <><CreditCard size={15}/> Post Payment</>}
            </button>
            <button type="button" className="btn btn-ghost"
              onClick={() => {
                const remarks = window.prompt('Optional remarks for this print (leave blank to keep saved remarks):', '')
                if (remarks === null) return
                ipc.invoke('db:print-challan', {
                  billId: bill.id,
                  amount: parseFloat(amount) || null,
                  remarks: remarks.trim() || null,
                })
              }}>
              🖨 Challan
            </button>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>

        </div>
      )}
    </PanelShell>
  )
}

// ── Tenant Statement Panel ────────────────────────────────────
function TenantStatementPanel({ tenantId, tenantName, onClose }: { tenantId:number; tenantName:string; onClose:()=>void }) {
  const [data,    setData]    = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ipc || !tenantId) return
    ipc.invoke('db:get-tenant-statement', tenantId).then((r: any) => {
      setData(r); setLoading(false)
    })
  }, [tenantId])

  const fmtN = (n: any) => `Rs. ${(Number(n)||0).toLocaleString()}`

  return (
    <PanelShell width={520}>
      <div className="panel-header">
        <div>
          <h3 style={{ margin:0 }}>Tenant Statement</h3>
          <div style={{ fontSize:11.5, color:'var(--t-faint)', marginTop:2 }}>{tenantName}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16}/></button>
      </div>

      {loading ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t-faint)' }}>Loading…</div>
      ) : !data ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t-faint)' }}>No data found</div>
      ) : (
        <div className="panel-body" style={{ flex:1 }}>

          {/* Tenant info */}
          <div style={{ background:'var(--bg-page)', border:'1px solid var(--border)', borderRadius:6, padding:'0.875rem 1rem', marginBottom:'1.25rem' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem 1rem', fontSize:12.5 }}>
              {[
                ['Plot',       data.tenant?.plot_number],
                ['CNIC',       data.tenant?.cnic || '—'],
                ['Phone',      data.tenant?.phone || '—'],
                ['Start Date', data.tenant?.start_date || '—'],
                ['End Date',   data.tenant?.end_date || 'Active'],
                ['Monthly Rent', data.tenant?.monthly_rent ? fmtN(data.tenant.monthly_rent) : '—'],
              ].map(([k,v]) => (
                <div key={k}>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--t-faint)', textTransform:'uppercase', letterSpacing:'0.06em', fontFamily:'IBM Plex Mono', marginBottom:2 }}>{k}</div>
                  <div style={{ color:'var(--t-secondary)' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Summary strip */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:1, background:'var(--border)', borderRadius:6, overflow:'hidden', marginBottom:'1.25rem' }}>
            {[
              { label:'TOTAL BILLED',   val: fmtN(data.summary?.totalBilled),      clr: undefined },
              { label:'TOTAL PAID',     val: fmtN(data.summary?.totalPaid),         clr:'var(--c-paid)' },
              { label:'OUTSTANDING',    val: fmtN(data.summary?.totalOutstanding),  clr: data.summary?.totalOutstanding > 0 ? 'var(--c-overdue)' : undefined },
            ].map(k => (
              <div key={k.label} style={{ background:'var(--bg-card)', padding:'10px 14px' }}>
                <div style={{ fontSize:9.5, fontWeight:700, color:'var(--t-faint)', letterSpacing:'0.07em', textTransform:'uppercase', fontFamily:'IBM Plex Mono', marginBottom:5 }}>{k.label}</div>
                <div style={{ fontSize:14, fontWeight:700, fontFamily:'IBM Plex Mono', color:k.clr }}>{k.val}</div>
              </div>
            ))}
          </div>

          {/* Bills */}
          <div style={{ fontSize:11, fontWeight:700, color:'var(--t-faint)', letterSpacing:'0.07em', textTransform:'uppercase', fontFamily:'IBM Plex Mono', marginBottom:8 }}>
            Challans ({data.bills?.length || 0})
          </div>
          <div style={{ border:'1px solid var(--border)', borderRadius:6, overflow:'hidden', marginBottom:'1.25rem' }}>
            <table className="data-table" style={{ margin:0, fontSize:12 }}>
              <thead>
                <tr>
                  <th>Month</th>
                  <th style={{ textAlign:'right' }}>Amount</th>
                  <th style={{ textAlign:'right' }}>Paid</th>
                  <th style={{ textAlign:'right' }}>Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.bills?.length === 0 ? (
                  <tr><td colSpan={5} className="empty-row">No challans found</td></tr>
                ) : data.bills?.map((b:any) => (
                  <tr key={b.id}>
                    <td style={{ fontFamily:'IBM Plex Mono', fontSize:11 }}>{b.billing_month || b.bill_date}</td>
                    <td style={{ textAlign:'right', fontFamily:'IBM Plex Mono' }}>{fmtN(b.total_amount)}</td>
                    <td style={{ textAlign:'right', fontFamily:'IBM Plex Mono', color:'var(--c-paid)' }}>{fmtN(b.amount_paid)}</td>
                    <td style={{ textAlign:'right', fontFamily:'IBM Plex Mono', color: b.balance_due > 0 ? 'var(--c-overdue)' : 'var(--t-faint)' }}>{fmtN(b.balance_due)}</td>
                    <td><StatusBadge status={b.status}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Payment history */}
          <div style={{ fontSize:11, fontWeight:700, color:'var(--t-faint)', letterSpacing:'0.07em', textTransform:'uppercase', fontFamily:'IBM Plex Mono', marginBottom:8 }}>
            Payment History ({data.payments?.length || 0})
          </div>
          <div style={{ border:'1px solid var(--border)', borderRadius:6, overflow:'hidden' }}>
            <table className="data-table" style={{ margin:0, fontSize:12 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Receipt</th>
                  <th>Method</th>
                  <th style={{ textAlign:'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.payments?.length === 0 ? (
                  <tr><td colSpan={4} className="empty-row">No payments recorded</td></tr>
                ) : data.payments?.map((p:any) => (
                  <tr key={p.id}>
                    <td style={{ fontFamily:'IBM Plex Mono', fontSize:11 }}>{p.payment_date}</td>
                    <td style={{ fontFamily:'IBM Plex Mono', fontSize:11, color:'var(--t-faint)' }}>{p.receipt_number}</td>
                    <td style={{ textTransform:'capitalize', fontSize:11 }}>{p.payment_method}</td>
                    <td style={{ textAlign:'right', fontFamily:'IBM Plex Mono', color:'var(--c-paid)' }}>{fmtN(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PanelShell>
  )
}

function NewChargePanel({ plots, onClose, onSaved }: { plots:any[]; onClose:()=>void; onSaved:()=>void }) {
  const [charges,  setCharges]  = useState<any[]>([])
  const [loadingCharges, setLoadingCharges] = useState(false)
  const [nbPlot,   setNbPlot]   = useState('')
  const [nbCharge, setNbCharge] = useState('')
  const [nbCustom, setNbCustom] = useState('')
  const [nbTransferBase, setNbTransferBase] = useState('')
  const [nbAmount, setNbAmount] = useState('')
  const [nbDue,    setNbDue]    = useState('')
  const [nbNotes,  setNbNotes]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    let mounted = true
    const loadCharges = async () => {
      setLoadingCharges(true)
      try {
        const rows = await ipc.invoke('db:get-onetime-charges')
        if (mounted) setCharges(Array.isArray(rows) ? rows : [])
      } catch {
        if (mounted) setCharges([])
      } finally {
        if (mounted) setLoadingCharges(false)
      }
    }
    loadCharges()
    return () => { mounted = false }
  }, [])

  const selectedCharge = charges.find((c: any) => c.charge_name === nbCharge)

  // TODO: This function is duplicated in SpecialBillsPage.tsx. Move to shared utils to avoid duplication
  const calculateBaseAmount = (charge: any, plotIdStr: string) => {
    if (!charge) return 0
    let amt = charge.base_amount || 0
    if (charge.varies_by_marla && plotIdStr) {
      const plot = plots.find((p: any) => p.id === parseInt(plotIdStr))
      if (plot && plot.marla_size && plot.marla_size.toString().includes('10')) {
        amt = amt / 2
      }
    }
    return amt
  }

  const handleSave = async () => {
    const chargeName = nbCharge === 'Others' ? nbCustom.trim() : nbCharge
    if (!nbPlot)                              { setError('Select a plot'); return }
    if (!chargeName)                          { setError('Select or enter a charge name'); return }
    if (!nbAmount || parseFloat(nbAmount)<=0) { setError('Enter a valid amount'); return }
    setSaving(true); setError('')
    try {
      await ipc.invoke('db:create-special-bill', {
        plotId: parseInt(nbPlot), chargeName,
        amount: parseFloat(nbAmount),
        notes: nbNotes || undefined, dueDate: nbDue || undefined,
      })
      onSaved()
    } catch (e:any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <PanelShell width={480}>
      <div className="panel-header">
        <h3 style={{ margin:0 }}>New Special Charge</h3>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16}/></button>
      </div>
      <div className="panel-body" style={{ flex:1 }}>
        <div className="form-group">
          <label>Plot</label>
          <select value={nbPlot} onChange={e => {
            const newPlotId = e.target.value
            setNbPlot(newPlotId)
            if (selectedCharge && !selectedCharge.is_percentage && selectedCharge.charge_name !== 'Others') {
              setNbAmount(String(calculateBaseAmount(selectedCharge, newPlotId)))
            }
          }}>
            <option value="">Select a plot…</option>
            {plots.map((p:any) => <option key={p.id} value={p.id}>{p.plot_number}{p.owner_name ? ` — ${p.owner_name}` : ''}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Charge Type</label>
          <select value={nbCharge} onChange={e => {
            const value = e.target.value
            setNbCharge(value)
            setError('')
            const ch = charges.find((c: any) => c.charge_name === value)
            if (!ch) {
              setNbAmount('')
              return
            }
            if (ch.charge_name === 'Others') {
              setNbAmount('')
              return
            }
            if (ch.is_percentage) {
              const base = parseFloat(nbTransferBase) || 0
              setNbAmount(base > 0 ? String(Math.round(base * ((ch.percentage_value || 0) / 100))) : '')
              return
            }
            setNbAmount(String(calculateBaseAmount(ch, nbPlot)))
          }}>
            <option value="">Select charge type…</option>
            {charges.map((c: any) => (
              <option key={c.id} value={c.charge_name}>{c.charge_name}</option>
            ))}
          </select>
          {loadingCharges && <small style={{ color:'var(--t-faint)' }}>Loading charges…</small>}
        </div>
        {selectedCharge?.is_percentage && (
          <div className="form-group">
            <label>Transfer/Deed Base Amount</label>
            <input
              type="number"
              min="0"
              value={nbTransferBase}
              onChange={e => {
                const baseStr = e.target.value
                setNbTransferBase(baseStr)
                const base = parseFloat(baseStr) || 0
                const pct = Number(selectedCharge?.percentage_value || 0)
                setNbAmount(base > 0 ? String(Math.round(base * (pct / 100))) : '')
              }}
              placeholder="Enter higher of Sale Deed / DC / FBR"
            />
          </div>
        )}
        {nbCharge === 'Others' && (
          <div className="form-group">
            <label>Custom Charge Name</label>
            <input type="text" value={nbCustom} onChange={e => setNbCustom(e.target.value)} placeholder="e.g. Park Booking" />
          </div>
        )}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
          <div className="form-group">
            <label>Amount (Rs.)</label>
            <input type="number" value={nbAmount} onChange={e => setNbAmount(e.target.value)} placeholder="0" min="0" />
          </div>
          <div className="form-group">
            <label>Due Date <small style={{ color:'var(--t-faint)' }}>(optional)</small></label>
            <input type="date" value={nbDue} onChange={e => setNbDue(e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>Notes <small style={{ color:'var(--t-faint)' }}>(optional)</small></label>
          <input type="text" value={nbNotes} onChange={e => setNbNotes(e.target.value)} placeholder="Additional notes" />
        </div>
        {error && <div className="msg msg-error" style={{ marginBottom:'1rem' }}>{error}</div>}
        <div style={{ display:'flex', gap:'0.75rem' }}>
          <button className="btn btn-primary" style={{ flex:1 }} onClick={handleSave} disabled={saving}>
            {saving ? <><RefreshCw size={15} className="spin"/> Saving…</> : <><Plus size={15}/> Create Charge</>}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </PanelShell>
  )
}

// ════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════
export default function BillingPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialTab = (() => {
    const t = searchParams.get('tab')
    return (t === 'generate' || t === 'monthly' || t === 'tenant' || t === 'special')
      ? t
      : 'monthly'
  })() as MainTab
  const [tab, setTab] = useState<MainTab>(initialTab)

  const [genMonth,       setGenMonth]       = useState(currentMonth())
  const [genNotice,      setGenNotice]      = useState('')
  const [isGenerating,   setIsGenerating]   = useState(false)
  const [genMsg,         setGenMsg]         = useState<{text:string;ok:boolean}|null>(null)
  const [isApplyingFee,  setIsApplyingFee]  = useState(false)
  const [feeMsg,         setFeeMsg]         = useState<{text:string;ok:boolean}|null>(null)
  const [printMsg,       setPrintMsg]       = useState<{text:string;ok:boolean}|null>(null)
  const [fixing,         setFixing]         = useState(false)
  const [fixMsg,         setFixMsg]         = useState<{text:string;ok:boolean}|null>(null)
  const [remarksDialog,  setRemarksDialog]  = useState<{open:boolean;bill:any|null}>({open:false,bill:null})
  const [remarksInput,   setRemarksInput]   = useState('')

  const [monthlyBills,   setMonthlyBills]   = useState<any[]>([])
  const [monthlyMonth,   setMonthlyMonth]   = useState(currentMonth())
  const [monthlyStatus,  setMonthlyStatus]  = useState('unpaid,partial,overdue')
  const [monthlySearch,  setMonthlySearch]  = useState('')
  const [allMonths,      setAllMonths]      = useState(false)
  const [monthlyLoading, setMonthlyLoading] = useState(false)

  const [tenantBills,    setTenantBills]    = useState<any[]>([])
  const [tenantMonth,    setTenantMonth]    = useState(currentMonth())
  const [tenantStatus,   setTenantStatus]   = useState('unpaid,partial,overdue')
  const [tenantSearch,   setTenantSearch]   = useState('')
  const [tenantAllMonths,setTenantAllMonths]= useState(false)
  const [tenantLoading,  setTenantLoading]  = useState(false)
  const [tenantGenMsg,   setTenantGenMsg]   = useState<{text:string;ok:boolean}|null>(null)
  const [isGenForTenant, setIsGenForTenant] = useState(false)

  const [specialBills,   setSpecialBills]   = useState<any[]>([])
  const [specialSearch,  setSpecialSearch]  = useState('')
  const [specialStatus,  setSpecialStatus]  = useState('all')
  const [specialLoading, setSpecialLoading] = useState(false)
  const [expandedId,     setExpandedId]     = useState<number|null>(null)
  const [billDetails,    setBillDetails]    = useState<Record<number,any>>({})
  const [showNewBill,    setShowNewBill]    = useState(false)
  const [plots,          setPlots]          = useState<any[]>([])

  const [payingBill,     setPayingBill]     = useState<any>(null)
  const [payDetail,      setPayDetail]      = useState<any>(null)

  // Tenant statement
  const [statementBill,  setStatementBill]  = useState<any>(null)


  const loadMonthly = useCallback(async () => {
    if (!ipc) return; setMonthlyLoading(true)
    try {
      const r = await ipc.invoke('db:get-bills', {
        billType:'monthly', billingMonth: allMonths ? undefined : monthlyMonth,
        allMonths, status: monthlyStatus !== 'all' ? monthlyStatus : undefined,
      })
      setMonthlyBills(r || [])
    } finally { setMonthlyLoading(false) }
  }, [monthlyMonth, monthlyStatus, allMonths])

  const loadTenant = useCallback(async () => {
    if (!ipc) return; setTenantLoading(true)
    try {
      const r = await ipc.invoke('db:get-bills', {
        billType:'tenant', billingMonth: tenantAllMonths ? undefined : tenantMonth,
        allMonths: tenantAllMonths, status: tenantStatus !== 'all' ? tenantStatus : undefined,
      })
      setTenantBills(r || [])
    } finally { setTenantLoading(false) }
  }, [tenantMonth, tenantStatus, tenantAllMonths])

  const loadSpecial = useCallback(async () => {
    if (!ipc) return; setSpecialLoading(true)
    try {
      const r = await ipc.invoke('db:get-all-bills', {
        billType:'special', status: specialStatus !== 'all' ? specialStatus : undefined,
      })
      setSpecialBills(r || [])
    } finally { setSpecialLoading(false) }
  }, [specialStatus])

  const loadPlots = useCallback(async () => {
    if (!ipc) return
    setPlots((await ipc.invoke('db:get-plots')) || [])
  }, [])

  useEffect(() => { if (tab === 'monthly') loadMonthly() }, [tab, loadMonthly])
  useEffect(() => { if (tab === 'tenant')  loadTenant()  }, [tab, loadTenant])
  useEffect(() => { if (tab === 'special') { loadSpecial(); loadPlots() } }, [tab, loadSpecial, loadPlots])

  const handleGenerate = async () => {
    setIsGenerating(true); setGenMsg(null)
    try {
      const r = await ipc.invoke('db:generate-monthly-bills', {
        billingMonth: genMonth,
        notice: genNotice.trim() || null,
      })
      setGenMsg({ text:`✓ Generated ${r.generated} bill(s) for ${genMonth}`, ok:true })
    } catch (e:any) { setGenMsg({ text:e.message, ok:false }) }
    finally { setIsGenerating(false) }
  }

  const handleLateFees = async () => {
    setIsApplyingFee(true); setFeeMsg(null)
    try {
      const r = await ipc.invoke('db:apply-late-fees')
      setFeeMsg({ text:`✓ Late fee applied to ${r.applied} bill(s)`, ok:true })
    } catch (e:any) { setFeeMsg({ text:e.message, ok:false }) }
    finally { setIsApplyingFee(false) }
  }

  const openPayment = async (bill: any) => {
    setPayingBill(bill)
    setPayDetail(await ipc.invoke('db:get-bill-detail', bill.id))
  }
  const handlePrint = (bill: any) => {
    setRemarksDialog({ open: true, bill })
    setRemarksInput('')
  }

  const handleConfirmPrint = async () => {
    if (!remarksDialog.bill) return
    setRemarksDialog({ open: false, bill: null })
    setPrintMsg(null)
    try {
      await ipc.invoke('db:print-challan', {
        billId: remarksDialog.bill.id,
        remarks: remarksInput.trim() || null,
      })
      setPrintMsg({ text: '✓ Opening print dialog...', ok: true })
    } catch (e: any) {
      setPrintMsg({ text: `Failed to print: ${e.message}`, ok: false })
    }
  }

  const handleCancelPrint = () => {
    setRemarksDialog({ open: false, bill: null })
    setRemarksInput('')
  }
  const closePayment = () => { setPayingBill(null); setPayDetail(null) }
  const onPaymentSuccess = () => {
    if (tab === 'monthly') loadMonthly()
    if (tab === 'tenant')  loadTenant()
    if (tab === 'special') loadSpecial()
  }

  const toggleExpand = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!billDetails[id]) {
      const d = await ipc.invoke('db:get-bill-detail', id)
      setBillDetails(prev => ({ ...prev, [id]: d }))
    }
  }

  const filterBills = (bills: any[], q: string) => {
    if (!q.trim()) return bills
    const s = q.toLowerCase()
    return bills.filter(b =>
      b.plot_number?.toLowerCase().includes(s) ||
      b.owner_name?.toLowerCase().includes(s)  ||
      b.tenant_name?.toLowerCase().includes(s) ||
      b.bill_number?.toLowerCase().includes(s) ||
      b.charge_name?.toLowerCase().includes(s)
    )
  }

  const TABS = [
    { id:'monthly'  as MainTab, label:'Monthly Bills',   icon:<FileText size={14}/> },
    { id:'tenant'   as MainTab, label:'Tenant Bills',    icon:<Users    size={14}/> },
    { id:'special'  as MainTab, label:'Special Charges', icon:<Star     size={14}/> },
    { id:'generate' as MainTab, label:'Generate',        icon:<Zap      size={14}/> },
  ]

  return (
    <div className="page billing-page">
      <div className="page-header" style={{ marginBottom:'2.25rem' }}>
        <div>
          <h1>Billing</h1>
          <p className="subtitle">Generate bills, collect payments, and manage special charges</p>
        </div>
        <div>
          <button onClick={async () => {
            await ipc.invoke('db:diagnose-bills')
          }} style={{ padding:'0.5rem 1rem', background:'var(--accent)', color:'#fff', border:'none', borderRadius:'var(--r-md)', cursor:'pointer', fontSize:'0.85rem' }}>
            Diagnose
          </button>
        </div>
      </div>

      <div style={{ display:'flex', gap:4, background:'var(--bg-page)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:4, marginBottom:'2.25rem', width:'fit-content' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ display:'flex', alignItems:'center', gap:'0.4rem', padding:'0.42rem 1.1rem', borderRadius:'calc(var(--r-lg) - 3px)', fontSize:'0.84rem', fontWeight:500, border:'none', cursor:'pointer', transition:'all 0.15s',
              background: tab === t.id ? 'var(--bg-card)' : 'transparent',
              color:       tab === t.id ? 'var(--accent)'  : 'var(--t-faint)',
              boxShadow:   tab === t.id ? 'var(--shadow-sm)' : 'none' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'generate' && (
        <div style={{ maxWidth:620, display:'flex', flexDirection:'column', gap:'1.25rem' }}>
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:'1.5rem', boxShadow:'var(--shadow-card)' }}>
            <h3 style={{ marginBottom:'0.25rem' }}>Generate Monthly Bills</h3>
            <p style={{ color:'var(--t-faint)', fontSize:'0.85rem', marginBottom:'1.25rem', lineHeight:1.5 }}>
              Creates owner contribution bills and tenant challans for all active plots. Already-generated bills are skipped automatically.
            </p>
            <div style={{ display:'flex', gap:'0.75rem', alignItems:'flex-end' }}>
              <div className="form-group" style={{ flex:1, marginBottom:0 }}>
                <label>Billing Month</label>
                <input type="month" value={genMonth} onChange={e => setGenMonth(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? <><RefreshCw size={15} className="spin"/> Generating…</> : <><Zap size={15}/> Generate Bills</>}
              </button>
            </div>
            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label>
                Notice / Remarks
                <small style={{ color:'var(--t-faint)', fontWeight:400 }}> (printed on all generated bills)</small>
              </label>
              <textarea
                value={genNotice}
                onChange={e => setGenNotice(e.target.value)}
                rows={2}
                placeholder="e.g. Please clear all dues by the 10th to avoid late fee."
                style={{ resize: 'vertical' }}
              />
            </div>
            {genMsg && <div className={`msg ${genMsg.ok ? 'msg-success' : 'msg-error'}`} style={{ marginTop:'1rem' }}>{genMsg.text}</div>}
          </div>
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:'1.5rem', boxShadow:'var(--shadow-card)' }}>
            <h3 style={{ marginBottom:'0.25rem' }}>Apply Late Fees</h3>
            <p style={{ color:'var(--t-faint)', fontSize:'0.85rem', marginBottom:'1.25rem', lineHeight:1.5 }}>
              Applies a one-time late fee to all overdue unpaid bills. Configure the amount in <strong>Settings → Billing</strong>.
            </p>
            <button className="btn btn-ghost" style={{ borderColor:'var(--c-partial)', color:'var(--c-partial)' }} onClick={handleLateFees} disabled={isApplyingFee}>
              {isApplyingFee ? <><RefreshCw size={15} className="spin"/> Applying…</> : <><AlertCircle size={15}/> Apply Late Fees</>}
            </button>
            {feeMsg && <div className={`msg ${feeMsg.ok ? 'msg-success' : 'msg-error'}`} style={{ marginTop:'1rem' }}>{feeMsg.text}</div>}
          </div>
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:'1.5rem', boxShadow:'var(--shadow-card)' }}>
            <h3 style={{ marginBottom:'0.25rem' }}>Fix Bill Items</h3>
            <p style={{ color:'var(--t-faint)', fontSize:'0.85rem', marginBottom:'1.25rem', lineHeight:1.5 }}>
              Redistributes old lump-sum arrears rows into per-charge lines. Run once, then this card can be removed.
            </p>
            <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap' }}>
              <button className="btn btn-ghost"
                style={{ borderColor:'var(--accent)', color:'var(--accent)' }}
                onClick={async () => {
                  setFixing(true); setFixMsg(null)
                  try {
                    const r = await ipc.invoke('db:fix-arrears-bill-items')
                    setFixMsg({ text: `✓ Fixed ${r.fixed} of ${r.total} bills${r.errors.length ? ` · ${r.errors.length} errors` : ''}`, ok: r.errors.length === 0 })
                  } catch (e: any) { setFixMsg({ text: e.message, ok: false }) }
                  finally { setFixing(false) }
                }}
                disabled={fixing}>
                {fixing
                  ? <><RefreshCw size={15} className="spin"/> Fixing…</>
                  : <>⚙ Redistribute Arrears</>}
              </button>
              <button className="btn btn-ghost"
                style={{ borderColor: 'var(--c-overdue)', color: 'var(--c-overdue)' }}
                onClick={async () => {
                  const r = await ipc.invoke('db:restore-all-bill-items')
                  alert(`Restored ${r.fixed} bills`)
                }}>
                ⚙ Restore Bill Items
              </button>
            </div>
            {fixMsg && (
              <div className={`msg ${fixMsg.ok ? 'msg-success' : 'msg-error'}`}
                style={{ marginTop:'1rem' }}>
                {fixMsg.text}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'monthly' && (
        <>
          <KpiStrip bills={monthlyBills} />
          <FilterBar search={monthlySearch} onSearch={setMonthlySearch} month={monthlyMonth} onMonth={setMonthlyMonth}
            status={monthlyStatus} onStatus={setMonthlyStatus} allMonths={allMonths} onAllMonths={() => setAllMonths(v => !v)} />
          <BillsTable bills={filterBills(monthlyBills, monthlySearch)} loading={monthlyLoading} mode="monthly"
            onCollect={openPayment}
            onStatement={bill => setStatementBill(bill)}
            onPrint={handlePrint} />
          {printMsg && <div className={`msg ${printMsg.ok ? 'msg-success' : 'msg-error'}`} style={{ marginTop:'1rem' }}>{printMsg.text}</div>}
        </>
      )}

      {/* Print Remarks Dialog */}
      {remarksDialog.open && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
            padding: '1.5rem', width: '90%', maxWidth: '400px', boxShadow: 'var(--shadow-card)'
          }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Print Remarks (Optional)</h3>
            <p style={{ color: 'var(--t-faint)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Add any notes or remarks to be printed on this challan. Leave blank to use saved remarks.
            </p>
            <textarea
              value={remarksInput}
              onChange={(e) => setRemarksInput(e.target.value)}
              placeholder="Enter remarks..."
              style={{
                width: '100%', padding: '0.75rem', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', fontFamily: 'inherit', fontSize: '0.9rem',
                minHeight: '100px', background: 'var(--bg-input)', color: 'var(--t-primary)',
                boxSizing: 'border-box', marginBottom: '1rem'
              }}
            />
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={handleCancelPrint}
                style={{ color: 'var(--t-faint)', borderColor: 'var(--border)' }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleConfirmPrint}>
                <FileText size={15}/> Print Challan
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'tenant' && (
        <>
          <KpiStrip bills={tenantBills} />

          {/* ── Guidance + inline generate ── */}
          <div style={{ display:'flex', alignItems:'center', gap:'0.85rem', flexWrap:'wrap',
            background:'rgba(59,130,246,0.06)', border:'1px solid rgba(59,130,246,0.18)',
            borderRadius:8, padding:'0.8rem 1rem', marginBottom:'1.25rem' }}>
            <Users size={13} style={{ flexShrink:0, color:'var(--accent)' }} />
            <span style={{ fontSize:'0.83rem', color:'var(--t-faint)', flex:1 }}>
              Tenant challans are auto-generated with <strong style={{ color:'var(--t-primary)' }}>Generate Bills</strong>.
              Make sure tenants are registered first.
            </span>
            <button className="btn btn-ghost btn-sm"
              style={{ fontSize:'0.79rem', color:'var(--accent)', borderColor:'var(--accent-border)' }}
              onClick={() => navigate('/tenants')}>
              <Users size={13}/> Manage Tenants
            </button>
            <button className="btn btn-primary btn-sm"
              disabled={isGenForTenant}
              onClick={async () => {
                const monthToGen = tenantMonth || currentMonth()
                setIsGenForTenant(true); setTenantGenMsg(null)
                try {
                  const r = await ipc.invoke('db:generate-monthly-bills', {
                    billingMonth: monthToGen,
                    notice: null,
                  })
                  setTenantGenMsg({ text:`✓ Generated ${r.generated} bill(s) for ${monthToGen}`, ok:true })
                  // Directly reload — avoid stale closure by calling IPC with known params
                  setTenantLoading(true)
                  const fresh = await ipc.invoke('db:get-bills', { billType: 'tenant', allMonths: true })
                  setTenantBills(fresh || [])
                  setTenantAllMonths(true)
                  setTenantStatus('all')
                  setTenantLoading(false)
                } catch (e:any) { setTenantGenMsg({ text:e.message, ok:false }) }
                finally { setIsGenForTenant(false) }
              }}>
              <Zap size={13}/> {isGenForTenant ? 'Generating…' : `Generate for ${tenantMonth || currentMonth()}`}
            </button>
          </div>
          {tenantGenMsg && (
            <div className={`msg ${tenantGenMsg.ok ? 'msg-success' : 'msg-error'}`} style={{ marginBottom:'0.75rem' }}>
              {tenantGenMsg.text}
            </div>
          )}

          <FilterBar search={tenantSearch} onSearch={setTenantSearch} month={tenantMonth} onMonth={setTenantMonth}
            status={tenantStatus} onStatus={setTenantStatus} allMonths={tenantAllMonths} onAllMonths={() => setTenantAllMonths(v => !v)} />
          <BillsTable bills={filterBills(tenantBills, tenantSearch)} loading={tenantLoading} mode="tenant"
            onCollect={openPayment}
            onStatement={bill => setStatementBill(bill)}
            onPrint={handlePrint} />
        </>
      )}

      {tab === 'special' && (
        <>
          <KpiStrip bills={specialBills} />
          <div style={{ display:'flex', gap:'0.85rem', alignItems:'center', flexWrap:'wrap', marginBottom:'1.5rem' }}>
            <div style={{ position:'relative', flex:'0 1 220px', minWidth:150 }}>
              <Search size={13} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--t-faint)', pointerEvents:'none' }} />
              <input value={specialSearch} onChange={e => setSpecialSearch(e.target.value)} placeholder="Search plot, charge…" style={{ paddingLeft:30, width:'100%', boxSizing:'border-box' }} />
            </div>
            <div style={{ display:'flex', gap:2, background:'var(--bg-page)', border:'1px solid var(--border)', borderRadius:'var(--r-md)', padding:2 }}>
              {[{v:'all',l:'All'},{v:'unpaid',l:'Unpaid'},{v:'paid',l:'Paid'}].map(s => (
                <button key={s.v} onClick={() => setSpecialStatus(s.v)}
                  style={{ padding:'0.3rem 0.7rem', borderRadius:'calc(var(--r-md) - 2px)', fontSize:'0.8rem', fontWeight:500, border:'none', cursor:'pointer', transition:'all 0.15s',
                    background: specialStatus === s.v ? 'var(--accent)' : 'transparent',
                    color:       specialStatus === s.v ? '#fff' : 'var(--t-faint)' }}>
                  {s.l}
                </button>
              ))}
            </div>
            <button className="btn btn-primary" onClick={() => setShowNewBill(true)}>
              <Plus size={15}/> New Charge
            </button>
          </div>
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', overflow:'hidden', boxShadow:'var(--shadow-card)' }}>
            <table className="data-table" style={{ margin:0 }}>
              <thead>
                <tr>
                  <th style={{ width:32 }}></th>
                  <th>Date</th><th>Plot</th><th>Owner</th><th>Charge</th>
                  <th style={{ textAlign:'right' }}>Amount</th>
                  <th style={{ textAlign:'right' }}>Paid</th>
                  <th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {specialLoading ? (
                  <tr><td colSpan={9} className="empty-row">Loading…</td></tr>
                ) : filterBills(specialBills, specialSearch).length === 0 ? (
                  <tr><td colSpan={9} className="empty-row">No special charges found</td></tr>
                ) : filterBills(specialBills, specialSearch).map(b => (
                  <>
                    <tr key={b.id} onClick={() => toggleExpand(b.id)} style={{ cursor:'pointer' }}>
                      <td style={{ color:'var(--t-faint)' }}>
                        {expandedId === b.id ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                      </td>
                      <td style={{ fontSize:'0.83rem' }}>{b.bill_date}</td>
                      <td><strong>{b.plot_number}</strong></td>
                      <td style={{ color:'var(--t-muted)', fontSize:'0.875rem' }}>{b.owner_name||'—'}</td>
                      <td>{b.charge_name||'—'}</td>
                      <td style={{ textAlign:'right', fontFamily:'IBM Plex Mono' }}>{fmt(b.total_amount)}</td>
                      <td style={{ textAlign:'right', fontFamily:'IBM Plex Mono', color:'var(--c-paid)' }}>{fmt(b.amount_paid)}</td>
                      <td><StatusBadge status={b.status}/></td>
                      <td onClick={e => e.stopPropagation()}>
                        {b.status !== 'paid' && (
                          <button className="btn btn-primary btn-sm" onClick={() => openPayment(b)}>
                            <CreditCard size={13}/> Collect
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedId === b.id && (
                      <tr key={`${b.id}-detail`}>
                        <td colSpan={9} style={{ background:'var(--bg-page)', padding:'0.75rem 1.25rem 1rem 3.5rem', borderBottom:'1px solid var(--border)' }}>
                          {!billDetails[b.id] ? (
                            <span style={{ color:'var(--t-faint)', fontSize:'0.85rem' }}>Loading…</span>
                          ) : (
                            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2rem' }}>
                              <div>
                                <div style={{ fontSize:'0.72rem', fontWeight:600, color:'var(--t-faint)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'0.5rem' }}>Charge Lines</div>
                                {billDetails[b.id].items?.map((it:any, i:number) => (
                                  <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.875rem', padding:'0.2rem 0', borderBottom:'1px solid var(--border)' }}>
                                    <span>{it.charge_name}</span>
                                    <span style={{ fontFamily:'IBM Plex Mono' }}>{fmt(it.amount)}</span>
                                  </div>
                                ))}
                              </div>
                              <div>
                                <div style={{ fontSize:'0.72rem', fontWeight:600, color:'var(--t-faint)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'0.5rem' }}>Payment History</div>
                                {billDetails[b.id].payments?.length === 0 ? (
                                  <div style={{ fontSize:'0.875rem', color:'var(--t-faint)' }}>No payments recorded</div>
                                ) : billDetails[b.id].payments?.map((p:any) => (
                                  <div key={p.id} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.875rem', padding:'0.2rem 0', borderBottom:'1px solid var(--border)' }}>
                                    <span style={{ color:'var(--t-faint)' }}>{p.payment_date} · <span style={{ fontFamily:'IBM Plex Mono', fontSize:'0.78rem' }}>{p.receipt_number}</span></span>
                                    <span style={{ fontFamily:'IBM Plex Mono', color:'var(--c-paid)' }}>{fmt(p.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {payingBill && (
        <ModalOverlay onClose={closePayment}>
          <PaymentPanel bill={payingBill} detail={payDetail} onClose={closePayment} onSuccess={onPaymentSuccess} />
        </ModalOverlay>
      )}

      {showNewBill && (
        <ModalOverlay onClose={() => setShowNewBill(false)}>
          <NewChargePanel plots={plots} onClose={() => setShowNewBill(false)}
            onSaved={() => { setShowNewBill(false); loadSpecial() }} />
        </ModalOverlay>
      )}

      {statementBill && (
        <ModalOverlay onClose={() => setStatementBill(null)}>
          <TenantStatementPanel
            tenantId={statementBill.tenant_id}
            tenantName={statementBill.tenant_name || 'Tenant'}
            onClose={() => setStatementBill(null)} />
        </ModalOverlay>
      )}

    </div>
  )
}