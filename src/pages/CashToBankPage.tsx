import { useState, useEffect, useCallback } from 'react'
import { Landmark, RefreshCw, Printer, Plus, X, Building2, FileDown } from 'lucide-react'
import { exportExcelFile } from '../utils/exportExcel'

const ipc = (window as any).ipcRenderer

interface Bank {
  id: number
  bank_name: string
  account_number: string | null
  branch_name: string | null
  branch_code: string | null
  iban: string | null
  account_id: number
  account_code: string
  is_default: number
  is_active: number
}

interface AddBankResult {
  success: boolean
  bankId: number
}

interface TransferHistoryRow {
  id: number
  entry_date: string
  description: string
  transfer_type: 'cash_to_bank' | 'bank_to_cash' | 'transfer'
  amount: number
  bank_name: string
}

export default function CashToBankPage() {
  const now = new Date()
  const [activeTab, setActiveTab] = useState<'ctb' | 'btc'>('ctb')
  const [cashBalance, setCashBalance] = useState(0)
  const [bankBalance, setBankBalance] = useState(0)
  
  // Banks list from DB
  const [banks, setBanks] = useState<Bank[]>([])
  const [loadingBanks, setLoadingBanks] = useState(true)
  
  // Add Bank Modal
  const [showAddBank, setShowAddBank] = useState(false)
  const [newBankName, setNewBankName] = useState('')
  const [newAccountNumber, setNewAccountNumber] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [newIban, setNewIban] = useState('')
  const [addingBank, setAddingBank] = useState(false)
  const [addBankMsg, setAddBankMsg] = useState<{ text: string; ok: boolean } | null>(null)
  
  // Cash to Bank form
  const [ctbDate, setCtbDate] = useState(now.toISOString().split('T')[0])
  const [ctbAmount, setCtbAmount] = useState('')
  const [ctbBankId, setCtbBankId] = useState<number | null>(null)
  const [ctbNotes, setCtbNotes] = useState('')
  const [ctbSaving, setCtbSaving] = useState(false)
  const [ctbMsg, setCtbMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // Bank to Cash form
  const [btcDate, setBtcDate] = useState(now.toISOString().split('T')[0])
  const [btcAmount, setBtcAmount] = useState('')
  const [btcBankId, setBtcBankId] = useState<number | null>(null)
  const [btcMode, setBtcMode] = useState<'cheque' | 'online'>('cheque')
  const [btcChequeNo, setBtcChequeNo] = useState('')
  const [btcPurpose, setBtcPurpose] = useState('')
  const [btcNotes, setBtcNotes] = useState('')
  const [btcSaving, setBtcSaving] = useState(false)
  const [btcMsg, setBtcMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // Transfer history (date range)
  const [historyFrom, setHistoryFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0])
  const [historyTo, setHistoryTo] = useState(now.toISOString().split('T')[0])
  const [historyRows, setHistoryRows] = useState<TransferHistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const loadBanks = useCallback(async (preferredBankId?: number) => {
    if (!ipc) return
    setLoadingBanks(true)
    try {
      const data = await ipc.invoke('db:get-banks')
      setBanks(data || [])
      if (preferredBankId && data?.some((b: Bank) => b.id === preferredBankId)) {
        setCtbBankId(preferredBankId)
        setBtcBankId(preferredBankId)
        return
      }
      // Set default bank if not already set
      const defaultBank = data?.find((b: Bank) => b.is_default)
      if (defaultBank) {
        if (!ctbBankId) setCtbBankId(defaultBank.id)
        if (!btcBankId) setBtcBankId(defaultBank.id)
      } else if (data?.length > 0) {
        if (!ctbBankId) setCtbBankId(data[0].id)
        if (!btcBankId) setBtcBankId(data[0].id)
      }
    } catch (e) {
      console.error('Failed to load banks:', e)
    } finally {
      setLoadingBanks(false)
    }
  }, [])

  const loadBalances = useCallback(async () => {
    if (!ipc) return
    const [cash, bank] = await Promise.all([
      ipc.invoke('db:get-cash-balance'),
      ipc.invoke('db:get-bank-balance'),
    ])
    setCashBalance(cash || 0)
    setBankBalance(bank || 0)
  }, [])

  const loadTransferHistory = useCallback(async () => {
    if (!ipc) return
    if (historyFrom && historyTo && historyFrom > historyTo) {
      setHistoryRows([])
      setHistoryError('From date cannot be after To date')
      return
    }
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      try {
        const rows = await ipc.invoke('db:get-cash-bank-transfers', {
          startDate: historyFrom,
          endDate: historyTo,
        })
        setHistoryRows(rows || [])
      } catch (innerErr: any) {
        const msg = String(innerErr?.message || innerErr || '')
        if (!msg.includes("No handler registered for 'db:get-cash-bank-transfers'")) {
          throw innerErr
        }

        // Backward-compat fallback for running main process that has not loaded the new IPC yet.
        const cashbookRows = await ipc.invoke('db:get-cashbook', {
          startDate: historyFrom,
          endDate: historyTo,
        })

        const mapped: TransferHistoryRow[] = (cashbookRows || [])
          .filter((r: any) => (
            (Number(r.cash_out) > 0 && Number(r.bank_in) > 0)
            || (Number(r.cash_in) > 0 && Number(r.bank_out) > 0)
          ))
          .map((r: any) => ({
            id: Number(r.id),
            entry_date: r.entry_date || '',
            description: r.description || '',
            transfer_type: Number(r.cash_out) > 0 && Number(r.bank_in) > 0 ? 'cash_to_bank' : 'bank_to_cash',
            amount: Number(r.cash_out) > 0 && Number(r.bank_in) > 0 ? Number(r.bank_in || 0) : Number(r.cash_in || 0),
            bank_name: '',
          }))

        setHistoryRows(mapped)
      }
    } catch (e: any) {
      setHistoryError(e?.message || 'Failed to load transfer history')
    } finally {
      setHistoryLoading(false)
    }
  }, [historyFrom, historyTo])

  useEffect(() => { 
    loadBalances()
    loadBanks()
    loadTransferHistory()
  }, [loadBalances, loadBanks, loadTransferHistory])

  const handleAddBank = async () => {
    if (!newBankName.trim()) {
      setAddBankMsg({ text: 'Bank name is required', ok: false })
      return
    }
    setAddingBank(true)
    setAddBankMsg(null)
    try {
      const result = await ipc.invoke('db:add-bank', {
        bankName: newBankName.trim(),
        accountNumber: newAccountNumber.trim() || undefined,
        branchName: newBranchName.trim() || undefined,
        iban: newIban.trim() || undefined,
      }) as AddBankResult
      setAddBankMsg({ text: 'Bank added successfully!', ok: true })
      setNewBankName('')
      setNewAccountNumber('')
      setNewBranchName('')
      setNewIban('')
      await loadBanks(result?.bankId)
      setTimeout(() => setShowAddBank(false), 1000)
    } catch (e: any) {
      setAddBankMsg({ text: e.message, ok: false })
    } finally {
      setAddingBank(false)
    }
  }

  const handleCashToBank = async () => {
    const amount = parseFloat(ctbAmount)
    if (!amount || amount <= 0) { setCtbMsg({ text: 'Enter a valid amount', ok: false }); return }
    if (!ctbBankId) { setCtbMsg({ text: 'Please select a bank', ok: false }); return }
    setCtbSaving(true); setCtbMsg(null)
    try {
      await ipc.invoke('db:cash-to-bank', { 
        date: ctbDate, 
        amount, 
        notes: ctbNotes || undefined,
        bankId: ctbBankId
      })
      const bankName = banks.find(b => b.id === ctbBankId)?.bank_name || 'bank'
      setCtbMsg({ text: `Rs. ${amount.toLocaleString()} transferred to ${bankName}`, ok: true })
      setCtbAmount(''); setCtbNotes('')
      loadBalances()
      loadTransferHistory()
    } catch (e: any) { setCtbMsg({ text: e.message, ok: false }) }
    finally { setCtbSaving(false) }
  }

  const handleBankToCash = async () => {
    const amount = parseFloat(btcAmount)
    if (!amount || amount <= 0) { setBtcMsg({ text: 'Enter a valid amount', ok: false }); return }
    if (!btcBankId) { setBtcMsg({ text: 'Please select a bank', ok: false }); return }
    if (!btcPurpose.trim()) { setBtcMsg({ text: 'Purpose is required', ok: false }); return }
    if (btcMode === 'cheque' && !btcChequeNo.trim()) {
      setBtcMsg({ text: 'Cheque number is required for cheque cashing', ok: false }); return
    }

    setBtcSaving(true); setBtcMsg(null)
    try {
      await ipc.invoke('db:bank-to-cash', {
        date: btcDate,
        amount,
        purpose: btcPurpose.trim(),
        transferMode: btcMode,
        chequeNo: btcMode === 'cheque' ? btcChequeNo.trim() : null,
        notes: btcNotes.trim() || undefined,
        bankId: btcBankId
      })
      const bankName = banks.find(b => b.id === btcBankId)?.bank_name || 'bank'
      setBtcMsg({ text: `Rs. ${amount.toLocaleString()} transferred from ${bankName} to cash`, ok: true })
      setBtcAmount('')
      setBtcChequeNo('')
      setBtcPurpose('')
      setBtcNotes('')
      loadBalances()
      loadTransferHistory()
    } catch (e: any) { setBtcMsg({ text: e.message, ok: false }) }
    finally { setBtcSaving(false) }
  }

  const printTransferSlip = (date: string, amount: number, notes: string) => {
    if (ipc) ipc.invoke('db:print-cash-transfer', { date, amount, notes: notes || undefined })
  }

  const printBankToCashSlip = (date: string, amount: number, purpose: string, transferMode: 'cheque' | 'online', chequeNo: string, notes: string) => {
    if (ipc) {
      ipc.invoke('db:print-bank-to-cash-transfer', {
        date,
        amount,
        purpose,
        transferMode,
        chequeNo: transferMode === 'cheque' ? chequeNo || undefined : undefined,
        notes: notes || undefined,
      })
    }
  }

  const exportTransferHistoryExcel = async () => {
    if (!historyRows.length) return

    const totalCashToBank = historyRows
      .filter(r => r.transfer_type === 'cash_to_bank')
      .reduce((s, r) => s + Number(r.amount || 0), 0)
    const totalBankToCash = historyRows
      .filter(r => r.transfer_type === 'bank_to_cash')
      .reduce((s, r) => s + Number(r.amount || 0), 0)
    const grandTotal = historyRows.reduce((s, r) => s + Number(r.amount || 0), 0)

    const rows: (string | number)[][] = historyRows.map((row, index) => ([
      index + 1,
      row.entry_date || '',
      row.transfer_type === 'cash_to_bank' ? 'Cash to Bank' : row.transfer_type === 'bank_to_cash' ? 'Bank to Cash' : 'Transfer',
      row.bank_name || '',
      row.description || '',
      Number(row.amount) || 0,
    ]))

    rows.push([])
    rows.push(['', '', '', '', 'Total Cash to Bank', totalCashToBank])
    rows.push(['', '', '', '', 'Total Bank to Cash', totalBankToCash])
    rows.push(['', '', '', '', 'Grand Total', grandTotal])

    await exportExcelFile({
      fileName: `cash-bank-transfer-history-${historyFrom}-to-${historyTo}`,
      sheetName: 'Cash-Bank Transfers',
      title: 'River View Cooperative Housing Society Ltd.',
      subtitle: `Cash/Bank Transfer History - ${historyFrom} to ${historyTo}`,
      meta: [`Generated: ${new Date().toLocaleDateString('en-PK')} | Entries: ${historyRows.length}`],
      headers: ['Sr', 'Date', 'Type', 'Bank', 'Description', 'Amount (Rs.)'],
      rows,
      numericColumns: [1, 6],
    })
  }

  return (
    <div className="page" style={{ padding: '32px 28px', overflowY: 'auto', fontSize: 14, lineHeight: 1.6 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t-primary)', letterSpacing: '-0.01em' }}>
          Cash to Bank Transfer
        </div>
        <div style={{ fontSize: 13, color: 'var(--t-faint)', marginTop: 4 }}>
          Transfer cash in hand to bank account and print transfer slips.
        </div>
      </div>

      <div style={{ maxWidth: 860 }}>
        <div style={{ display: 'inline-flex', gap: 6, marginBottom: 12, padding: 4, background: '#f3f4f6', borderRadius: 999 }}>
          <button
            className={activeTab === 'ctb' ? 'btn btn-primary' : 'btn btn-ghost'}
            style={{ height: 32, fontSize: 12.5, borderRadius: 999, boxShadow: activeTab === 'ctb' ? '0 1px 2px rgba(0,0,0,0.12)' : 'none' }}
            onClick={() => setActiveTab('ctb')}
          >
            Cash to Bank
          </button>
          <button
            className={activeTab === 'btc' ? 'btn btn-primary' : 'btn btn-ghost'}
            style={{ height: 32, fontSize: 12.5, borderRadius: 999, boxShadow: activeTab === 'btc' ? '0 1px 2px rgba(0,0,0,0.12)' : 'none' }}
            onClick={() => setActiveTab('btc')}
          >
            Bank to Cash
          </button>
        </div>

        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--r-lg, 8px)', overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 6, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Landmark size={17} style={{ color: '#1d4ed8' }} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-primary)' }}>
                {activeTab === 'ctb' ? 'Cash to Bank Transfer' : 'Bank to Cash Transfer'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--t-faint)' }}>
                {activeTab === 'ctb'
                  ? 'Transfer cash in hand to bank account'
                  : 'Transfer bank amount to cash with cheque/online details'}
              </div>
            </div>
          </div>

          {/* Balances */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <div style={{ background: '#fff', padding: '20px', borderRight: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-faint)', letterSpacing: '0.06em', fontFamily: 'IBM Plex Mono', marginBottom: 4 }}>CASH IN HAND</div>
              <div style={{ fontSize: 23, fontWeight: 700, fontFamily: 'IBM Plex Mono', color: '#b45309' }}>Rs. {cashBalance.toLocaleString()}</div>
            </div>
            <div style={{ background: '#fff', padding: '20px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-faint)', letterSpacing: '0.06em', fontFamily: 'IBM Plex Mono', marginBottom: 4 }}>BANK BALANCE</div>
              <div style={{ fontSize: 23, fontWeight: 700, fontFamily: 'IBM Plex Mono', color: '#1d4ed8' }}>Rs. {bankBalance.toLocaleString()}</div>
            </div>
          </div>

          {activeTab === 'ctb' && (
            <>
              <div style={{ padding: '20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>Date</label>
                  <input type="date" value={ctbDate} onChange={e => setCtbDate(e.target.value)}
                    style={{ height: 34, fontSize: 12.5, width: 145 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>Amount (Rs.)</label>
                  <input type="number" value={ctbAmount} onChange={e => setCtbAmount(e.target.value)}
                    placeholder="0" min="0"
                    style={{ height: 34, fontSize: 12.5, fontFamily: 'IBM Plex Mono', fontWeight: 600, width: 140 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>Bank</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <select 
                      value={ctbBankId || ''} 
                      onChange={e => setCtbBankId(Number(e.target.value))}
                      style={{ height: 34, fontSize: 12.5, width: 200 }}
                      disabled={loadingBanks}
                    >
                      {loadingBanks ? (
                        <option>Loading...</option>
                      ) : banks.length === 0 ? (
                        <option value="">No banks - Add one</option>
                      ) : (
                        banks.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.bank_name}{b.is_default ? ' ★' : ''}
                          </option>
                        ))
                      )}
                    </select>
                    <button 
                      className="btn btn-ghost" 
                      style={{ height: 34, width: 34, padding: 0 }}
                      onClick={() => setShowAddBank(true)}
                      title="Add new bank"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 150 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>Notes <span style={{ fontWeight: 400 }}>(optional)</span></label>
                  <input type="text" value={ctbNotes} onChange={e => setCtbNotes(e.target.value)}
                    placeholder="e.g. March collections deposit"
                    style={{ height: 34, fontSize: 12.5 }} />
                </div>
                <button className="btn btn-primary" onClick={handleCashToBank} disabled={ctbSaving}
                  style={{ height: 38, fontSize: 13, whiteSpace: 'nowrap', marginLeft: 'auto', padding: '0 24px' }}>
                  {ctbSaving ? 'Saving...' : 'Transfer'}
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
            </>
          )}

          {activeTab === 'btc' && (
            <>
              <div style={{ padding: '20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>Date</label>
                  <input type="date" value={btcDate} onChange={e => setBtcDate(e.target.value)}
                    style={{ height: 34, fontSize: 12.5, width: 145 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>Amount (Rs.)</label>
                  <input type="number" value={btcAmount} onChange={e => setBtcAmount(e.target.value)}
                    placeholder="0" min="0"
                    style={{ height: 34, fontSize: 12.5, fontFamily: 'IBM Plex Mono', fontWeight: 600, width: 140 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>Bank</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <select 
                      value={btcBankId || ''} 
                      onChange={e => setBtcBankId(Number(e.target.value))}
                      style={{ height: 34, fontSize: 12.5, width: 200 }}
                      disabled={loadingBanks}
                    >
                      {loadingBanks ? (
                        <option>Loading...</option>
                      ) : banks.length === 0 ? (
                        <option value="">No banks - Add one</option>
                      ) : (
                        banks.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.bank_name}{b.is_default ? ' ★' : ''}
                          </option>
                        ))
                      )}
                    </select>
                    <button 
                      className="btn btn-ghost" 
                      style={{ height: 34, width: 34, padding: 0 }}
                      onClick={() => setShowAddBank(true)}
                      title="Add new bank"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>Transfer Mode</label>
                  <select value={btcMode} onChange={e => setBtcMode(e.target.value as 'cheque' | 'online')}
                    style={{ height: 34, fontSize: 12.5, width: 150 }}>
                    <option value="cheque">Cheque Cashed</option>
                    <option value="online">Online Transaction</option>
                  </select>
                </div>
                {btcMode === 'cheque' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>Cheque No.</label>
                    <input type="text" value={btcChequeNo} onChange={e => setBtcChequeNo(e.target.value)}
                      placeholder="Enter cheque number"
                      style={{ height: 34, fontSize: 12.5, width: 160 }} />
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 170 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>Purpose</label>
                  <input type="text" value={btcPurpose} onChange={e => setBtcPurpose(e.target.value)}
                    placeholder="e.g. petty cash for office expenses"
                    style={{ height: 34, fontSize: 12.5 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 150 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>Notes <span style={{ fontWeight: 400 }}>(optional)</span></label>
                  <input type="text" value={btcNotes} onChange={e => setBtcNotes(e.target.value)}
                    placeholder="Additional detail"
                    style={{ height: 34, fontSize: 12.5 }} />
                </div>

                <button className="btn btn-primary" onClick={handleBankToCash} disabled={btcSaving}
                  style={{ height: 38, fontSize: 13, whiteSpace: 'nowrap', marginLeft: 'auto', padding: '0 24px' }}>
                  {btcSaving ? 'Saving...' : 'Transfer'}
                </button>
                {btcAmount && parseFloat(btcAmount) > 0 && btcPurpose.trim() && (btcMode === 'online' || btcChequeNo.trim()) && (
                  <button className="btn btn-ghost" style={{ height: 34, fontSize: 12.5, whiteSpace: 'nowrap' }}
                    onClick={() => printBankToCashSlip(btcDate, parseFloat(btcAmount), btcPurpose.trim(), btcMode, btcChequeNo.trim(), btcNotes)}>
                    <Printer size={14} /> Print Slip
                  </button>
                )}
              </div>

              {btcMsg && (
                <div style={{
                  padding: '8px 20px', fontSize: 12.5,
                  background: btcMsg.ok ? '#f0fdf4' : '#fef2f2',
                  color: btcMsg.ok ? '#15803d' : '#b91c1c',
                  borderTop: '1px solid var(--border)',
                }}>
                  {btcMsg.text}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ marginTop: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--r-lg, 8px)', overflow: 'hidden' }}>
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t-primary)' }}>Transfer History</div>
              <div style={{ fontSize: 11.5, color: 'var(--t-faint)' }}>Cash to bank and bank to cash transactions</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>From</label>
                <input type="date" value={historyFrom} onChange={e => setHistoryFrom(e.target.value)} style={{ height: 32, fontSize: 12 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>To</label>
                <input type="date" value={historyTo} onChange={e => setHistoryTo(e.target.value)} style={{ height: 32, fontSize: 12 }} />
              </div>
              <button className="btn btn-ghost" style={{ height: 32, fontSize: 12.5 }} onClick={loadTransferHistory}>
                <RefreshCw size={13} /> Refresh
              </button>
              <button className="btn btn-ghost" style={{ height: 32, fontSize: 12.5 }} onClick={exportTransferHistoryExcel} disabled={historyLoading || historyRows.length === 0}>
                <FileDown size={13} /> Export Excel
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto', borderTop: '1px solid var(--border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, lineHeight: 1.6, border: '1px solid var(--border)' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ textAlign: 'left', padding: '10px 20px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', fontSize: 11, color: '#9ca3af', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '10px 20px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', fontSize: 11, color: '#9ca3af', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Type</th>
                  <th style={{ textAlign: 'left', padding: '10px 20px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', fontSize: 11, color: '#9ca3af', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Bank</th>
                  <th style={{ textAlign: 'left', padding: '10px 20px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', fontSize: 11, color: '#9ca3af', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '10px 20px', borderBottom: '1px solid var(--border)', fontSize: 11, color: '#9ca3af', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Amount (Rs.)</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading && (
                  <tr>
                    <td colSpan={5} style={{ padding: '12px', color: 'var(--t-faint)' }}>Loading transfer history...</td>
                  </tr>
                )}
                {!historyLoading && historyError && (
                  <tr>
                    <td colSpan={5} style={{ padding: '12px', color: '#b91c1c' }}>{historyError}</td>
                  </tr>
                )}
                {!historyLoading && !historyError && historyRows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '12px', color: 'var(--t-faint)' }}>No transactions found for selected dates</td>
                  </tr>
                )}
                {!historyLoading && !historyError && historyRows.map((row, index) => (
                  <tr key={row.id} style={{ background: index % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                    <td style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', borderRight: '1px solid var(--border)', fontFamily: 'IBM Plex Mono' }}>{row.entry_date}</td>
                    <td style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        color: row.transfer_type === 'cash_to_bank' ? '#1d4ed8' : '#b45309',
                        background: row.transfer_type === 'cash_to_bank' ? '#eff6ff' : '#fffbeb',
                        border: `1px solid ${row.transfer_type === 'cash_to_bank' ? '#bfdbfe' : '#fde68a'}`,
                      }}>
                        {row.transfer_type === 'cash_to_bank' ? 'Cash to Bank' : row.transfer_type === 'bank_to_cash' ? 'Bank to Cash' : 'Transfer'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>{row.bank_name || '-'}</td>
                    <td style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', borderRight: '1px solid var(--border)', maxWidth: 340, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.description || ''}>
                      {row.description || '-'}
                    </td>
                    <td style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
                      {Number(row.amount || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Add Bank Modal */}
      {showAddBank && (
        <div 
          style={{ 
            position: 'fixed', 
            inset: 0, 
            zIndex: 1000, 
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowAddBank(false) }}
        >
          <div style={{ 
            background: '#fff', 
            borderRadius: 12, 
            width: 420, 
            maxWidth: '90vw',
            boxShadow: '0 20px 50px rgba(0,0,0,0.15)'
          }}>
            <div style={{ 
              padding: '16px 20px', 
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ 
                  width: 32, height: 32, borderRadius: 6, 
                  background: '#dbeafe', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center' 
                }}>
                  <Building2 size={17} style={{ color: '#1d4ed8' }} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-primary)' }}>Add New Bank</div>
                  <div style={{ fontSize: 11, color: 'var(--t-faint)' }}>This will create a new account in the ledger</div>
                </div>
              </div>
              <button 
                className="btn btn-ghost" 
                style={{ width: 28, height: 28, padding: 0 }}
                onClick={() => setShowAddBank(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-faint)' }}>Bank Name *</label>
                <input 
                  type="text" 
                  value={newBankName} 
                  onChange={e => setNewBankName(e.target.value)}
                  placeholder="e.g. Habib Bank Ltd (HBL)"
                  style={{ height: 36, fontSize: 13 }}
                  autoFocus
                />
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-faint)' }}>Account Number <span style={{ fontWeight: 400 }}>(optional)</span></label>
                <input 
                  type="text" 
                  value={newAccountNumber} 
                  onChange={e => setNewAccountNumber(e.target.value)}
                  placeholder="e.g. 1234567890"
                  style={{ height: 36, fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-faint)' }}>Branch Name <span style={{ fontWeight: 400 }}>(optional)</span></label>
                  <input 
                    type="text" 
                    value={newBranchName} 
                    onChange={e => setNewBranchName(e.target.value)}
                    placeholder="e.g. Main Branch"
                    style={{ height: 36, fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-faint)' }}>IBAN <span style={{ fontWeight: 400 }}>(optional)</span></label>
                <input 
                  type="text" 
                  value={newIban} 
                  onChange={e => setNewIban(e.target.value)}
                  placeholder="e.g. PK36HABB0000111122223333"
                  style={{ height: 36, fontSize: 13 }}
                />
              </div>

              {addBankMsg && (
                <div style={{
                  padding: '8px 12px', 
                  fontSize: 12,
                  borderRadius: 6,
                  background: addBankMsg.ok ? '#f0fdf4' : '#fef2f2',
                  color: addBankMsg.ok ? '#15803d' : '#b91c1c',
                }}>
                  {addBankMsg.text}
                </div>
              )}
            </div>

            <div style={{ 
              padding: '12px 20px', 
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8
            }}>
              <button 
                className="btn btn-ghost" 
                style={{ height: 34, fontSize: 12.5 }}
                onClick={() => setShowAddBank(false)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary" 
                style={{ height: 34, fontSize: 12.5 }}
                onClick={handleAddBank}
                disabled={addingBank || !newBankName.trim()}
              >
                {addingBank ? <><RefreshCw size={14} className="spin" /> Adding...</> : <><Plus size={14} /> Add Bank</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
