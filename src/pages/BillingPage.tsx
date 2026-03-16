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
    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1rem', marginBottom:'1.25rem' }}>
      {[
        { label:'TOTAL BILLED',  val: fmt(billed),      sub:`${bills.length} bills` },
        { label:'COLLECTED',     val: fmt(collected),   clr:'var(--c-paid)' },
        { label:'OUTSTANDING',   val: fmt(outstanding), clr: outstanding > 0 ? 'var(--c-overdue)' : undefined },
        { label:'UNPAID',        val: String(unpaid),   sub:'bills pending', clr: unpaid > 0 ? 'var(--c-partial)' : undefined },
      ].map((k: any) => (
        <div key={k.label} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:'1rem 1.25rem', boxShadow:'var(--shadow-card)' }}>
          <div style={{ fontSize:'0.7rem', fontWeight:600, color:'var(--t-faint)', letterSpacing:'0.07em', marginBottom:'0.4rem' }}>{k.label}</div>
          <div style={{ fontSize:'1.15rem', fontWeight:700, fontFamily:'IBM Plex Mono', color:k.clr }}>{k.val}</div>
          {k.sub && <div style={{ fontSize:'0.78rem', color:'var(--t-faint)', marginTop:'0.2rem' }}>{k.sub}</div>}
        </div>
      ))}
    </div>
  )
}

