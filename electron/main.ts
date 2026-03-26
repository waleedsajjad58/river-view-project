import path from 'node:path'
import { initDatabase, getDb } from './database'

// Avoid destructuring — Rollup's __toESM wrapper can break it
const electron = require('electron')
const app = electron.app
const BrowserWindow = electron.BrowserWindow
const ipcMain = electron.ipcMain

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: any

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0f172a',
    icon: path.join(process.env.VITE_PUBLIC!, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => {
    win?.show()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// ── IPC Handlers ──────────────────────────────────────────────
// These are the secure bridges between the renderer (React UI) and the database.
// The renderer calls these via window.electronAPI.xxx()

// Plots
ipcMain.handle('db:get-plots', () => {
  const db = getDb()
  return db.prepare('SELECT * FROM plots WHERE is_deleted = 0 ORDER BY plot_number').all()
})

ipcMain.handle('db:get-plot', (_e: any, id: number) => {
  const db = getDb()
  return db.prepare('SELECT * FROM plots WHERE id = ? AND is_deleted = 0').get(id)
})

ipcMain.handle('db:add-plot', (_e: any, plot: any) => {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO plots (plot_number, block, marla_size, plot_type, commercial_floors, has_water_connection, has_sewerage_connection, upper_floors_residential, notes)
    VALUES (@plot_number, @block, @marla_size, @plot_type, @commercial_floors, @has_water_connection, @has_sewerage_connection, @upper_floors_residential, @notes)
  `)
  return stmt.run(plot)
})

ipcMain.handle('db:update-plot', (_e: any, plot: any) => {
  const db = getDb()
  const stmt = db.prepare(`
    UPDATE plots SET plot_number=@plot_number, block=@block, marla_size=@marla_size, plot_type=@plot_type,
    commercial_floors=@commercial_floors, has_water_connection=@has_water_connection,
    has_sewerage_connection=@has_sewerage_connection, upper_floors_residential=@upper_floors_residential,
    notes=@notes, updated_at=CURRENT_TIMESTAMP WHERE id=@id
  `)
  return stmt.run(plot)
})

// Members
ipcMain.handle('db:get-members', () => {
  const db = getDb()
  return db.prepare('SELECT * FROM members WHERE is_deleted = 0 ORDER BY name').all()
})

ipcMain.handle('db:add-member', (_e: any, member: any) => {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO members (name, cnic, phone, address, is_member, membership_date, share_count, notes)
    VALUES (@name, @cnic, @phone, @address, @is_member, @membership_date, @share_count, @notes)
  `)
  return stmt.run(member)
})

// Settings
ipcMain.handle('db:get-settings', () => {
  const db = getDb()
  return db.prepare('SELECT * FROM settings').all()
})

ipcMain.handle('db:get-setting', (_e: any, key: string) => {
  const db = getDb()
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
})

// Bill Templates
ipcMain.handle('db:get-bill-templates', () => {
  const db = getDb()
  return db.prepare('SELECT * FROM bill_templates WHERE is_active = 1 ORDER BY plot_type, sort_order').all()
})

// ── Phase 2: Plot Operations ──────────────────────────────────
ipcMain.handle('db:delete-plot', (_e: any, id: number) => {
  const db = getDb()
  return db.prepare('UPDATE plots SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)
})

ipcMain.handle('db:change-plot-type', (_e: any, { id, newType, changedBy, notes }: any) => {
  const db = getDb()
  const plot = db.prepare('SELECT plot_type FROM plots WHERE id = ?').get(id) as any
  if (!plot) throw new Error('Plot not found')
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO plot_type_history (plot_id, old_type, new_type, changed_at, changed_by, notes) VALUES (?, ?, ?, date('now'), ?, ?)").run(id, plot.plot_type, newType, changedBy || null, notes || null)
    db.prepare('UPDATE plots SET plot_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newType, id)
  })
  return tx()
})

// ── Phase 2: Member Operations ────────────────────────────────
ipcMain.handle('db:get-member', (_e: any, id: number) => {
  const db = getDb()
  return db.prepare('SELECT * FROM members WHERE id = ? AND is_deleted = 0').get(id)
})

ipcMain.handle('db:update-member', (_e: any, member: any) => {
  const db = getDb()
  return db.prepare(`UPDATE members SET name=@name, cnic=@cnic, phone=@phone, address=@address, is_member=@is_member,
    membership_date=@membership_date, share_count=@share_count, notes=@notes WHERE id=@id`).run(member)
})

ipcMain.handle('db:delete-member', (_e: any, id: number) => {
  const db = getDb()
  return db.prepare('UPDATE members SET is_deleted = 1 WHERE id = ?').run(id)
})

ipcMain.handle('db:get-member-plots', (_e: any, memberId: number) => {
  const db = getDb()
  return db.prepare(`SELECT p.* FROM plots p JOIN plot_ownership po ON p.id = po.plot_id
    WHERE po.member_id = ? AND po.end_date IS NULL AND p.is_deleted = 0`).all(memberId)
})

// ── Phase 2: Ownership ───────────────────────────────────────
ipcMain.handle('db:get-plot-owner', (_e: any, plotId: number) => {
  const db = getDb()
  return db.prepare(`SELECT m.* FROM members m JOIN plot_ownership po ON m.id = po.member_id
    WHERE po.plot_id = ? AND po.end_date IS NULL AND m.is_deleted = 0`).get(plotId)
})

ipcMain.handle('db:assign-owner', (_e: any, { plotId, memberId, startDate }: any) => {
  const db = getDb()
  return db.prepare('INSERT INTO plot_ownership (plot_id, member_id, start_date) VALUES (?, ?, ?)').run(plotId, memberId, startDate || new Date().toISOString().split('T')[0])
})

ipcMain.handle('db:transfer-ownership', (_e: any, { plotId, newMemberId, transferDate, deedAmount, notes }: any) => {
  const db = getDb()
  const date = transferDate || new Date().toISOString().split('T')[0]
  const tx = db.transaction(() => {
    db.prepare('UPDATE plot_ownership SET end_date = ? WHERE plot_id = ? AND end_date IS NULL').run(date, plotId)
    db.prepare('INSERT INTO plot_ownership (plot_id, member_id, start_date, transfer_deed_amount, notes) VALUES (?, ?, ?, ?, ?)').run(plotId, newMemberId, date, deedAmount || null, notes || null)
  })
  return tx()
})

ipcMain.handle('db:get-ownership-history', (_e: any, plotId: number) => {
  const db = getDb()
  return db.prepare(`SELECT po.*, m.name as owner_name FROM plot_ownership po
    JOIN members m ON po.member_id = m.id WHERE po.plot_id = ? ORDER BY po.start_date DESC`).all(plotId)
})

// ── Phase 2: Tenants ─────────────────────────────────────────
ipcMain.handle('db:get-tenants', (_e: any, plotId?: number) => {
  const db = getDb()
  if (plotId) return db.prepare('SELECT * FROM tenants WHERE plot_id = ? AND is_deleted = 0').all(plotId)
  return db.prepare('SELECT t.*, p.plot_number FROM tenants t JOIN plots p ON t.plot_id = p.id WHERE t.is_deleted = 0').all()
})

ipcMain.handle('db:add-tenant', (_e: any, tenant: any) => {
  const db = getDb()
  return db.prepare(`INSERT INTO tenants (name, cnic, phone, plot_id, start_date, end_date, monthly_rent, notes)
    VALUES (@name, @cnic, @phone, @plot_id, @start_date, @end_date, @monthly_rent, @notes)`).run(tenant)
})

ipcMain.handle('db:update-tenant', (_e: any, tenant: any) => {
  const db = getDb()
  return db.prepare(`UPDATE tenants SET name=@name, cnic=@cnic, phone=@phone, start_date=@start_date,
    end_date=@end_date, monthly_rent=@monthly_rent, notes=@notes WHERE id=@id`).run(tenant)
})

ipcMain.handle('db:remove-tenant', (_e: any, id: number) => {
  const db = getDb()
  return db.prepare('UPDATE tenants SET is_deleted = 1 WHERE id = ?').run(id)
})

// ── Phase 3: Bill Generation ─────────────────────────────────
ipcMain.handle('db:generate-monthly-bills', (_e: any, { billingMonth }: any) => {
  const db = getDb()
  const plots = db.prepare('SELECT * FROM plots WHERE is_deleted = 0').all() as any[]
  const templates = db.prepare('SELECT * FROM bill_templates WHERE is_active = 1 ORDER BY sort_order').all() as any[]
  const settings = db.prepare('SELECT key, value FROM settings').all() as any[]
  const settingsMap: Record<string, string> = {}
  for (const s of settings) settingsMap[s.key] = s.value

  const prefix = settingsMap['bill_number_prefix'] || 'RV-'
  const dueDays = parseInt(settingsMap['default_due_days'] || '15')
  let generated = 0

  const tx = db.transaction(() => {
    for (const plot of plots) {
      // Skip if bill already exists for this month
      const existing = db.prepare('SELECT id FROM bills WHERE plot_id = ? AND billing_month = ? AND is_deleted = 0').get(plot.id, billingMonth) as any
      if (existing) continue

      // Get owner
      const owner = db.prepare('SELECT member_id FROM plot_ownership WHERE plot_id = ? AND end_date IS NULL').get(plot.id) as any

      // Get matching templates
      const plotTemplates = templates.filter((t: any) => t.plot_type === plot.plot_type)
      const items: { charge_name: string; amount: number }[] = []

      for (const t of plotTemplates) {
        if (t.is_conditional && t.condition_field) {
          if (t.condition_field === 'commercial_floors') {
            // Per-floor charge
            const floors = plot.commercial_floors || 0
            if (floors > 0) items.push({ charge_name: t.charge_name, amount: t.amount * floors })
          } else {
            // Boolean condition (has_water_connection, upper_floors_residential, etc.)
            if (plot[t.condition_field]) items.push({ charge_name: t.charge_name, amount: t.amount })
          }
        } else {
          items.push({ charge_name: t.charge_name, amount: t.amount })
        }
      }

      // ── Owner bill (without tenant charges) ──
      if (items.length === 0) {
        // Still check for tenant below even if no owner charges
      } else {
        const subtotal = items.reduce((sum, i) => sum + i.amount, 0)
        const billDate = billingMonth + '-01'
        const dueDate = new Date(billDate)
        dueDate.setDate(dueDate.getDate() + dueDays)
        const dueDateStr = dueDate.toISOString().split('T')[0]

        const countForMonth = db.prepare('SELECT COUNT(*) as c FROM bills WHERE billing_month = ?').get(billingMonth) as any
        const seq = String((countForMonth?.c || 0) + 1).padStart(3, '0')
        const billNumber = `${prefix}${billingMonth}-${seq}`

        const result = db.prepare(`INSERT INTO bills (bill_number, plot_id, member_id, bill_type, bill_date, due_date,
          billing_month, subtotal, total_amount, balance_due, status) VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?, ?, ?, 'unpaid')`)
          .run(billNumber, plot.id, owner?.member_id || null, billDate, dueDateStr, billingMonth, subtotal, subtotal, subtotal)

        const billId = result.lastInsertRowid
        const insertItem = db.prepare('INSERT INTO bill_items (bill_id, charge_name, amount) VALUES (?, ?, ?)')
        for (const item of items) {
          insertItem.run(billId, item.charge_name, item.amount)
        }
        generated++
      }

      // ── Tenant bill (independent from owner) ──
      const tenant = db.prepare("SELECT id, name FROM tenants WHERE plot_id = ? AND is_deleted = 0 AND (end_date IS NULL OR end_date >= date('now'))").get(plot.id) as any
      if (tenant) {
        const existingTenantBill = db.prepare("SELECT id FROM bills WHERE plot_id = ? AND billing_month = ? AND bill_type = 'tenant' AND is_deleted = 0").get(plot.id, billingMonth) as any
        if (!existingTenantBill) {
          const tenantAmount = 2500
          const billDate = billingMonth + '-01'
          const dueDate = new Date(billDate)
          dueDate.setDate(dueDate.getDate() + dueDays)
          const dueDateStr = dueDate.toISOString().split('T')[0]

          const countForMonth = db.prepare('SELECT COUNT(*) as c FROM bills WHERE billing_month = ?').get(billingMonth) as any
          const seq = String((countForMonth?.c || 0) + 1).padStart(3, '0')
          const billNumber = `${prefix}${billingMonth}-${seq}-T`

          db.prepare(`INSERT INTO bills (bill_number, plot_id, tenant_id, bill_type, bill_date, due_date,
            billing_month, subtotal, total_amount, balance_due, status) VALUES (?, ?, ?, 'tenant', ?, ?, ?, ?, ?, ?, 'unpaid')`)
            .run(billNumber, plot.id, tenant.id, billDate, dueDateStr, billingMonth, tenantAmount, tenantAmount, tenantAmount)

          // Note: tenant bill has no member_id — completely independent from owner
          generated++
        }
      }
    }
  })
  tx()
  return { generated, month: billingMonth }
})

ipcMain.handle('db:get-bills', (_e: any, filters?: any) => {
  const db = getDb()
  let query = `SELECT b.*, p.plot_number, m.name as owner_name FROM bills b
    LEFT JOIN plots p ON b.plot_id = p.id LEFT JOIN members m ON b.member_id = m.id WHERE b.is_deleted = 0`
  const params: any[] = []
  if (filters?.billingMonth) { query += ' AND b.billing_month = ?'; params.push(filters.billingMonth) }
  if (filters?.status && filters.status !== 'all') { query += ' AND b.status = ?'; params.push(filters.status) }
  if (filters?.billType) { query += ' AND b.bill_type = ?'; params.push(filters.billType) }
  query += ' ORDER BY b.bill_date DESC, p.plot_number'
  return db.prepare(query).all(...params)
})

ipcMain.handle('db:get-bill-detail', (_e: any, billId: number) => {
  const db = getDb()
  const bill = db.prepare(`SELECT b.*, p.plot_number, p.marla_size, p.plot_type, m.name as owner_name, m.phone, m.address
    FROM bills b LEFT JOIN plots p ON b.plot_id = p.id LEFT JOIN members m ON b.member_id = m.id WHERE b.id = ?`).get(billId)
  const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id').all(billId)
  const payments = db.prepare('SELECT * FROM payments WHERE bill_id = ? ORDER BY payment_date DESC').all(billId)
  return { bill, items, payments }
})

ipcMain.handle('db:add-custom-bill-item', (_e: any, { billId, chargeName, amount }: any) => {
  const db = getDb()
  // Guard: block modifications on paid bills
  const bill = db.prepare('SELECT status FROM bills WHERE id = ?').get(billId) as any
  if (!bill) throw new Error('Bill not found')
  if (bill.status === 'paid') throw new Error('Cannot modify a paid bill')
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO bill_items (bill_id, charge_name, amount, is_custom) VALUES (?, ?, ?, 1)').run(billId, chargeName, amount)
    db.prepare('UPDATE bills SET subtotal = subtotal + ?, total_amount = total_amount + ?, balance_due = balance_due + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(amount, amount, amount, billId)
  })
  return tx()
})

