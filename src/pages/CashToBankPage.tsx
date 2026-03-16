import { useState, useEffect, useCallback } from 'react'
import { Landmark, RefreshCw, Printer } from 'lucide-react'

const ipc = (window as any).ipcRenderer

export default function CashToBankPage() {
  const now = new Date()
  const [cashBalance, setCashBalance] = useState(0)
  const [bankBalance, setBankBalance] = useState(0)
  const [ctbDate, setCtbDate] = useState(now.toISOString().split('T')[0])
  const [ctbAmount, setCtbAmount] = useState('')
  const [ctbNotes, setCtbNotes] = useState('')
  const [ctbSaving, setCtbSaving] = useState(false)
  const [ctbMsg, setCtbMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const loadBalances = useCallback(async () => {
    if (!ipc) return
    const [cash, bank] = await Promise.all([
      ipc.invoke('db:get-cash-balance'),
      ipc.invoke('db:get-bank-balance'),
    ])
    setCashBalance(cash || 0)
    setBankBalance(bank || 0)
  }, [])

  useEffect(() => { loadBalances() }, [loadBalances])

  const handleCashToBank = async () => {
    const amount = parseFloat(ctbAmount)
    if (!amount || amount <= 0) { setCtbMsg({ text: 'Enter a valid amount', ok: false }); return }
    setCtbSaving(true); setCtbMsg(null)
    try {
      await ipc.invoke('db:cash-to-bank', { date: ctbDate, amount, notes: ctbNotes || undefined })
      setCtbMsg({ text: `Rs. ${amount.toLocaleString()} transferred to bank`, ok: true })
      setCtbAmount(''); setCtbNotes('')
      loadBalances()
    } catch (e: any) { setCtbMsg({ text: e.message, ok: false }) }
    finally { setCtbSaving(false) }
  }

  const printTransferSlip = (date: string, amount: number, notes: string) => {
    if (ipc) ipc.invoke('db:print-cash-transfer', { date, amount, notes: notes || undefined })
  }

  return (
    <div className="page" style={{ padding: '32px 28px', overflowY: 'auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t-primary)', letterSpacing: '-0.01em' }}>
          Cash to Bank Transfer
        </div>
        <div style={{ fontSize: 13, color: 'var(--t-faint)', marginTop: 4 }}>
          Transfer cash in hand to bank account and print transfer slips.
        </div>
      </div>

      <div style={{ maxWidth: 820 }}>
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--r-lg, 8px)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 6, background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Landmark size={17} style={{ color: '#b45309' }} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-primary)' }}>Cash to Bank Transfer</div>
              <div style={{ fontSize: 11.5, color: 'var(--t-faint)' }}>Transfer cash in hand to bank account</div>
            </div>
          </div>

          {/* Balances */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)' }}>
            <div style={{ background: '#fff', padding: '12px 20px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-faint)', letterSpacing: '0.06em', fontFamily: 'IBM Plex Mono', marginBottom: 4 }}>CASH IN HAND</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'IBM Plex Mono', color: '#1d4ed8' }}>Rs. {cashBalance.toLocaleString()}</div>
            </div>
            <div style={{ background: '#fff', padding: '12px 20px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-faint)', letterSpacing: '0.06em', fontFamily: 'IBM Plex Mono', marginBottom: 4 }}>BANK BALANCE</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'IBM Plex Mono', color: '#b45309' }}>Rs. {bankBalance.toLocaleString()}</div>
            </div>
          </div>

          {/* Transfer form */}
          <div style={{ padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-faint)' }}>Date</label>
              <input type="date" value={ctbDate} onChange={e => setCtbDate(e.target.value)}
                style={{ height: 34, fontSize: 12.5, width: 145 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-faint)' }}>Amount (Rs.)</label>
              <input type="number" value={ctbAmount} onChange={e => setCtbAmount(e.target.value)}
                placeholder="0" min="0"
                style={{ height: 34, fontSize: 12.5, fontFamily: 'IBM Plex Mono', fontWeight: 600, width: 140 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 150 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-faint)' }}>Notes <span style={{ fontWeight: 400 }}>(optional)</span></label>
              <input type="text" value={ctbNotes} onChange={e => setCtbNotes(e.target.value)}
                placeholder="e.g. March collections deposit"
                style={{ height: 34, fontSize: 12.5 }} />
            </div>
            <button className="btn btn-primary" onClick={handleCashToBank} disabled={ctbSaving}
              style={{ height: 34, fontSize: 12.5, whiteSpace: 'nowrap' }}>
              {ctbSaving ? <><RefreshCw size={14} className="spin" /> Saving…</> : <><Landmark size={14} /> Transfer</>}
            </button>
            {ctbAmount && parseFloat(ctbAmount) > 0 && (
              <button className="btn btn-ghost" style={{ height: 34, fontSize: 12.5, whiteSpace: 'nowrap' }}
                onClick={() => printTransferSlip(ctbDate, parseFloat(ctbAmount), ctbNotes)}>
                <Printer size={14} /> Print Slip
              </button>
            )}
          </div>
          {ctbMsg && (
            <div style={{
              padding: '8px 20px', fontSize: 12.5,
              background: ctbMsg.ok ? '#f0fdf4' : '#fef2f2',
              color: ctbMsg.ok ? '#15803d' : '#b91c1c',
              borderTop: '1px solid var(--border)',
            }}>
              {ctbMsg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