function FilterBar({ search, onSearch, month, onMonth, status, onStatus, allMonths, onAllMonths }: any) {
  return (
    <div style={{ display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap', marginBottom:'1rem' }}>
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
            <th>{mode === 'tenant' ? 'Tenant' : 'Owner / Tenant'}</th>
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

  useEffect(() => {
    setAmount(String(bill?.balance_due || ''))
    setMethod('cash'); setReceipt(''); setNotes(''); setError(''); setPosted('')
    setCredit(0)
    if (bill?.plot_id && ipc) {
      ipc.invoke('db:get-plot-credit', bill.plot_id).then((r: any) => setCredit(r?.balance || 0))
    }
  }, [bill?.id])

  const handlePay = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0)              { setError('Enter a valid amount'); return }
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

  return (
    <PanelShell width={440}>
      <div className="panel-header">
        <h3 style={{ margin:0 }}>{posted ? 'Payment Posted' : 'Collect Payment'}</h3>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16}/></button>
      </div>
      {posted ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'3rem 2rem', textAlign:'center' }}>
          <CheckCircle size={48} color="var(--c-paid)" style={{ marginBottom:'1rem' }}/>
          <h3 style={{ marginBottom:'0.5rem' }}>Payment Recorded</h3>
          <div style={{ color:'var(--t-faint)', fontSize:'0.875rem', marginBottom:'1.5rem' }}>
            Receipt: <strong style={{ fontFamily:'IBM Plex Mono', color:'var(--t-primary)' }}>{posted}</strong>
          </div>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      ) : (
        <div className="panel-body" style={{ flex:1 }}>
          <div style={{ background:'var(--bg-page)', border:'1px solid var(--border)', borderRadius:8, padding:'1rem', marginBottom:'1.25rem' }}>
            <div style={{ fontSize:'0.78rem', color:'var(--t-faint)', marginBottom:'0.5rem' }}>
              {bill.bill_number} · Plot {bill.plot_number}
              {bill.tenant_name && <span> · {bill.tenant_name}</span>}
              {bill.owner_name && !bill.tenant_name && <span> · {bill.owner_name}</span>}
            </div>
            {detail?.items?.length > 0 && (
              <div style={{ borderBottom:'1px solid var(--border)', paddingBottom:'0.6rem', marginBottom:'0.6rem' }}>
                {detail.items.map((it:any, i:number) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.83rem', padding:'0.1rem 0' }}>
                    <span style={{ color:'var(--t-muted)' }}>{it.charge_name}</span>
                    <span style={{ fontFamily:'IBM Plex Mono' }}>{fmt(it.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.83rem', marginBottom:'0.2rem' }}>
              <span style={{ color:'var(--t-muted)' }}>Total Billed</span>
              <span style={{ fontFamily:'IBM Plex Mono' }}>{fmt(bill.total_amount)}</span>
            </div>
            {bill.amount_paid > 0 && (
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.83rem', marginBottom:'0.2rem' }}>
                <span style={{ color:'var(--t-muted)' }}>Already Paid</span>
                <span style={{ fontFamily:'IBM Plex Mono', color:'var(--c-paid)' }}>−{fmt(bill.amount_paid)}</span>
              </div>
            )}
            {credit > 0 && (
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.83rem', marginBottom:'0.2rem' }}>
                <span style={{ color:'var(--t-muted)' }}>Advance Credit</span>
                <span style={{ fontFamily:'IBM Plex Mono', color:'var(--accent)' }}>+{fmt(credit)} available</span>
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, borderTop:'1px solid var(--border)', paddingTop:'0.5rem', marginTop:'0.3rem' }}>
              <span>Balance Due</span>
              <span style={{ fontFamily:'IBM Plex Mono', color:'var(--c-overdue)' }}>{fmt(bill.balance_due)}</span>
            </div>
            <div style={{ fontSize:'0.78rem', color:'var(--t-faint)', marginTop:'0.3rem', fontStyle:'italic' }}>
              {credit > 0
                ? 'Any amount above balance due will be added to advance credit.'
                : 'To save advance credit, enter more than the balance due.'}
            </div>
          </div>
          <div className="form-group">
            <label>Amount (Rs.)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" min="0"
              style={{ fontSize:'1.1rem', fontWeight:600, fontFamily:'IBM Plex Mono' }} autoFocus />
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
              <input type="text" value={receipt} onChange={e => setReceipt(e.target.value)} placeholder="Auto-generated" />
            </div>
            <div className="form-group">
              <label>Notes <small style={{ color:'var(--t-faint)' }}>(optional)</small></label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. cheque no." />
            </div>
          </div>
          {error && <div className="msg msg-error" style={{ marginBottom:'1rem' }}>{error}</div>}
          <div style={{ display:'flex', gap:'0.75rem' }}>
            <button className="btn btn-primary" style={{ flex:1 }} onClick={handlePay} disabled={loading}>
              {loading ? <><RefreshCw size={15} className="spin"/> Posting…</> : <><CreditCard size={15}/> Post Payment</>}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() =>
              ipc.invoke('db:print-challan', { billId: bill.id, amount: parseFloat(amount) || null })
            }>🖨 Print Challan</button>
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

// ── New Special Charge panel ──────────────────────────────────
const PRESET_CHARGES = [
  'Mosque Fund','Aquifer Fund','Sewerage Fund','Generator Fund',
  'Maintenance Fund','Road Repair','Boundary Wall','Security Deposit',
  'Transfer Fee','Registration Fee','Water Connection','Demarcation Fee','Other (custom)',
]

function NewChargePanel({ plots, onClose, onSaved }: { plots:any[]; onClose:()=>void; onSaved:()=>void }) {
  const [nbPlot,   setNbPlot]   = useState('')
  const [nbCharge, setNbCharge] = useState('')
  const [nbCustom, setNbCustom] = useState('')
  const [nbAmount, setNbAmount] = useState('')
  const [nbDue,    setNbDue]    = useState('')
  const [nbNotes,  setNbNotes]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const handleSave = async () => {
    const chargeName = nbCharge === 'Other (custom)' ? nbCustom.trim() : nbCharge
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
          <select value={nbPlot} onChange={e => setNbPlot(e.target.value)}>
            <option value="">Select a plot…</option>
            {plots.map((p:any) => <option key={p.id} value={p.id}>{p.plot_number}{p.owner_name ? ` — ${p.owner_name}` : ''}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Charge Type</label>
          <select value={nbCharge} onChange={e => setNbCharge(e.target.value)}>
            <option value="">Select charge type…</option>
            {PRESET_CHARGES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {nbCharge === 'Other (custom)' && (
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
  const [tab, setTab] = useState<MainTab>((searchParams.get('tab') as MainTab) || 'monthly')

  const [genMonth,       setGenMonth]       = useState(currentMonth())
  const [isGenerating,   setIsGenerating]   = useState(false)
  const [genMsg,         setGenMsg]         = useState<{text:string;ok:boolean}|null>(null)
  const [isApplyingFee,  setIsApplyingFee]  = useState(false)
  const [feeMsg,         setFeeMsg]         = useState<{text:string;ok:boolean}|null>(null)

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
        billingMonth: allMonths ? undefined : monthlyMonth,
        allMonths, status: monthlyStatus !== 'all' ? monthlyStatus : undefined,
        // no billType → fetches both 'monthly' and 'tenant' bills; special bills excluded below
      })
      setMonthlyBills((r || []).filter((b: any) => b.bill_type !== 'special'))
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
      const r = await ipc.invoke('db:generate-monthly-bills', { billingMonth: genMonth })
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
    ipc.invoke('db:print-challan', { billId: bill.id })
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
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Billing</h1>
          <p className="page-subtitle">Generate bills, collect payments, and manage special charges</p>
        </div>
        <div />
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg-page)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:3, marginBottom:'1.5rem', width:'fit-content' }}>
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
        </div>
      )}

      {tab === 'monthly' && (
        <>
          <KpiStrip bills={monthlyBills} />
          <FilterBar search={monthlySearch} onSearch={setMonthlySearch} month={monthlyMonth} onMonth={setMonthlyMonth}
            status={monthlyStatus} onStatus={setMonthlyStatus} allMonths={allMonths} onAllMonths={() => setAllMonths(v => !v)} />
          <BillsTable bills={filterBills(monthlyBills, monthlySearch)} loading={monthlyLoading} mode="combined"
            onCollect={openPayment}
            onStatement={bill => setStatementBill(bill)}
            onPrint={handlePrint} />
        </>
      )}

      {tab === 'tenant' && (
        <>
          <KpiStrip bills={tenantBills} />

          {/* ── Guidance + inline generate ── */}
          <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap',
            background:'rgba(59,130,246,0.06)', border:'1px solid rgba(59,130,246,0.18)',
            borderRadius:8, padding:'0.65rem 1rem', marginBottom:'1rem' }}>
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
                  const r = await ipc.invoke('db:generate-monthly-bills', { billingMonth: monthToGen })
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
          <div style={{ display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap', marginBottom:'1rem' }}>
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