// ── Phase 3: Payments ────────────────────────────────────────
ipcMain.handle('db:record-payment', (_e: any, { billId, amount, paymentMethod, receiptNumber, notes }: any) => {
  const db = getDb()
  const tx = db.transaction(() => {
    const bill = db.prepare(`
      SELECT b.bill_number, b.total_amount, b.amount_paid, b.balance_due, b.plot_id, p.plot_number
      FROM bills b LEFT JOIN plots p ON b.plot_id = p.id
      WHERE b.id = ?`).get(billId) as any
    if (!bill) throw new Error('Bill not found')

    const newPaid = (bill.amount_paid || 0) + amount
    const newBalance = bill.total_amount - newPaid
    let status = 'partial'
    if (newBalance <= 0) status = 'paid'
    if (newBalance === bill.total_amount) status = 'unpaid'

    const paymentResult = db.prepare("INSERT INTO payments (bill_id, payment_date, amount, payment_method, receipt_number, notes) VALUES (?, date('now'), ?, ?, ?, ?)").run(billId, amount, paymentMethod || 'cash', receiptNumber || null, notes || null)
    db.prepare('UPDATE bills SET amount_paid = ?, balance_due = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPaid, Math.max(0, newBalance), status, billId)

    // ── DOUBLE-ENTRY ACCOUNTING POSTING ──
    const today = new Date().toISOString().split('T')[0]
    const desc = `Payment received for Bill #${bill.bill_number} (Plot ${bill.plot_number})`

    // Debit Account: Cash (1000) or Bank (1001) depending on method
    const debitAccountCode = paymentMethod === 'cash' ? '1000' : '1001'
    const debitAccount = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(debitAccountCode) as any

    // Credit Account: Member Receivables (1200)
    const creditAccount = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get('1200') as any

    if (!debitAccount || !creditAccount) {
      throw new Error(`Chart of accounts not properly seeded (missing ${debitAccountCode} or 1200). Run migrations.`)
    }

    // 1. Journal Entry
    const jeResult = db.prepare(`INSERT INTO journal_entries (entry_date, description, reference_type, reference_id) VALUES (?, ?, 'payment', ?)`).run(today, desc, paymentResult.lastInsertRowid)
    const jeId = jeResult.lastInsertRowid

    // 2. Journal Lines
    db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)').run(jeId, debitAccount.id, amount)
    db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)').run(jeId, creditAccount.id, amount)

    // 3. Ledger Entries (Derived from double-entry lines)
    // Debit side (Asset increment)
    const leDebitResult = db.prepare(`INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, debit_account_id, amount, journal_entry_id) VALUES (?, ?, 'payment', ?, ?, ?, ?)`).run(today, desc, paymentResult.lastInsertRowid, debitAccount.id, amount, jeId)
    // Credit side (Asset decrement / Receivable reduction)
    db.prepare(`INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, credit_account_id, amount, journal_entry_id) VALUES (?, ?, 'payment', ?, ?, ?, ?)`).run(today, desc, paymentResult.lastInsertRowid, creditAccount.id, amount, jeId)

    // 4. Cashbook Entry (Flattened view for physical flow)
    db.prepare(`INSERT INTO cashbook_entries (entry_date, description, receipt_number, cash_in, bank_in, journal_entry_id, ledger_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      today, desc, receiptNumber || null,
      paymentMethod === 'cash' ? amount : 0,
      paymentMethod !== 'cash' ? amount : 0,
      jeId, leDebitResult.lastInsertRowid
    )
  })
  return tx()
})

ipcMain.handle('db:get-payments', (_e: any, billId: number) => {
  const db = getDb()
  return db.prepare('SELECT * FROM payments WHERE bill_id = ? ORDER BY payment_date DESC').all(billId)
})

ipcMain.handle('db:apply-late-fees', (_e: any) => {
  const db = getDb()
  const settings = db.prepare('SELECT key, value FROM settings').all() as any[]
  const settingsMap: Record<string, string> = {}
  for (const s of settings) settingsMap[s.key] = s.value

  const feeType = settingsMap['late_fee_type'] || 'flat'
  const feeValue = parseFloat(settingsMap['late_fee_value'] || '500')

  const overdue = db.prepare("SELECT * FROM bills WHERE due_date < date('now') AND status IN ('unpaid', 'partial') AND late_fee = 0 AND is_deleted = 0").all() as any[]
  let applied = 0

  const tx = db.transaction(() => {
    for (const bill of overdue) {
      const fee = feeType === 'percentage' ? bill.total_amount * (feeValue / 100) : feeValue
      db.prepare('UPDATE bills SET late_fee = ?, total_amount = total_amount + ?, balance_due = balance_due + ?, status = "overdue", updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(fee, fee, fee, bill.id)
      db.prepare('INSERT INTO bill_items (bill_id, charge_name, amount, is_custom) VALUES (?, "Late Fee", ?, 1)').run(bill.id, fee)
      applied++
    }
  })
  tx()
  return { applied }
})

// ── Special Bills ────────────────────────────────────────────
ipcMain.handle('db:get-onetime-charges', () => {
  const db = getDb()
  return db.prepare(`
    SELECT *
    FROM onetime_charges
    WHERE is_active = 1
    ORDER BY CASE charge_name
      WHEN 'Membership Charges' THEN 1
      WHEN 'Share Capital' THEN 2
      WHEN 'Transfer Contribution from buyer' THEN 3
      WHEN 'Transfer Contribution from Seller' THEN 4
      WHEN 'Possession Contribution' THEN 5
      WHEN 'Demarcation Contribution' THEN 6
      WHEN 'Water Connection Charges' THEN 7
      WHEN 'Sewerage Connection Charges' THEN 8
      WHEN 'Park Booking (Member)' THEN 9
      WHEN 'Park Booking (Non-Member)' THEN 10
      WHEN 'NOC for Sub Division (Corner Plot)' THEN 11
      WHEN 'NOC for Sub Division (Pre-2019 Constructed)' THEN 12
      WHEN 'Others' THEN 13
      ELSE 999
    END,
    charge_name
  `).all()
})

ipcMain.handle('db:create-special-bill', (_e: any, { plotId, chargeName, amount, notes, dueDate }: any) => {
  const db = getDb()
  const plot = db.prepare('SELECT * FROM plots WHERE id = ? AND is_deleted = 0').get(plotId) as any
  if (!plot) throw new Error('Plot not found')

  const owner = db.prepare('SELECT member_id FROM plot_ownership WHERE plot_id = ? AND end_date IS NULL').get(plotId) as any
  const settings = db.prepare("SELECT value FROM settings WHERE key = 'bill_number_prefix'").get() as any
  const prefix = settings?.value || 'RV-'
  const today = new Date().toISOString().split('T')[0]

  let dueDateStr = dueDate
  if (!dueDateStr) {
    const dueSettings = db.prepare("SELECT value FROM settings WHERE key = 'default_due_days'").get() as any
    const dueDays = parseInt(dueSettings?.value || '15')
    const dueDateObj = new Date()
    dueDateObj.setDate(dueDateObj.getDate() + dueDays)
    dueDateStr = dueDateObj.toISOString().split('T')[0]
  }

  const count = db.prepare('SELECT COUNT(*) as c FROM bills').get() as any
  const seq = String((count?.c || 0) + 1).padStart(3, '0')
  const billNumber = `${prefix}SP-${seq}`

  const tx = db.transaction(() => {
    const result = db.prepare(`INSERT INTO bills (bill_number, plot_id, member_id, bill_type, bill_date, due_date,
      subtotal, total_amount, balance_due, status, notes) VALUES (?, ?, ?, 'special', ?, ?, ?, ?, ?, 'unpaid', ?)`)
      .run(billNumber, plotId, owner?.member_id || null, today, dueDateStr, amount, amount, amount, notes || null)

    db.prepare('INSERT INTO bill_items (bill_id, charge_name, amount) VALUES (?, ?, ?)').run(result.lastInsertRowid, chargeName, amount)
  })
  return tx()
})

// ── All Bills (unified query) ───────────────────────────────
ipcMain.handle('db:get-all-bills', (_e: any, filters?: any) => {
  const db = getDb()
  let query = `SELECT b.*, p.plot_number, m.name as owner_name, t.name as tenant_name FROM bills b
    LEFT JOIN plots p ON b.plot_id = p.id LEFT JOIN members m ON b.member_id = m.id
    LEFT JOIN tenants t ON b.tenant_id = t.id WHERE b.is_deleted = 0`
  const params: any[] = []
  if (filters?.billType) { query += ' AND b.bill_type = ?'; params.push(filters.billType) }
  if (filters?.status) { query += ' AND b.status = ?'; params.push(filters.status) }
  if (filters?.billingMonth) { query += ' AND b.billing_month = ?'; params.push(filters.billingMonth) }
  query += ' ORDER BY b.created_at DESC, p.plot_number'
  return db.prepare(query).all(...params)
})

// ── Phase 4: Financial Accounting ─────────────────────────────
ipcMain.handle('db:get-accounts', () => {
  const db = getDb()
  return db.prepare('SELECT * FROM accounts WHERE is_active = 1 ORDER BY account_code').all()
})

ipcMain.handle('db:create-journal-entry', (_e: any, { entryDate, description, lines }: any) => {
  // Validate total debits = total credits
  const totalDebit = lines.reduce((s: number, l: any) => s + (parseFloat(l.debit) || 0), 0)
  const totalCredit = lines.reduce((s: number, l: any) => s + (parseFloat(l.credit) || 0), 0)

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Unbalanced Entry: Debits (${totalDebit}) != Credits (${totalCredit})`)
  }

  const db = getDb()
  const tx = db.transaction(() => {
    const jeResult = db.prepare(`INSERT INTO journal_entries (entry_date, description, reference_type) VALUES (?, ?, 'manual')`).run(entryDate, description)
    const jeId = jeResult.lastInsertRowid

    for (const line of lines) {
      db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?)').run(
        jeId, line.accountId, line.debit || 0, line.credit || 0
      )

      // Auto-post to ledger
      if (line.debit > 0) {
        db.prepare('INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, debit_account_id, amount, journal_entry_id) VALUES (?, ?, "manual", ?, ?, ?, ?)').run(entryDate, description, jeId, line.accountId, line.debit, jeId)
      }
      if (line.credit > 0) {
        db.prepare('INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, credit_account_id, amount, journal_entry_id) VALUES (?, ?, "manual", ?, ?, ?, ?)').run(entryDate, description, jeId, line.accountId, line.credit, jeId)
      }

      // Auto-post to cashbook if cash/bank account
      const acc = db.prepare('SELECT account_code FROM accounts WHERE id = ?').get(line.accountId) as any
      if (acc && (acc.account_code === '1000' || acc.account_code === '1001')) {
        const isCash = acc.account_code === '1000'
        db.prepare(`INSERT INTO cashbook_entries (entry_date, description, cash_in, bank_in, cash_out, bank_out, journal_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          entryDate, description,
          isCash ? (line.debit || 0) : 0,
          !isCash ? (line.debit || 0) : 0,
          isCash ? (line.credit || 0) : 0,
          !isCash ? (line.credit || 0) : 0,
          jeId
        )
      }
    }
  })
  return tx()
})

ipcMain.handle('db:get-cashbook', (_e: any, { startDate, endDate }: any) => {
  const db = getDb()
  let query = 'SELECT * FROM cashbook_entries WHERE 1=1'
  const params: any[] = []
  if (startDate) { query += ' AND entry_date >= ?'; params.push(startDate) }
  if (endDate) { query += ' AND entry_date <= ?'; params.push(endDate) }
  query += ' ORDER BY entry_date ASC, id ASC'
  return db.prepare(query).all(...params)
})

ipcMain.handle('db:get-journal-entries', (_e: any, { startDate, endDate }: any) => {
  const db = getDb()
  let query = 'SELECT * FROM journal_entries WHERE 1=1'
  const params: any[] = []
  if (startDate) { query += ' AND entry_date >= ?'; params.push(startDate) }
  if (endDate) { query += ' AND entry_date <= ?'; params.push(endDate) }
  query += ' ORDER BY entry_date DESC, id DESC'

  const entries = db.prepare(query).all(...params) as any[]

  // Attach lines for each entry
  const getLines = db.prepare(`
    SELECT jl.*, a.account_name, a.account_code 
    FROM journal_lines jl 
    JOIN accounts a ON jl.account_id = a.id 
    WHERE jl.journal_entry_id = ?
  `)

  for (const entry of entries) {
    entry.lines = getLines.all(entry.id)
  }
  return entries
})

ipcMain.handle('db:get-ledger-entries', (_e, { accountId, startDate, endDate }) => {
    const db = getDb();
    let q = `
        SELECT le.entry_date, le.description, le.voucher_number, le.reference_type,
               CASE WHEN le.debit_account_id  = ? THEN le.amount ELSE 0 END as debit,
               CASE WHEN le.credit_account_id = ? THEN le.amount ELSE 0 END as credit
        FROM ledger_entries le
        WHERE (le.debit_account_id = ? OR le.credit_account_id = ?)
    `;
    const params = [accountId, accountId, accountId, accountId];
    if (startDate) { q += ' AND le.entry_date >= ?'; params.push(startDate); }
    if (endDate)   { q += ' AND le.entry_date <= ?'; params.push(endDate); }
    q += ' ORDER BY le.entry_date ASC, le.id ASC';
    return db.prepare(q).all(...params);
});

// Dashboard stats
ipcMain.handle('db:get-dashboard-stats', () => {
  const db = getDb()
  const totalPlots = db.prepare('SELECT COUNT(*) as count FROM plots WHERE is_deleted = 0').get() as any
  const totalMembers = db.prepare('SELECT COUNT(*) as count FROM members WHERE is_deleted = 0').get() as any
  const totalBills = db.prepare('SELECT COUNT(*) as count FROM bills WHERE is_deleted = 0').get() as any
  const unpaidBills = db.prepare("SELECT COUNT(*) as count FROM bills WHERE status IN ('unpaid', 'partial', 'overdue') AND is_deleted = 0").get() as any
  const totalCollected = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments').get() as any
  const totalExpenditure = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenditures WHERE is_deleted = 0').get() as any

  return {
    totalPlots: totalPlots?.count || 0,
    totalMembers: totalMembers?.count || 0,
    totalBills: totalBills?.count || 0,
    unpaidBills: unpaidBills?.count || 0,
    totalCollected: totalCollected?.total || 0,
    totalExpenditure: totalExpenditure?.total || 0,
  }
})

// ── App Lifecycle ──────────────────────────────────────────────
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  try {
    initDatabase(app.getPath('userData'))
    console.log('Database initialized successfully.')
  } catch (error) {
    console.error('Failed to initialize database:', error)
  }

  createWindow()
})
