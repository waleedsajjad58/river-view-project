// Must be FIRST — the IDE (VS Code / Cursor) sets this, which breaks Electron's built-in modules
delete process.env.ELECTRON_RUN_AS_NODE;

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { initDatabase, getDb } from './database.js';
import { generateChallanHTML, printChallan, generateTransferSlipHTML } from './challan-service.js';

// ── PIN hashing (SHA-256 — sufficient for offline single-user desktop app) ──
const hashPin = (pin) => createHash('sha256').update(pin).digest('hex');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 800, minWidth: 1024, minHeight: 600,
        show: false, title: 'River View Housing Society ERP', backgroundColor: '#0f172a',
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false, contextIsolation: true, nodeIntegration: false
        }
    });
    mainWindow.on('ready-to-show', () => mainWindow.show());
    mainWindow.webContents.setWindowOpenHandler((details) => { shell.openExternal(details.url); return { action: 'deny' }; });
    if (process.env.ELECTRON_RENDERER_URL) {
        mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }
}

// ── IPC Handlers ──────────────────────────────────────────────

// ── Audit Log helper — defined first so all handlers can call it ──
function writeAuditLog(db, tableName, recordId, action, details = {}) {
    try {
        db.prepare(
            'INSERT INTO audit_log (table_name, record_id, action, new_value) VALUES (?, ?, ?, ?)'
        ).run(tableName, String(recordId), action, JSON.stringify({ ...details, timestamp: new Date().toISOString() }));
    } catch (e) {
        console.error('[AuditLog] Failed to write:', e.message);
    }
}

// ── Plots ─────────────────────────────────────────────────────
ipcMain.handle('db:get-plots', () => {
    const db = getDb();
    return db.prepare(`
        SELECT p.*, m.name as owner_name
        FROM plots p
        LEFT JOIN plot_ownership po ON p.id = po.plot_id AND po.end_date IS NULL
        LEFT JOIN members m ON po.member_id = m.id
        WHERE p.is_deleted = 0 ORDER BY p.plot_number
    `).all();
});

ipcMain.handle('db:get-plot', (_e, id) => getDb().prepare('SELECT * FROM plots WHERE id = ? AND is_deleted = 0').get(id));

ipcMain.handle('db:add-plot', (_e, plot) => {
    return getDb().prepare(`
        INSERT INTO plots (plot_number, block, marla_size, plot_type, commercial_floors, has_water_connection, has_sewerage_connection, upper_floors_residential, notes)
        VALUES (@plot_number, @block, @marla_size, @plot_type, @commercial_floors, @has_water_connection, @has_sewerage_connection, @upper_floors_residential, @notes)
    `).run(plot);
});

ipcMain.handle('db:update-plot', (_e, plot) => {
    return getDb().prepare(`
        UPDATE plots SET plot_number=@plot_number, block=@block, marla_size=@marla_size, plot_type=@plot_type,
        commercial_floors=@commercial_floors, has_water_connection=@has_water_connection,
        has_sewerage_connection=@has_sewerage_connection, upper_floors_residential=@upper_floors_residential,
        notes=@notes, updated_at=CURRENT_TIMESTAMP WHERE id=@id
    `).run(plot);
});

ipcMain.handle('db:delete-plot', (_e, id) =>
    getDb().prepare('UPDATE plots SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id));

ipcMain.handle('db:change-plot-type', (_e, { id, newType, changedBy, notes }) => {
    const db = getDb();
    const plot = db.prepare('SELECT plot_type FROM plots WHERE id = ?').get(id);
    if (!plot) throw new Error('Plot not found');
    return db.transaction(() => {
        db.prepare("INSERT INTO plot_type_history (plot_id, old_type, new_type, changed_at, changed_by, notes) VALUES (?, ?, ?, date('now'), ?, ?)").run(id, plot.plot_type, newType, changedBy || null, notes || null);
        db.prepare('UPDATE plots SET plot_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newType, id);
    })();
});

// ── Members ───────────────────────────────────────────────────
ipcMain.handle('db:get-members', () => getDb().prepare('SELECT * FROM members WHERE is_deleted = 0 ORDER BY name').all());

ipcMain.handle('db:add-member', (_e, member) => {
    return getDb().prepare(`
        INSERT INTO members (name, cnic, phone, address, is_member, membership_date, share_count, notes)
        VALUES (@name, @cnic, @phone, @address, @is_member, @membership_date, @share_count, @notes)
    `).run(member);
});

ipcMain.handle('db:get-member', (_e, id) => getDb().prepare('SELECT * FROM members WHERE id = ? AND is_deleted = 0').get(id));

ipcMain.handle('db:update-member', (_e, member) => {
    return getDb().prepare(`
        UPDATE members SET name=@name, cnic=@cnic, phone=@phone, address=@address, is_member=@is_member,
        membership_date=@membership_date, share_count=@share_count, notes=@notes WHERE id=@id
    `).run(member);
});

ipcMain.handle('db:delete-member', (_e, id) => getDb().prepare('UPDATE members SET is_deleted = 1 WHERE id = ?').run(id));

ipcMain.handle('db:get-member-plots', (_e, memberId) => {
    return getDb().prepare(`
        SELECT p.* FROM plots p JOIN plot_ownership po ON p.id = po.plot_id
        WHERE po.member_id = ? AND po.end_date IS NULL AND p.is_deleted = 0
    `).all(memberId);
});

// Full member statement — all bills across all owned plots, with payment history
ipcMain.handle('db:get-member-statement', (_e, memberId) => {
    const db = getDb();
    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
    const plots = db.prepare(`
        SELECT p.id, p.plot_number, p.marla_size, p.plot_type
        FROM plots p JOIN plot_ownership po ON p.id = po.plot_id
        WHERE po.member_id = ? AND po.end_date IS NULL AND p.is_deleted = 0
    `).all(memberId);

    const bills = db.prepare(`
        SELECT b.*, p.plot_number
        FROM bills b
        JOIN plots p ON b.plot_id = p.id
        JOIN plot_ownership po ON p.id = po.plot_id
        WHERE po.member_id = ? AND po.end_date IS NULL AND b.is_deleted = 0
        ORDER BY b.bill_date DESC
    `).all(memberId);

    const totalBilled = bills.reduce((s, b) => s + (b.total_amount || 0), 0);
    const totalPaid = bills.reduce((s, b) => s + (b.amount_paid || 0), 0);
    const totalOutstanding = bills.reduce((s, b) => s + (b.balance_due || 0), 0);
    const unpaidCount = bills.filter(b => b.status !== 'paid').length;

    return { member, plots, bills, summary: { totalBilled, totalPaid, totalOutstanding, unpaidCount } };
});

// Full plot statement — all bills (monthly + special), owner, summary
ipcMain.handle('db:get-plot-statement', (_e, plotId) => {
    const db = getDb();
    const plot = db.prepare(`
        SELECT p.*, m.name as owner_name, m.phone as owner_phone, m.cnic as owner_cnic
        FROM plots p
        LEFT JOIN plot_ownership po ON p.id = po.plot_id AND po.end_date IS NULL
        LEFT JOIN members m ON po.member_id = m.id
        WHERE p.id = ?
    `).get(plotId);

    const bills = db.prepare(`
        SELECT b.*,
               (SELECT GROUP_CONCAT(bi.charge_name, ', ') FROM bill_items bi WHERE bi.bill_id = b.id) as charge_names
        FROM bills b
        WHERE b.plot_id = ? AND b.is_deleted = 0
        ORDER BY b.bill_date DESC
    `).all(plotId);

    const totalBilled = bills.reduce((s, b) => s + (b.total_amount || 0), 0);
    const totalPaid = bills.reduce((s, b) => s + (b.amount_paid || 0), 0);
    const totalOutstanding = bills.reduce((s, b) => s + (b.balance_due || 0), 0);
    const unpaidCount = bills.filter(b => b.status !== 'paid').length;
    const monthlyCount = bills.filter(b => b.bill_type === 'monthly').length;
    const specialCount = bills.filter(b => b.bill_type === 'special').length;
    const generalCount = bills.filter(b => b.bill_type === 'general').length;

    return { plot, bills, summary: { totalBilled, totalPaid, totalOutstanding, unpaidCount, monthlyCount, specialCount, generalCount } };
});

// ── Settings ──────────────────────────────────────────────────
ipcMain.handle('db:get-settings', () => getDb().prepare('SELECT * FROM settings').all());
ipcMain.handle('db:get-setting', (_e, key) => getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key));
ipcMain.handle('db:update-setting', (_e, { key, value }) =>
    getDb().prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key));

// ── Bill Templates ────────────────────────────────────────────
ipcMain.handle('db:get-bill-templates', () =>
    getDb().prepare('SELECT * FROM bill_templates WHERE is_active = 1 ORDER BY plot_type, sort_order').all());

// ── Ownership ─────────────────────────────────────────────────
ipcMain.handle('db:get-plot-owner', (_e, plotId) => {
    return getDb().prepare(`
        SELECT m.* FROM members m JOIN plot_ownership po ON m.id = po.member_id
        WHERE po.plot_id = ? AND po.end_date IS NULL AND m.is_deleted = 0
    `).get(plotId);
});

ipcMain.handle('db:assign-owner', (_e, { plotId, memberId, startDate }) => {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM plot_ownership WHERE plot_id = ? AND end_date IS NULL').get(plotId);
    if (existing) throw new Error('Plot already has an active owner. Use transfer instead.');
    const result = db.prepare('INSERT INTO plot_ownership (plot_id, member_id, start_date) VALUES (?, ?, ?)')
        .run(plotId, memberId, startDate || new Date().toISOString().split('T')[0]);
    writeAuditLog(db, 'plot_ownership', result.lastInsertRowid, 'ASSIGN', { plotId, memberId });
    return result;
});

ipcMain.handle('db:transfer-ownership', (_e, { plotId, newMemberId, transferDate, deedAmount, notes }) => {
    const db = getDb();
    const date = transferDate || new Date().toISOString().split('T')[0];
    return db.transaction(() => {
        const prev = db.prepare('SELECT member_id FROM plot_ownership WHERE plot_id = ? AND end_date IS NULL').get(plotId);
        db.prepare('UPDATE plot_ownership SET end_date = ? WHERE plot_id = ? AND end_date IS NULL').run(date, plotId);
        const result = db.prepare('INSERT INTO plot_ownership (plot_id, member_id, start_date, transfer_deed_amount, notes) VALUES (?, ?, ?, ?, ?)')
            .run(plotId, newMemberId, date, deedAmount || null, notes || null);
        writeAuditLog(db, 'plot_ownership', result.lastInsertRowid, 'TRANSFER', {
            plotId, fromMemberId: prev?.member_id, toMemberId: newMemberId, deedAmount, date
        });
        return result;
    })();
});

ipcMain.handle('db:get-ownership-history', (_e, plotId) => {
    return getDb().prepare(`
        SELECT po.*, m.name as owner_name FROM plot_ownership po
        JOIN members m ON po.member_id = m.id
        WHERE po.plot_id = ? ORDER BY po.start_date DESC
    `).all(plotId);
});

// ── Tenants ───────────────────────────────────────────────────
ipcMain.handle('db:get-tenants', (_e, plotId) => {
    const db = getDb();
    if (plotId) return db.prepare('SELECT * FROM tenants WHERE plot_id = ? AND is_deleted = 0').all(plotId);
    return db.prepare('SELECT t.*, p.plot_number FROM tenants t JOIN plots p ON t.plot_id = p.id WHERE t.is_deleted = 0').all();
});

ipcMain.handle('db:add-tenant', (_e, tenant) => {
    const t = { ...tenant, end_date: tenant.end_date || null, start_date: tenant.start_date || null };
    return getDb().prepare(`
        INSERT INTO tenants (name, cnic, phone, plot_id, start_date, end_date, monthly_rent, notes)
        VALUES (@name, @cnic, @phone, @plot_id, @start_date, @end_date, @monthly_rent, @notes)
    `).run(t);
});

ipcMain.handle('db:update-tenant', (_e, tenant) => {
    const t = { ...tenant, end_date: tenant.end_date || null, start_date: tenant.start_date || null };
    return getDb().prepare(`
        UPDATE tenants SET name=@name, cnic=@cnic, phone=@phone, start_date=@start_date,
        end_date=@end_date, monthly_rent=@monthly_rent, notes=@notes WHERE id=@id
    `).run(t);
});

ipcMain.handle('db:remove-tenant', (_e, id) => getDb().prepare('UPDATE tenants SET is_deleted = 1 WHERE id = ?').run(id));

// ── Expenditures ──────────────────────────────────────────────
ipcMain.handle('db:get-expenditures', (_e, { startDate, endDate, category } = {}) => {
    const db = getDb();
    let query = 'SELECT * FROM expenditures WHERE is_deleted = 0';
    const params = [];
    if (startDate) { query += ' AND expenditure_date >= ?'; params.push(startDate); }
    if (endDate) { query += ' AND expenditure_date <= ?'; params.push(endDate); }
    if (category) { query += ' AND category = ?'; params.push(category); }
    query += ' ORDER BY expenditure_date DESC, id DESC';
    return db.prepare(query).all(...params);
});

ipcMain.handle('db:add-expenditure', (_e, { expenditureDate, category, description, amount, paymentMethod, receiptNumber, vendorName, accountId }) => {
    const db = getDb();
    return db.transaction(() => {
        // ── Auto-generate voucher number: EXP-YYYYMMDD-NNN ──
        const dateCompact = (expenditureDate || new Date().toISOString().split('T')[0]).replace(/-/g, '');
        const seqRow = db.prepare("SELECT COUNT(*) as c FROM expenditures WHERE expenditure_date = ? AND is_deleted = 0").get(expenditureDate);
        const seq = String((seqRow?.c || 0) + 1).padStart(3, '0');
        const autoVoucher = `EXP-${dateCompact}-${seq}`;
        const voucherNumber = receiptNumber || autoVoucher;

        const result = db.prepare(`
            INSERT INTO expenditures (expenditure_date, category, description, amount, payment_method, voucher_number, vendor_name, account_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(expenditureDate, category, description, amount, paymentMethod || 'cash', voucherNumber, vendorName || null, accountId || null);
        const expId = result.lastInsertRowid;

        const expenseAccountId = accountId || db.prepare("SELECT id FROM accounts WHERE account_code = '5000'").get()?.id;
        const cashAccountCode = paymentMethod === 'bank' ? '1001' : '1000';
        const cashAccount = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(cashAccountCode);

        if (expenseAccountId && cashAccount) {
            const desc = `${category}: ${description}${vendorName ? ' (' + vendorName + ')' : ''}`;

            const jeResult = db.prepare(
                "INSERT INTO journal_entries (entry_date, description, voucher_number, reference_type, reference_id) VALUES (?, ?, ?, 'expenditure', ?)"
            ).run(expenditureDate, desc, voucherNumber, expId);
            const jeId = jeResult.lastInsertRowid;

            db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)').run(jeId, expenseAccountId, amount);
            db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)').run(jeId, cashAccount.id, amount);

            db.prepare("INSERT INTO ledger_entries (entry_date, description, voucher_number, reference_type, reference_id, debit_account_id, amount, journal_entry_id) VALUES (?, ?, ?, 'expenditure', ?, ?, ?, ?)")
                .run(expenditureDate, desc, voucherNumber, expId, expenseAccountId, amount, jeId);
            db.prepare("INSERT INTO ledger_entries (entry_date, description, voucher_number, reference_type, reference_id, credit_account_id, amount, journal_entry_id) VALUES (?, ?, ?, 'expenditure', ?, ?, ?, ?)")
                .run(expenditureDate, desc, voucherNumber, expId, cashAccount.id, amount, jeId);

            db.prepare('INSERT INTO cashbook_entries (entry_date, description, voucher_number, cash_out, bank_out, journal_entry_id) VALUES (?, ?, ?, ?, ?, ?)')
                .run(expenditureDate, desc, voucherNumber,
                    paymentMethod === 'cash' ? amount : 0,
                    paymentMethod === 'bank' ? amount : 0,
                    jeId);

            db.prepare('UPDATE expenditures SET journal_entry_id = ? WHERE id = ?').run(jeId, expId);
        }
        return { id: expId, voucherNumber };
    })();
});

// Option A — Expenditures are IMMUTABLE once posted.
// No direct edit allowed. Use reverse + re-enter instead.
ipcMain.handle('db:reverse-expenditure', (_e, { id, reason }) => {
    const db = getDb();
    return db.transaction(() => {
        const exp = db.prepare('SELECT * FROM expenditures WHERE id = ? AND is_deleted = 0').get(id);
        if (!exp) throw new Error('Expenditure not found');

        // Soft-delete the original (updated_at column added by migration 10 — use safe form)
        try {
            db.prepare("UPDATE expenditures SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?").run(id);
        } catch (e) {
            // updated_at column not yet added (migration 10 pending) — fall back
            db.prepare('UPDATE expenditures SET is_deleted = 1 WHERE id = ?').run(id);
        }

        // Post reversing journal entry (opposite signs)
        const cashAccountCode = exp.payment_method === 'bank' ? '1001' : '1000';
        const cashAccount = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(cashAccountCode);

        // Look up by stored account_id first, then by category name match, then fall back to 5000
        const expenseAccount =
            (exp.account_id && db.prepare('SELECT id FROM accounts WHERE id = ?').get(exp.account_id)) ||
            db.prepare('SELECT id FROM accounts WHERE account_name LIKE ?').get(`%${exp.category}%`) ||
            db.prepare("SELECT id FROM accounts WHERE account_code = '5000'").get();

        if (!cashAccount) throw new Error(`Cash/bank account not found for payment method: ${exp.payment_method}`);
        if (!expenseAccount) throw new Error(`Expense account not found for category: ${exp.category}`);

        if (true) {
            const desc = `REVERSAL: ${exp.category}: ${exp.description} (reversed — ${reason || 'correction'})`;
            const today = new Date().toISOString().split('T')[0];

            const jeResult = db.prepare(
                "INSERT INTO journal_entries (entry_date, description, reference_type, reference_id) VALUES (?, ?, 'expenditure_reversal', ?)"
            ).run(today, desc, id);
            const jeId = jeResult.lastInsertRowid;

            // Reverse: Cr. Expense, Dr. Cash/Bank
            db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)').run(jeId, expenseAccount.id, exp.amount);
            db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)').run(jeId, cashAccount.id, exp.amount);

            db.prepare("INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, credit_account_id, amount, journal_entry_id) VALUES (?, ?, 'expenditure_reversal', ?, ?, ?, ?)")
                .run(today, desc, id, expenseAccount.id, exp.amount, jeId);
            db.prepare("INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, debit_account_id, amount, journal_entry_id) VALUES (?, ?, 'expenditure_reversal', ?, ?, ?, ?)")
                .run(today, desc, id, cashAccount.id, exp.amount, jeId);

            // Reversal cashbook: money comes BACK in (Dr. Cash/Bank, so cash_in/bank_in)
            db.prepare('INSERT INTO cashbook_entries (entry_date, description, cash_in, bank_in, cash_out, bank_out, journal_entry_id) VALUES (?, ?, ?, ?, 0, 0, ?)')
                .run(today, desc,
                    exp.payment_method === 'cash' ? exp.amount : 0,
                    exp.payment_method === 'bank' ? exp.amount : 0,
                    jeId);
        }

        // Audit log
        writeAuditLog(db, 'expenditures', id, 'REVERSE', { reason });

        return { reversed: true, id };
    })();
});

ipcMain.handle('db:delete-expenditure', (_e, id) => {
    // Only allow soft-delete if no journal entry has been posted yet
    const db = getDb();
    const exp = db.prepare('SELECT journal_entry_id FROM expenditures WHERE id = ?').get(id);
    if (exp?.journal_entry_id) throw new Error('Cannot delete a posted expenditure. Use Reverse instead.');
    return db.prepare('UPDATE expenditures SET is_deleted = 1 WHERE id = ?').run(id);
});

ipcMain.handle('db:get-expenditure-categories', () => {
    const db = getDb();
    const used = db.prepare('SELECT DISTINCT category FROM expenditures WHERE is_deleted = 0 ORDER BY category').all().map(r => r.category);
    const defaults = ['Salaries & Wages', 'Maintenance & Repairs', 'Utilities', 'Stationery & Office', 'Security', 'Gardening', 'Generator & Fuel', 'Legal & Professional', 'Bank Charges', 'Miscellaneous'];
    return [...new Set([...defaults, ...used])].sort();
});

// ── Audit Log IPC ─────────────────────────────────────────────
ipcMain.handle('db:get-audit-log', (_e, { tableName, recordId } = {}) => {
    const db = getDb();
    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];
    if (tableName) { query += ' AND table_name = ?'; params.push(tableName); }
    if (recordId) { query += ' AND record_id = ?'; params.push(recordId); }
    return db.prepare(query + ' ORDER BY timestamp DESC LIMIT 200').all(...params);
});

// ── Month Locking ─────────────────────────────────────────────
ipcMain.handle('db:get-locked-months', () =>
    getDb().prepare('SELECT * FROM locked_months ORDER BY billing_month DESC').all());

ipcMain.handle('db:lock-month', (_e, { billingMonth, notes }) => {
    const db = getDb();
    // Check there are no unposted bills or open payments before locking
    const openBills = db.prepare(
        "SELECT COUNT(*) as c FROM bills WHERE billing_month = ? AND status IN ('unpaid', 'partial') AND is_deleted = 0"
    ).get(billingMonth);

    return db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO locked_months (billing_month, notes) VALUES (?, ?)').run(billingMonth, notes || null);
        writeAuditLog(db, 'locked_months', billingMonth, 'LOCK', { openBills: openBills?.c || 0, notes });
        return { locked: true, billingMonth, openBillsAtLock: openBills?.c || 0 };
    })();
});

ipcMain.handle('db:unlock-month', (_e, { billingMonth, reason }) => {
    const db = getDb();
    db.prepare('DELETE FROM locked_months WHERE billing_month = ?').run(billingMonth);
    writeAuditLog(db, 'locked_months', billingMonth, 'UNLOCK', { reason });
    return { unlocked: true, billingMonth };
});


ipcMain.handle('db:generate-monthly-bills', (_e, { billingMonth }) => {
    const db = getDb();
    const plots = db.prepare('SELECT * FROM plots WHERE is_deleted = 0').all();
    const templates = db.prepare('SELECT * FROM bill_templates WHERE is_active = 1 ORDER BY sort_order').all();
    const settingsMap = {};
    for (const s of db.prepare('SELECT key, value FROM settings').all()) settingsMap[s.key] = s.value;

    const prefix = settingsMap['bill_number_prefix'] || 'RV-';
    const dueDays = parseInt(settingsMap['default_due_days'] || '15');
    const tenantChallanAmount = parseFloat(settingsMap['tenant_challan_amount'] || '2500');
    let generated = 0;

    // Enforce month locking — refuse to generate bills for a locked month
    const isLocked = db.prepare('SELECT id FROM locked_months WHERE billing_month = ?').get(billingMonth);
    if (isLocked) throw new Error(`${billingMonth} is locked. Unlock it before generating bills.`);

    db.transaction(() => {
        for (const plot of plots) {
            const existing = db.prepare("SELECT id FROM bills WHERE plot_id = ? AND billing_month = ? AND bill_type = 'monthly' AND is_deleted = 0").get(plot.id, billingMonth);
            if (!existing) {
                const owner = db.prepare('SELECT member_id FROM plot_ownership WHERE plot_id = ? AND end_date IS NULL').get(plot.id);
                const items = [];

                for (const t of templates.filter(t => t.plot_type === plot.plot_type)) {
                    if (t.is_conditional && t.condition_field) {
                        if (t.condition_field === 'commercial_floors') {
                            const floors = plot.commercial_floors || 0;
                            if (floors > 0) items.push({ charge_name: t.charge_name, amount: t.amount * floors });
                        } else {
                            if (plot[t.condition_field]) items.push({ charge_name: t.charge_name, amount: t.amount });
                        }
                    } else {
                        items.push({ charge_name: t.charge_name, amount: t.amount });
                    }
                }

                // Carry forward arrears from previous unpaid bills
                const arrears = db.prepare(
                    "SELECT COALESCE(SUM(balance_due), 0) as total FROM bills WHERE plot_id = ? AND billing_month < ? AND status IN ('unpaid', 'partial', 'overdue') AND is_deleted = 0"
                ).get(plot.id, billingMonth)?.total || 0;

                if (items.length > 0) {
                    const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
                    const total = subtotal + arrears;
                    const billDate = billingMonth + '-01';
                    const dueDate = new Date(billDate);
                    dueDate.setDate(dueDate.getDate() + dueDays);
                    const dueDateStr = dueDate.toISOString().split('T')[0];
                    const seq = String((db.prepare('SELECT COUNT(*) as c FROM bills WHERE billing_month = ?').get(billingMonth)?.c || 0) + 1).padStart(3, '0');
                    const billNumber = `${prefix}${billingMonth}-${seq}`;

                    const result = db.prepare(`
                        INSERT INTO bills (bill_number, plot_id, member_id, bill_type, bill_date, due_date,
                        billing_month, subtotal, arrears, total_amount, balance_due, status)
                        VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?, ?, ?, ?, 'unpaid')
                    `).run(billNumber, plot.id, owner?.member_id || null, billDate, dueDateStr, billingMonth, subtotal, arrears, total, total);

                    const billId = result.lastInsertRowid;
                    const insertItem = db.prepare('INSERT INTO bill_items (bill_id, charge_name, amount) VALUES (?, ?, ?)');
                    for (const item of items) insertItem.run(billId, item.charge_name, item.amount);
                    if (arrears > 0) insertItem.run(billId, 'Arrears (Previous Balance)', arrears);

                    // Auto-apply any advance credit for this plot
                    const credit = db.prepare('SELECT * FROM plot_credits WHERE plot_id = ?').get(plot.id);
                    if (credit && credit.balance > 0.01) {
                        const newBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
                        const apply = Math.min(credit.balance, newBill.balance_due);
                        if (apply > 0.01) {
                            const today = new Date().toISOString().split('T')[0];
                            const autoReceipt = `AUTO-CR-${billId}`;
                            db.prepare(`INSERT INTO payments (bill_id, amount, payment_method, receipt_number, payment_date, notes)
                                VALUES (?, ?, 'credit', ?, ?, 'Auto-applied from advance credit')`)
                                .run(billId, apply, autoReceipt, today);
                            const newPaid = newBill.amount_paid + apply;
                            const newBalance = newBill.total_amount - newPaid;
                            db.prepare(`UPDATE bills SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?`)
                                .run(newPaid, Math.max(0, newBalance), newBalance <= 0.01 ? 'paid' : 'partial', billId);
                            db.prepare(`UPDATE plot_credits SET balance = balance - ?, updated_at = datetime('now') WHERE plot_id = ?`)
                                .run(apply, plot.id);
                        }
                    }

                    generated++;
                }
            }

            // Tenant challan
            const tenant = db.prepare("SELECT id, name FROM tenants WHERE plot_id = ? AND is_deleted = 0 AND (end_date IS NULL OR end_date = '' OR end_date >= date('now'))").get(plot.id);
            if (tenant) {
                const existingTenantBill = db.prepare("SELECT id FROM bills WHERE plot_id = ? AND billing_month = ? AND bill_type = 'tenant' AND is_deleted = 0").get(plot.id, billingMonth);
                if (!existingTenantBill) {
                    const billDate = billingMonth + '-01';
                    const dueDate = new Date(billDate);
                    dueDate.setDate(dueDate.getDate() + dueDays);
                    const seq = String((db.prepare('SELECT COUNT(*) as c FROM bills WHERE billing_month = ?').get(billingMonth)?.c || 0) + 1).padStart(3, '0');
                    const tenantBillResult = db.prepare(`
                        INSERT INTO bills (bill_number, plot_id, tenant_id, bill_type, bill_date, due_date,
                        billing_month, subtotal, total_amount, balance_due, status)
                        VALUES (?, ?, ?, 'tenant', ?, ?, ?, ?, ?, ?, 'unpaid')
                    `).run(`${prefix}${billingMonth}-${seq}-T`, plot.id, tenant.id, billDate, dueDate.toISOString().split('T')[0], billingMonth, tenantChallanAmount, tenantChallanAmount, tenantChallanAmount);
                    // Insert bill_item so tenant bills show charge lines in detail views
                    db.prepare('INSERT INTO bill_items (bill_id, charge_name, amount) VALUES (?, ?, ?)')
                        .run(tenantBillResult.lastInsertRowid, 'Monthly Tenant Challan', tenantChallanAmount);
                    generated++;
                }
            }
        }
    })();
    return { generated, month: billingMonth };
});

// ── Bills ─────────────────────────────────────────────────────
ipcMain.handle('db:get-bills', (_e, filters) => {
    const db = getDb();
    let query = `
        SELECT b.*, p.plot_number, m.name as owner_name, t.name as tenant_name,
               (SELECT bi.charge_name FROM bill_items bi WHERE bi.bill_id = b.id LIMIT 1) as charge_name
        FROM bills b
        LEFT JOIN plots p ON b.plot_id = p.id
        LEFT JOIN members m ON b.member_id = m.id
        LEFT JOIN tenants t ON b.tenant_id = t.id
        WHERE b.is_deleted = 0
    `;
    const params = [];
    // allMonths=true → skip month filter (used for "All Unpaid" cross-month view)
    if (!filters?.allMonths && filters?.billingMonth) {
        query += ' AND b.billing_month = ?'; params.push(filters.billingMonth);
    }
    // status can be a comma-separated list e.g. 'unpaid,partial,overdue'
    if (filters?.status && filters.status !== 'all') {
        const statuses = filters.status.split(',').map(s => s.trim()).filter(Boolean);
        if (statuses.length === 1) {
            query += ' AND b.status = ?'; params.push(statuses[0]);
        } else if (statuses.length > 1) {
            query += ` AND b.status IN (${statuses.map(() => '?').join(',')})`;
            params.push(...statuses);
        }
    }
    if (filters?.billType) { query += ' AND b.bill_type = ?'; params.push(filters.billType); }
    query += ' ORDER BY b.bill_date DESC, p.plot_number';
    return db.prepare(query).all(...params);
});

ipcMain.handle('db:get-bill-detail', (_e, billId) => {
    const db = getDb();
    const bill = db.prepare(`
        SELECT b.*, p.plot_number, p.marla_size, p.plot_type, m.name as owner_name, m.phone, m.address
        FROM bills b LEFT JOIN plots p ON b.plot_id = p.id LEFT JOIN members m ON b.member_id = m.id WHERE b.id = ?
    `).get(billId);
    const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id').all(billId);
    const payments = db.prepare('SELECT * FROM payments WHERE bill_id = ? ORDER BY payment_date DESC').all(billId);
    return { bill, items, payments };
});

ipcMain.handle('db:add-custom-bill-item', (_e, { billId, chargeName, amount }) => {
    const db = getDb();
    const bill = db.prepare('SELECT status FROM bills WHERE id = ?').get(billId);
    if (!bill) throw new Error('Bill not found');
    if (bill.status === 'paid') throw new Error('Cannot modify a paid bill');
    return db.transaction(() => {
        db.prepare('INSERT INTO bill_items (bill_id, charge_name, amount, is_custom) VALUES (?, ?, ?, 1)').run(billId, chargeName, amount);
        db.prepare('UPDATE bills SET subtotal = subtotal + ?, total_amount = total_amount + ?, balance_due = balance_due + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(amount, amount, amount, billId);
    })();
});

ipcMain.handle('db:get-all-bills', (_e, filters) => {
    const db = getDb();
    let query = `
        SELECT b.*, p.plot_number, m.name as owner_name, t.name as tenant_name,
               (SELECT bi.charge_name FROM bill_items bi WHERE bi.bill_id = b.id LIMIT 1) as charge_name
        FROM bills b
        LEFT JOIN plots p ON b.plot_id = p.id LEFT JOIN members m ON b.member_id = m.id LEFT JOIN tenants t ON b.tenant_id = t.id
        WHERE b.is_deleted = 0
    `;
    const params = [];
    if (filters?.billType) { query += ' AND b.bill_type = ?'; params.push(filters.billType); }
    if (filters?.status) { query += ' AND b.status = ?'; params.push(filters.status); }
    if (filters?.billingMonth) { query += ' AND b.billing_month = ?'; params.push(filters.billingMonth); }
    query += ' ORDER BY b.created_at DESC, p.plot_number';
    return db.prepare(query).all(...params);
});

// ── Payments ──────────────────────────────────────────────────
ipcMain.handle('db:record-payment', (_e, { billId, amount, paymentMethod, receiptNumber, notes }) => {
    const db = getDb();
    return db.transaction(() => {
        const bill = db.prepare(`
            SELECT b.bill_number, b.total_amount, b.amount_paid, b.balance_due, b.plot_id, p.plot_number
            FROM bills b LEFT JOIN plots p ON b.plot_id = p.id WHERE b.id = ?
        `).get(billId);
        if (!bill) throw new Error('Bill not found');

        const newPaid = (bill.amount_paid || 0) + amount;
        const newBalance = bill.total_amount - newPaid;
        const status = newBalance <= 0 ? 'paid' : newBalance === bill.total_amount ? 'unpaid' : 'partial';

        // ── Auto-generate receipt number: REC-YYYYMMDD-NNN ──
        const today = new Date().toISOString().split('T')[0];
        const receiptPrefix = db.prepare("SELECT value FROM settings WHERE key = 'receipt_prefix'").get()?.value || 'REC-';
        const dateCompact = today.replace(/-/g, '');
        const seqRow = db.prepare("SELECT COUNT(*) as c FROM payments WHERE payment_date = date('now')").get();
        const seq = String((seqRow?.c || 0) + 1).padStart(3, '0');
        const autoReceipt = `${receiptPrefix}${dateCompact}-${seq}`;
        const finalReceipt = receiptNumber || autoReceipt;

        const paymentResult = db.prepare(
            "INSERT INTO payments (bill_id, payment_date, amount, payment_method, receipt_number, notes) VALUES (?, date('now'), ?, ?, ?, ?)"
        ).run(billId, amount, paymentMethod || 'cash', finalReceipt, notes || null);

        db.prepare('UPDATE bills SET amount_paid = ?, balance_due = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(newPaid, Math.max(0, newBalance), status, billId);

        const desc = `Payment received for Bill #${bill.bill_number} (Plot ${bill.plot_number})`;
        const debitAccountCode = paymentMethod === 'cash' ? '1000' : '1001';
        const debitAccount = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(debitAccountCode);
        const creditAccount = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get('4000');

        if (!debitAccount || !creditAccount) throw new Error(`Chart of accounts missing ${debitAccountCode} or 1200`);

        const jeResult = db.prepare("INSERT INTO journal_entries (entry_date, description, voucher_number, reference_type, reference_id) VALUES (?, ?, ?, 'payment', ?)").run(today, desc, finalReceipt, paymentResult.lastInsertRowid);
        const jeId = jeResult.lastInsertRowid;

        db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)').run(jeId, debitAccount.id, amount);
        db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)').run(jeId, creditAccount.id, amount);

        const leDebitResult = db.prepare("INSERT INTO ledger_entries (entry_date, description, voucher_number, reference_type, reference_id, debit_account_id, amount, journal_entry_id) VALUES (?, ?, ?, 'payment', ?, ?, ?, ?)").run(today, desc, finalReceipt, paymentResult.lastInsertRowid, debitAccount.id, amount, jeId);
        db.prepare("INSERT INTO ledger_entries (entry_date, description, voucher_number, reference_type, reference_id, credit_account_id, amount, journal_entry_id) VALUES (?, ?, ?, 'payment', ?, ?, ?, ?)").run(today, desc, finalReceipt, paymentResult.lastInsertRowid, creditAccount.id, amount, jeId);

        db.prepare('INSERT INTO cashbook_entries (entry_date, description, receipt_number, cash_in, bank_in, journal_entry_id, ledger_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(today, desc, finalReceipt, paymentMethod === 'cash' ? amount : 0, paymentMethod !== 'cash' ? amount : 0, jeId, leDebitResult.lastInsertRowid);

        writeAuditLog(db, 'payments', paymentResult.lastInsertRowid, 'PAYMENT', {
            billId, amount, paymentMethod, receiptNumber: finalReceipt, billNumber: bill.bill_number
        });

        // If overpayment, store excess as advance credit against the plot
        const overpaid = amount - bill.balance_due;
        if (overpaid > 0.01) {
            db.prepare(`
                INSERT INTO plot_credits (plot_id, balance, updated_at)
                VALUES (?, ?, datetime('now'))
                ON CONFLICT(plot_id) DO UPDATE SET
                    balance    = balance + excluded.balance,
                    updated_at = datetime('now')
            `).run(bill.plot_id, overpaid);
        }

        return { receiptNumber: finalReceipt };
    })();
});

ipcMain.handle('db:get-payments', (_e, billId) =>
    getDb().prepare('SELECT * FROM payments WHERE bill_id = ? ORDER BY payment_date DESC').all(billId));

ipcMain.handle('db:apply-late-fees', () => {
    const db = getDb();
    const settingsMap = {};
    for (const s of db.prepare('SELECT key, value FROM settings').all()) settingsMap[s.key] = s.value;
    const feeType = settingsMap['late_fee_type'] || 'flat';
    const feeValue = parseFloat(settingsMap['late_fee_value'] || '500');
    const overdue = db.prepare("SELECT * FROM bills WHERE due_date < date('now') AND status IN ('unpaid', 'partial') AND late_fee = 0 AND is_deleted = 0").all();
    let applied = 0;
    db.transaction(() => {
        for (const bill of overdue) {
            const fee = feeType === 'percentage' ? bill.total_amount * (feeValue / 100) : feeValue;
            db.prepare("UPDATE bills SET late_fee = ?, total_amount = total_amount + ?, balance_due = balance_due + ?, status = 'overdue', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(fee, fee, fee, bill.id);
            db.prepare("INSERT INTO bill_items (bill_id, charge_name, amount, is_custom) VALUES (?, 'Late Fee', ?, 1)").run(bill.id, fee);
            applied++;
        }
    })();
    return { applied };
});

// ── Special Bills ─────────────────────────────────────────────
ipcMain.handle('db:get-onetime-charges', () => getDb().prepare('SELECT * FROM onetime_charges WHERE is_active = 1 ORDER BY charge_name').all());

ipcMain.handle('db:create-special-bill', (_e, { plotId, chargeName, amount, notes, dueDate }) => {
    const db = getDb();
    const plot = db.prepare('SELECT * FROM plots WHERE id = ? AND is_deleted = 0').get(plotId);
    if (!plot) throw new Error('Plot not found');
    const owner = db.prepare('SELECT member_id FROM plot_ownership WHERE plot_id = ? AND end_date IS NULL').get(plotId);
    const prefix = db.prepare("SELECT value FROM settings WHERE key = 'bill_number_prefix'").get()?.value || 'RV-';
    const today = new Date().toISOString().split('T')[0];
    let dueDateStr = dueDate;
    if (!dueDateStr) {
        const dueDays = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'default_due_days'").get()?.value || '15');
        const d = new Date(); d.setDate(d.getDate() + dueDays);
        dueDateStr = d.toISOString().split('T')[0];
    }
    const seq = String((db.prepare('SELECT COUNT(*) as c FROM bills').get()?.c || 0) + 1).padStart(3, '0');
    return db.transaction(() => {
        const result = db.prepare(`
            INSERT INTO bills (bill_number, plot_id, member_id, bill_type, bill_date, due_date, subtotal, total_amount, balance_due, status, notes)
            VALUES (?, ?, ?, 'special', ?, ?, ?, ?, ?, 'unpaid', ?)
        `).run(`${prefix}SP-${seq}`, plotId, owner?.member_id || null, today, dueDateStr, amount, amount, amount, notes || null);
        db.prepare('INSERT INTO bill_items (bill_id, charge_name, amount) VALUES (?, ?, ?)').run(result.lastInsertRowid, chargeName, amount);
    })();
});

// ── Accounting ────────────────────────────────────────────────
ipcMain.handle('db:get-accounts', () => getDb().prepare('SELECT * FROM accounts WHERE is_active = 1 ORDER BY account_code').all());

ipcMain.handle('db:get-ledger-entries', (_e, { accountId, startDate, endDate }) => {
    const db = getDb();
    // Return entries where this account is the debit or credit side,
    // mapping debit_account_id hit → debit amount, credit_account_id hit → credit amount
    return db.prepare(`
        SELECT
            le.id,
            le.entry_date,
            le.description,
            le.voucher_number,
            le.reference_type,
            le.reference_id,
            CASE WHEN le.debit_account_id  = ? THEN le.amount ELSE 0 END AS debit,
            CASE WHEN le.credit_account_id = ? THEN le.amount ELSE 0 END AS credit
        FROM ledger_entries le
        WHERE (le.debit_account_id = ? OR le.credit_account_id = ?)
          AND le.entry_date BETWEEN ? AND ?
        ORDER BY le.entry_date ASC, le.id ASC
    `).all(accountId, accountId, accountId, accountId, startDate, endDate);
});


ipcMain.handle('db:create-journal-entry', (_e, { entryDate, description, lines }) => {
    const db = getDb();
    return db.transaction(() => {
        const jeResult = db.prepare("INSERT INTO journal_entries (entry_date, description, reference_type) VALUES (?, ?, 'manual')").run(entryDate, description);
        const jeId = jeResult.lastInsertRowid;
        for (const line of lines) {
            db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?)').run(jeId, line.accountId, line.debit || 0, line.credit || 0);
            if (line.debit > 0) db.prepare('INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, debit_account_id, amount, journal_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(entryDate, description, 'manual', jeId, line.accountId, line.debit, jeId);
            if (line.credit > 0) db.prepare('INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, credit_account_id, amount, journal_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(entryDate, description, 'manual', jeId, line.accountId, line.credit, jeId);
            const acc = db.prepare('SELECT account_code FROM accounts WHERE id = ?').get(line.accountId);
            if (acc && (acc.account_code === '1000' || acc.account_code === '1001')) {
                const isCash = acc.account_code === '1000';
                db.prepare('INSERT INTO cashbook_entries (entry_date, description, cash_in, bank_in, cash_out, bank_out, journal_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .run(entryDate, description, isCash ? (line.debit || 0) : 0, !isCash ? (line.debit || 0) : 0, isCash ? (line.credit || 0) : 0, !isCash ? (line.credit || 0) : 0, jeId);
            }
        }
    })();
});

ipcMain.handle('db:get-cashbook', (_e, { startDate, endDate }) => {
    const db = getDb();
    let query = 'SELECT * FROM cashbook_entries WHERE 1=1';
    const params = [];
    if (startDate) { query += ' AND entry_date >= ?'; params.push(startDate); }
    if (endDate) { query += ' AND entry_date <= ?'; params.push(endDate); }
    return db.prepare(query + ' ORDER BY entry_date ASC, id ASC').all(...params);
});

ipcMain.handle('db:get-journal-entries', (_e, { startDate, endDate }) => {
    const db = getDb();
    let query = 'SELECT * FROM journal_entries WHERE 1=1';
    const params = [];
    if (startDate) { query += ' AND entry_date >= ?'; params.push(startDate); }
    if (endDate) { query += ' AND entry_date <= ?'; params.push(endDate); }
    const entries = db.prepare(query + ' ORDER BY entry_date DESC, id DESC').all(...params);
    const getLines = db.prepare('SELECT jl.*, a.account_name, a.account_code FROM journal_lines jl JOIN accounts a ON jl.account_id = a.id WHERE jl.journal_entry_id = ?');
    for (const entry of entries) entry.lines = getLines.all(entry.id);
    return entries;
});

// ── Dashboard ─────────────────────────────────────────────────
ipcMain.handle('db:get-dashboard-stats', () => {
    const db = getDb();
    const curMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    return {
        totalPlots: db.prepare('SELECT COUNT(*) as c FROM plots WHERE is_deleted = 0').get()?.c || 0,
        totalMembers: db.prepare('SELECT COUNT(*) as c FROM members WHERE is_deleted = 0').get()?.c || 0,
        totalBills: db.prepare('SELECT COUNT(*) as c FROM bills WHERE is_deleted = 0').get()?.c || 0,
        paidBills: db.prepare("SELECT COUNT(*) as c FROM bills WHERE status = 'paid' AND is_deleted = 0").get()?.c || 0,
        partialBills: db.prepare("SELECT COUNT(*) as c FROM bills WHERE status = 'partial' AND is_deleted = 0").get()?.c || 0,
        unpaidBills: db.prepare("SELECT COUNT(*) as c FROM bills WHERE status IN ('unpaid','partial','overdue') AND is_deleted = 0").get()?.c || 0,
        totalDues: db.prepare("SELECT COALESCE(SUM(balance_due),0) as t FROM bills WHERE status IN ('unpaid','partial','overdue') AND is_deleted = 0").get()?.t || 0,
        totalCollected: db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payments').get()?.t || 0,
        totalExpenditure: db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM expenditures WHERE is_deleted = 0 AND expenditure_date LIKE ?").get(`${curMonth}%`)?.t || 0,
    };
});

// ── Fund Summary ──────────────────────────────────────────────
ipcMain.handle('db:get-fund-summary', () =>
    getDb().prepare(`
        SELECT bi.charge_name,
               COUNT(bi.id)              AS item_count,
               COALESCE(SUM(bi.amount),0) AS total_billed
        FROM bill_items bi
        JOIN bills b ON bi.bill_id = b.id
        WHERE b.is_deleted = 0
        GROUP BY bi.charge_name
        ORDER BY total_billed DESC
    `).all()
);

// ── Reports ───────────────────────────────────────────────────
ipcMain.handle('db:report-trial-balance', (_e, { startDate, endDate }) => {
    const db = getDb();
    const params = [];
    let dateFilter = '';
    if (startDate && endDate) { dateFilter = ' AND je.entry_date BETWEEN ? AND ?'; params.push(startDate, endDate); }
    return db.prepare(`
        SELECT a.account_code, a.account_name, a.account_type, a.normal_balance,
               COALESCE(SUM(jl.debit), 0) as total_debit, COALESCE(SUM(jl.credit), 0) as total_credit
        FROM accounts a
        LEFT JOIN journal_lines jl ON a.id = jl.account_id
        LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id ${dateFilter}
        WHERE a.is_active = 1 GROUP BY a.id ORDER BY a.account_code
    `).all(...params);
});

ipcMain.handle('db:report-defaulters', () => {
    return getDb().prepare(`
        SELECT p.plot_number, p.plot_type, m.name as owner_name, m.phone,
               COUNT(b.id) as unpaid_count, COALESCE(SUM(b.balance_due), 0) as total_due,
               MIN(b.due_date) as oldest_due_date,
               CAST(julianday('now') - julianday(MIN(b.due_date)) AS INTEGER) as days_overdue
        FROM bills b JOIN plots p ON b.plot_id = p.id LEFT JOIN members m ON b.member_id = m.id
        WHERE b.status IN ('unpaid', 'partial', 'overdue') AND b.is_deleted = 0
        GROUP BY b.plot_id ORDER BY total_due DESC
    `).all();
});

ipcMain.handle('db:report-collection-summary', (_e, { year }) => {
    const targetYear = year || new Date().getFullYear().toString();
    return getDb().prepare(`
        SELECT strftime('%Y-%m', p.payment_date) as month, COUNT(p.id) as payment_count,
               COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN p.amount ELSE 0 END), 0) as cash_total,
               COALESCE(SUM(CASE WHEN p.payment_method != 'cash' THEN p.amount ELSE 0 END), 0) as bank_total,
               COALESCE(SUM(p.amount), 0) as total
        FROM payments p WHERE strftime('%Y', p.payment_date) = ?
        GROUP BY strftime('%Y-%m', p.payment_date) ORDER BY month
    `).all(targetYear);
});

ipcMain.handle('db:report-income-expenditure', (_e, { startDate, endDate }) => {
    const db = getDb();
    const jeP = []; let jeF = '';
    if (startDate) { jeF += ' AND je.entry_date >= ?'; jeP.push(startDate); }
    if (endDate) { jeF += ' AND je.entry_date <= ?'; jeP.push(endDate); }

    const revenue = db.prepare(`SELECT a.account_code, a.account_name, COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0) as net_amount FROM journal_lines jl JOIN accounts a ON jl.account_id = a.id JOIN journal_entries je ON jl.journal_entry_id = je.id WHERE a.account_type = 'revenue' ${jeF} GROUP BY a.id HAVING net_amount != 0 ORDER BY a.account_code`).all(...jeP);
    const expenses = db.prepare(`SELECT a.account_code, a.account_name, COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) as net_amount FROM journal_lines jl JOIN accounts a ON jl.account_id = a.id JOIN journal_entries je ON jl.journal_entry_id = je.id WHERE a.account_type = 'expense' ${jeF} GROUP BY a.id HAVING net_amount != 0 ORDER BY a.account_code`).all(...jeP);

    const bP = []; let bF = '';
    if (startDate) { bF += ' AND bill_date >= ?'; bP.push(startDate); }
    if (endDate) { bF += ' AND bill_date <= ?'; bP.push(endDate); }
    const billRevenue = db.prepare(`SELECT COALESCE(SUM(amount_paid), 0) as total FROM bills WHERE is_deleted = 0 ${bF}`).get(...bP);

    const eP = []; let eF = '';
    if (startDate) { eF += ' AND expenditure_date >= ?'; eP.push(startDate); }
    if (endDate) { eF += ' AND expenditure_date <= ?'; eP.push(endDate); }
    const directExpenses = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM expenditures WHERE is_deleted = 0 ${eF}`).get(...eP);

    return { revenue, expenses, billRevenue: billRevenue?.total || 0, directExpenses: directExpenses?.total || 0 };
});

// ── Backup & Export ───────────────────────────────────────────
ipcMain.handle('db:create-backup', async () => {
    const db = getDb();
    const fs = require('fs');
    const backupDir = join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = join(backupDir, `riverview_backup_${timestamp}.db`);
    await db.backup(backupPath);
    const stats = fs.statSync(backupPath);
    db.prepare("INSERT INTO backup_log (backup_date, backup_path, backup_type, file_size) VALUES (datetime('now'), ?, 'manual', ?)").run(backupPath, stats.size);
    return { path: backupPath, size: stats.size, timestamp };
});

ipcMain.handle('db:get-backup-log', () => getDb().prepare('SELECT * FROM backup_log ORDER BY backup_date DESC LIMIT 20').all());

ipcMain.handle('db:export-csv', async (_e, tableType) => {
    const db = getDb();
    let data = [], defaultFilename = '';
    if (tableType === 'plots') {
        data = db.prepare('SELECT p.*, m.name as owner_name FROM plots p LEFT JOIN plot_ownership po ON p.id = po.plot_id AND po.end_date IS NULL LEFT JOIN members m ON po.member_id = m.id WHERE p.is_deleted = 0 ORDER BY p.plot_number').all();
        defaultFilename = 'plots_export.csv';
    } else if (tableType === 'members') {
        data = db.prepare('SELECT * FROM members WHERE is_deleted = 0').all();
        defaultFilename = 'members_export.csv';
    } else if (tableType === 'bills') {
        data = db.prepare('SELECT b.*, p.plot_number, m.name as member_name FROM bills b JOIN plots p ON b.plot_id = p.id LEFT JOIN members m ON b.member_id = m.id WHERE b.is_deleted = 0 ORDER BY b.bill_date DESC').all();
        defaultFilename = 'bills_export.csv';
    } else if (tableType === 'expenditures') {
        data = db.prepare('SELECT * FROM expenditures WHERE is_deleted = 0 ORDER BY expenditure_date DESC').all();
        defaultFilename = 'expenditures_export.csv';
    }
    if (!data || data.length === 0) return { success: false, message: 'No data to export' };
    const { dialog } = require('electron');
    const { filePath } = await dialog.showSaveDialog({ title: 'Export Data', defaultPath: defaultFilename, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!filePath) return { success: false, message: 'Export cancelled' };
    const keys = Object.keys(data[0]);
    const csvContent = [keys.map(k => `"${k}"`).join(','), ...data.map(row => keys.map(k => `"${(row[k] ?? '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');
    require('fs').writeFileSync(filePath, csvContent);
    return { success: true, path: filePath };
});

// ── Tenant Statement (for future Tenant Statement tab) ────────
ipcMain.handle('db:get-tenant-statement', (_e, tenantId) => {
    const db = getDb();
    const tenant = db.prepare(`
        SELECT t.*, p.plot_number, p.block, p.marla_size, p.plot_type,
               m.name as owner_name, m.phone as owner_phone
        FROM tenants t
        LEFT JOIN plots p ON t.plot_id = p.id
        LEFT JOIN plot_ownership po ON po.plot_id = p.id AND po.end_date IS NULL
        LEFT JOIN members m ON po.member_id = m.id
        WHERE t.id = ?
    `).get(tenantId);
    if (!tenant) return null;
    const bills = db.prepare(`
        SELECT b.*,
               (SELECT GROUP_CONCAT(bi.charge_name || ' (Rs.' || bi.amount || ')', ', ')
                FROM bill_items bi WHERE bi.bill_id = b.id) as charge_names
        FROM bills b
        WHERE b.tenant_id = ? AND b.is_deleted = 0
        ORDER BY b.bill_date DESC
    `).all(tenantId);
    const payments = db.prepare(`
        SELECT pay.*, b.bill_number
        FROM payments pay
        JOIN bills b ON pay.bill_id = b.id
        WHERE b.tenant_id = ? AND b.is_deleted = 0
        ORDER BY pay.payment_date DESC
    `).all(tenantId);
    const summary = {
        totalBilled: bills.reduce((s, b) => s + (b.total_amount || 0), 0),
        totalPaid: bills.reduce((s, b) => s + (b.amount_paid || 0), 0),
        totalOutstanding: bills.reduce((s, b) => s + (b.balance_due || 0), 0),
        unpaidCount: bills.filter(b => b.status !== 'paid').length,
        monthlyCount: bills.filter(b => b.bill_type === 'monthly' || b.bill_type === 'tenant').length,
    };
    return { tenant, bills, payments, summary };
});
ipcMain.handle('db:get-all-bill-templates', () =>
    getDb().prepare('SELECT * FROM bill_templates ORDER BY plot_type, sort_order').all());

ipcMain.handle('db:update-bill-template', (_e, { id, amount, isActive }) => {
    const db = getDb();
    const params = [];
    let sets = [];
    if (amount !== undefined) { sets.push('amount = ?'); params.push(amount); }
    if (isActive !== undefined) { sets.push('is_active = ?'); params.push(isActive ? 1 : 0); }
    if (sets.length === 0) return;
    params.push(id);
    return db.prepare(`UPDATE bill_templates SET ${sets.join(', ')} WHERE id = ?`).run(...params);
});

ipcMain.handle('db:update-settings-bulk', (_e, updates) => {
    const db = getDb();
    return db.transaction(() => {
        for (const { key, value } of updates) {
            db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
        }
        writeAuditLog(db, 'settings', 0, 'UPDATE', { keys: updates.map(u => u.key) });
    })();
});

// ── Authentication ────────────────────────────────────────────
ipcMain.handle('db:verify-pin', (_e, { username, pin }) => {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
    if (!user) return { success: false, message: 'User not found' };
    const hashed = hashPin(pin);
    // Support both legacy plaintext (length < 64) and hashed PINs during transition
    const match = user.pin_hash === hashed || (user.pin_hash.length < 64 && user.pin_hash === pin);
    if (!match) return { success: false, message: 'Incorrect PIN' };
    // Silently upgrade plaintext PIN to hashed on successful login
    if (user.pin_hash.length < 64) {
        db.prepare('UPDATE users SET pin_hash = ? WHERE username = ?').run(hashed, username);
    }
    return { success: true, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } };
});

ipcMain.handle('db:change-pin', (_e, { username, currentPin, newPin }) => {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
    if (!user) throw new Error('User not found');
    const currentHashed = hashPin(currentPin);
    const legacyMatch = user.pin_hash.length < 64 && user.pin_hash === currentPin;
    if (user.pin_hash !== currentHashed && !legacyMatch) throw new Error('Current PIN is incorrect');
    db.prepare('UPDATE users SET pin_hash = ? WHERE username = ?').run(hashPin(newPin), username);
    writeAuditLog(db, 'users', user.id, 'PIN_CHANGE', { username });
    return { success: true };
});

// ── Balance Sheet ─────────────────────────────────────────────
ipcMain.handle('db:report-balance-sheet', (_e, { asOfDate }) => {
    const db = getDb();
    const date = asOfDate || new Date().toISOString().split('T')[0];
    const accounts = db.prepare(`
        SELECT a.id, a.account_code, a.account_name, a.account_type, a.normal_balance,
               COALESCE(SUM(CASE WHEN le.account_id = a.id AND le.side = 'debit'  THEN le.amount ELSE 0 END), 0) AS total_debit,
               COALESCE(SUM(CASE WHEN le.account_id = a.id AND le.side = 'credit' THEN le.amount ELSE 0 END), 0) AS total_credit
        FROM accounts a
        LEFT JOIN (
            SELECT debit_account_id  AS account_id, amount, 'debit'  AS side FROM ledger_entries WHERE entry_date <= ?
            UNION ALL
            SELECT credit_account_id AS account_id, amount, 'credit' AS side FROM ledger_entries WHERE entry_date <= ?
        ) le ON le.account_id = a.id
        WHERE a.account_type IN ('asset', 'liability', 'equity')
        GROUP BY a.id
        ORDER BY a.account_code
    `).all(date, date);

    return accounts.map(a => ({
        ...a,
        balance: a.normal_balance === 'debit'
            ? a.total_debit - a.total_credit
            : a.total_credit - a.total_debit
    })).filter(a => a.total_debit > 0 || a.total_credit > 0);
});

// ── Bank Deposits ─────────────────────────────────────────────
ipcMain.handle('db:get-bank-deposits', (_e, { startDate, endDate } = {}) => {
    const db = getDb();
    let q = 'SELECT *, total_amount AS amount FROM bank_deposits';
    const params = [];
    if (startDate && endDate) {
        q += ' WHERE deposit_date BETWEEN ? AND ?';
        params.push(startDate, endDate);
    } else if (startDate) {
        q += ' WHERE deposit_date >= ?';
        params.push(startDate);
    }
    q += ' ORDER BY deposit_date DESC, id DESC';
    return db.prepare(q).all(...params);
});

ipcMain.handle('db:add-bank-deposit', (_e, { depositDate, bankName, accountNumber, amount, description, referenceNumber, depositedBy }) => {
    const db = getDb();
    if (!amount || amount <= 0) throw new Error('Amount must be greater than zero');
    if (amount > 10000000) throw new Error('Single deposit cannot exceed Rs. 10,000,000');
    if (!depositDate) throw new Error('Deposit date is required');
    if (!bankName) throw new Error('Bank name is required');
    return db.transaction(() => {
        const r = db.prepare(`
            INSERT INTO bank_deposits (deposit_date, bank_name, account_number, total_amount, description, reference_number, deposited_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(depositDate, bankName, accountNumber || null, amount, description || null, referenceNumber || null, depositedBy || null);

        const bankAccount = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get('1001');
        const cashAccount = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get('1000');
        if (!bankAccount || !cashAccount) throw new Error('Chart of accounts missing 1001 or 1000');

        const voucherNumber = referenceNumber || null;
        const entryDesc = description || `Cash to bank deposit (${bankName})`;

        const jeResult = db.prepare("INSERT INTO journal_entries (entry_date, description, voucher_number, reference_type, reference_id) VALUES (?, ?, ?, 'bank_deposit', ?)")
            .run(depositDate, entryDesc, voucherNumber, r.lastInsertRowid);
        const jeId = jeResult.lastInsertRowid;

        // Dr. Allied Bank 1001, Cr. Cash in Hand 1000
        db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)').run(jeId, bankAccount.id, amount);
        db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)').run(jeId, cashAccount.id, amount);

        db.prepare("INSERT INTO ledger_entries (entry_date, description, voucher_number, reference_type, reference_id, debit_account_id, amount, journal_entry_id) VALUES (?, ?, ?, 'bank_deposit', ?, ?, ?, ?)")
            .run(depositDate, entryDesc, voucherNumber, r.lastInsertRowid, bankAccount.id, amount, jeId);
        db.prepare("INSERT INTO ledger_entries (entry_date, description, voucher_number, reference_type, reference_id, credit_account_id, amount, journal_entry_id) VALUES (?, ?, ?, 'bank_deposit', ?, ?, ?, ?)")
            .run(depositDate, entryDesc, voucherNumber, r.lastInsertRowid, cashAccount.id, amount, jeId);

        db.prepare('INSERT INTO cashbook_entries (entry_date, description, voucher_number, bank_in, cash_out, journal_entry_id) VALUES (?, ?, ?, ?, ?, ?)')
            .run(depositDate, entryDesc, voucherNumber, amount, amount, jeId);

        db.prepare('UPDATE bank_deposits SET journal_entry_id = ? WHERE id = ?').run(jeId, r.lastInsertRowid);

        writeAuditLog(db, 'bank_deposits', r.lastInsertRowid, 'INSERT', { amount, bankName });
        return { id: r.lastInsertRowid };
    })();
});

ipcMain.handle('db:delete-bank-deposit', (_e, { id }) => {
    const db = getDb();
    db.prepare('DELETE FROM bank_deposits WHERE id = ?').run(id);
    writeAuditLog(db, 'bank_deposits', id, 'DELETE', {});
    return { deleted: true };
});

ipcMain.handle('db:get-cash-balance', () => {
    const db = getDb();
    const r = db.prepare(`
        SELECT COALESCE(SUM(cash_in),0) - COALESCE(SUM(cash_out),0) as balance
        FROM cashbook_entries
    `).get();
    return r?.balance || 0;
});

ipcMain.handle('db:get-bank-balance', () => {
    const r = getDb().prepare(`
        SELECT COALESCE(SUM(bank_in),0) - COALESCE(SUM(bank_out),0) as balance
        FROM cashbook_entries
    `).get();
    return r?.balance || 0;
});

ipcMain.handle('db:cash-to-bank', (_e, { date, amount, notes }) => {
    const db = getDb();
    const cash = db.prepare("SELECT id FROM accounts WHERE account_code = '1000'").get();
    const bank = db.prepare("SELECT id FROM accounts WHERE account_code = '1001'").get();
    if (!cash || !bank) throw new Error('Accounts not found');
    return db.transaction(() => {
        const je = db.prepare("INSERT INTO journal_entries (entry_date, description, reference_type) VALUES (?, ?, 'transfer')")
            .run(date, notes || 'Cash transferred to bank');
        const jeId = je.lastInsertRowid;
        db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)').run(jeId, bank.id, amount);
        db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)').run(jeId, cash.id, amount);
        db.prepare('INSERT INTO cashbook_entries (entry_date, description, cash_out, bank_in, cash_in, bank_out, journal_entry_id) VALUES (?, ?, ?, ?, 0, 0, ?)')
            .run(date, notes || 'Cash transferred to bank', amount, amount, jeId);
        return { success: true };
    })();
});

ipcMain.handle('db:get-plot-credit', (_e, plotId) => {
    return getDb().prepare(`SELECT balance FROM plot_credits WHERE plot_id = ?`).get(plotId) || { balance: 0 };
});

// ── Excel Import ──────────────────────────────────────────────
ipcMain.handle('db:import-select-file', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
        title: 'Select Excel File to Import',
        filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
        properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

ipcMain.handle('db:import-preview', (_e, filePath) => {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath, { cellDates: true });

    const preview = { members: [], plots: [], payments: [], expenses: [] };
    const memberMap = {}; // membership# -> { name, plots[] }
    const plotMap = {}; // plotNo -> true

    // ── Parse Receipts Ledger sheets ──────────────────────────
    for (const sheetName of wb.SheetNames) {
        if (!sheetName.toLowerCase().includes('receipt')) continue;
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

        for (const row of rows) {
            const dateVal = row[0];
            const plotNo = row[1] ? String(row[1]).trim() : null;
            const memNo = row[2] ? String(row[2]).trim() : null;
            const name = row[3] ? String(row[3]).trim() : null;

            // Skip header/total/empty rows
            if (!dateVal || !plotNo || !name) continue;
            if (name.toLowerCase() === 'total') continue;
            if (plotNo.toLowerCase().includes('plot')) continue;
            if (!memNo || isNaN(parseInt(memNo))) continue;

            const date = dateVal instanceof Date
                ? dateVal.toISOString().split('T')[0]
                : String(dateVal).split('T')[0];

            // Collect unique plots and members
            if (!plotMap[plotNo]) {
                plotMap[plotNo] = true;
                preview.plots.push({ plot_number: plotNo });
            }
            if (!memberMap[memNo]) {
                memberMap[memNo] = { membership_number: memNo, name, plots: [] };
                preview.members.push({ membership_number: memNo, name });
            }
            if (!memberMap[memNo].plots.includes(plotNo))
                memberMap[memNo].plots.push(plotNo);

            // Collect payments
            const amounts = {
                previous: parseFloat(row[4]) || 0,
                current: parseFloat(row[5]) || 0,
                misc: parseFloat(row[6]) || 0,
                garbage: parseFloat(row[7]) || 0,
                aquifer: parseFloat(row[8]) || 0,
                mosque: parseFloat(row[9]) || 0,
                noc: parseFloat(row[11]) || 0,
                advance: parseFloat(row[12]) || 0,
                membership: parseFloat(row[13]) || 0,
                share: parseFloat(row[14]) || 0,
                transfer_s: parseFloat(row[15]) || 0,
                transfer_b: parseFloat(row[16]) || 0,
                possession: parseFloat(row[17]) || 0,
                demarcation: parseFloat(row[18]) || 0,
                non_const: parseFloat(row[19]) || 0,
                water_conn: parseFloat(row[20]) || 0,
                sewer_conn: parseFloat(row[21]) || 0,
                park: parseFloat(row[22]) || 0,
            };
            const total = Object.values(amounts).reduce((s, v) => s + v, 0);
            if (total > 0) {
                preview.payments.push({ date, plot_number: plotNo, member_name: name, amounts, total });
            }
        }
    }

    // ── Parse Expenses sheets ─────────────────────────────────
    const MONTH_COLS = { 'July': 2, 'Aug': 3, 'Sep': 4, 'Oct': 5, 'Nov': 6, 'Dec': 7 };
    // Jan-26 sheet has a different layout — col C is Jan
    for (const sheetName of wb.SheetNames) {
        if (!sheetName.toLowerCase().includes('expense')) continue;
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

        // Find header row to detect month columns
        let headerRow = null;
        let dataStartRow = 0;
        for (let i = 0; i < 5; i++) {
            if (rows[i] && rows[i].some(v => v && String(v).match(/July|Jan|Feb|Mar/i))) {
                headerRow = rows[i];
                dataStartRow = i + 1;
                break;
            }
        }
        if (!headerRow) continue;

        // Map col index -> month label
        const colMonths = {};
        headerRow.forEach((v, idx) => {
            if (v && String(v).match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i)) {
                colMonths[idx] = String(v).trim();
            }
        });

        for (const row of rows.slice(dataStartRow)) {
            const category = row[1] ? String(row[1]).trim() : null;
            if (!category || category.toLowerCase().includes('total') ||
                category.toLowerCase().includes('expense') ||
                category.toLowerCase().includes('rs')) continue;

            for (const [idxStr, month] of Object.entries(colMonths)) {
                const idx = parseInt(idxStr);
                const amt = parseFloat(row[idx]);
                if (!amt || isNaN(amt) || amt <= 0) continue;
                preview.expenses.push({ category, month, amount: amt });
            }
        }
    }

    return {
        plotCount: preview.plots.length,
        memberCount: preview.members.length,
        paymentCount: preview.payments.length,
        expenseCount: preview.expenses.length,
        samplePlots: preview.plots.slice(0, 5),
        sampleMembers: preview.members.slice(0, 5),
        samplePayments: preview.payments.slice(0, 5),
        sampleExpenses: preview.expenses.slice(0, 5),
        _data: preview   // full data passed through for execute step
    };
});

ipcMain.handle('db:import-execute', (_e, { filePath }) => {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath, { cellDates: true });
    const db = getDb();

    const results = { plots: 0, members: 0, payments: 0, expenses: 0, errors: [] };

    db.transaction(() => {
        const plotMap = {}; // plotNo   -> plot id
        const memberMap = {}; // memNo    -> member id

        // ── 1. Parse and insert plots + members from receipts ────
        for (const sheetName of wb.SheetNames) {
            if (!sheetName.toLowerCase().includes('receipt')) continue;
            const ws = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

            for (const row of rows) {
                const plotNo = row[1] ? String(row[1]).trim() : null;
                const memNo = row[2] ? String(row[2]).trim() : null;
                const name = row[3] ? String(row[3]).trim() : null;
                if (!plotNo || !name || !memNo || isNaN(parseInt(memNo))) continue;
                if (name.toLowerCase() === 'total') continue;
                if (plotNo.toLowerCase().includes('plot')) continue;

                // Insert plot if new
                if (!plotMap[plotNo]) {
                    const existing = db.prepare(`SELECT id FROM plots WHERE plot_number = ?`).get(plotNo);
                    if (existing) {
                        plotMap[plotNo] = existing.id;
                    } else {
                        const r = db.prepare(`
                            INSERT INTO plots (plot_number, plot_type, marla_size)
                            VALUES (?, 'residential_constructed', '5 Marla')
                        `).run(plotNo);
                        plotMap[plotNo] = r.lastInsertRowid;
                        results.plots++;
                    }
                }

                // Insert member if new
                if (!memberMap[memNo]) {
                    const existing = db.prepare(`SELECT id FROM members WHERE notes LIKE ?`).get(`%MEM#${memNo}%`);
                    if (existing) {
                        memberMap[memNo] = existing.id;
                    } else {
                        const r = db.prepare(`
                            INSERT INTO members (name, notes) VALUES (?, ?)
                        `).run(name, `MEM#${memNo}`);
                        memberMap[memNo] = r.lastInsertRowid;
                        results.members++;
                    }
                }

                // Assign ownership if not already assigned
                const plotId = plotMap[plotNo];
                const memberId = memberMap[memNo];
                const ownership = db.prepare(
                    `SELECT id FROM plot_ownership WHERE plot_id = ? AND is_current = 1`
                ).get(plotId);
                if (!ownership) {
                    db.prepare(`
                        INSERT INTO plot_ownership (plot_id, member_id, start_date, is_current)
                        VALUES (?, ?, date('now'), 1)
                    `).run(plotId, memberId);
                }
            }
        }

        // ── 2. Import payments as cashbook entries ───────────────
        const CATEGORY_MAP = {
            previous: 'Previous Contribution',
            current: 'Monthly Contribution',
            misc: 'Miscellaneous Receipt',
            garbage: 'Garbage Collection',
            aquifer: 'Aquifer Charges',
            mosque: 'Mosque Contribution',
            noc: 'NOC / Sub-Division Charges',
            advance: 'Advance Contribution',
            membership: 'Membership Fee',
            share: 'Share Capital',
            transfer_s: 'Transfer Charges (Seller)',
            transfer_b: 'Transfer Charges (Buyer)',
            possession: 'Possession Charges',
            demarcation: 'Demarcation Charges',
            non_const: 'Non-Construction Fine',
            water_conn: 'Water Connection Charges',
            sewer_conn: 'Sewerage Connection Charges',
            park: 'Park Booking',
        };

        for (const sheetName of wb.SheetNames) {
            if (!sheetName.toLowerCase().includes('receipt')) continue;
            const ws = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

            for (const row of rows) {
                const dateVal = row[0];
                const plotNo = row[1] ? String(row[1]).trim() : null;
                const memNo = row[2] ? String(row[2]).trim() : null;
                const name = row[3] ? String(row[3]).trim() : null;
                if (!dateVal || !plotNo || !name || !memNo || isNaN(parseInt(memNo))) continue;
                if (name.toLowerCase() === 'total') continue;
                if (plotNo.toLowerCase().includes('plot')) continue;

                const date = dateVal instanceof Date
                    ? dateVal.toISOString().split('T')[0]
                    : String(dateVal).split('T')[0];

                const amounts = {
                    previous: parseFloat(row[4]) || 0, current: parseFloat(row[5]) || 0,
                    misc: parseFloat(row[6]) || 0, garbage: parseFloat(row[7]) || 0,
                    aquifer: parseFloat(row[8]) || 0, mosque: parseFloat(row[9]) || 0,
                    noc: parseFloat(row[11]) || 0, advance: parseFloat(row[12]) || 0,
                    membership: parseFloat(row[13]) || 0, share: parseFloat(row[14]) || 0,
                    transfer_s: parseFloat(row[15]) || 0, transfer_b: parseFloat(row[16]) || 0,
                    possession: parseFloat(row[17]) || 0, demarcation: parseFloat(row[18]) || 0,
                    non_const: parseFloat(row[19]) || 0, water_conn: parseFloat(row[20]) || 0,
                    sewer_conn: parseFloat(row[21]) || 0, park: parseFloat(row[22]) || 0,
                };

                for (const [key, amt] of Object.entries(amounts)) {
                    if (!amt || amt <= 0) continue;
                    const desc = `${CATEGORY_MAP[key]} — ${name} (Plot ${plotNo})`;
                    db.prepare(`
                        INSERT INTO cashbook_entries (entry_date, description, cash_in, bank_in, cash_out, bank_out)
                        VALUES (?, ?, ?, 0, 0, 0)
                    `).run(date, desc, amt);
                    results.payments++;
                }
            }
        }

        // ── 3. Import expenses ───────────────────────────────────
        const MONTH_TO_YEAR = {
            'July': '2025', 'Aug': '2025', 'Sep': '2025',
            'Oct': '2025', 'Nov': '2025', 'Dec': '2025',
            'Jan': '2026', 'Feb': '2026', 'Mar': '2026',
        };
        const MONTH_NUM = {
            'July': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10',
            'Nov': '11', 'Dec': '12', 'Jan': '01', 'Feb': '02', 'Mar': '03',
        };

        for (const sheetName of wb.SheetNames) {
            if (!sheetName.toLowerCase().includes('expense')) continue;
            const ws = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

            let headerRow = null;
            let dataStartRow = 0;
            for (let i = 0; i < 5; i++) {
                if (rows[i] && rows[i].some(v => v && String(v).match(/July|Jan|Feb|Mar/i))) {
                    headerRow = rows[i];
                    dataStartRow = i + 1;
                    break;
                }
            }
            if (!headerRow) continue;

            const colMonths = {};
            headerRow.forEach((v, idx) => {
                if (v && String(v).match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i))
                    colMonths[idx] = String(v).trim().replace(' ', '');
            });

            for (const row of rows.slice(dataStartRow)) {
                const category = row[1] ? String(row[1]).trim() : null;
                if (!category || category.toLowerCase().includes('total') ||
                    category.toLowerCase().includes('expense') ||
                    category.toLowerCase() === 'rs') continue;

                for (const [idxStr, month] of Object.entries(colMonths)) {
                    const idx = parseInt(idxStr);
                    const amt = parseFloat(row[idx]);
                    if (!amt || isNaN(amt) || amt <= 0) continue;

                    const yr = MONTH_TO_YEAR[month] || '2025';
                    const mo = MONTH_NUM[month] || '01';
                    const eDate = `${yr}-${mo}-01`;

                    db.prepare(`
                        INSERT INTO cashbook_entries (entry_date, description, cash_out, cash_in, bank_in, bank_out)
                        VALUES (?, ?, ?, 0, 0, 0)
                    `).run(eDate, `[IMPORT] ${category}`, amt);
                    results.expenses++;
                }
            }
        }
    })();

    return results;
});


ipcMain.handle('db:print-html-report', (_e, html) => {
    const tmpPath = join(tmpdir(), `rv-report-${Date.now()}.html`);
    writeFileSync(tmpPath, html, 'utf-8');
    const win = new BrowserWindow({
        width: 900, height: 1100, show: false, autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    win.loadFile(tmpPath);
    win.webContents.on('did-finish-load', () => {
        win.webContents.print({ silent: false, printBackground: true }, () => win.close());
    });
});

ipcMain.handle('db:print-challan', (_e, { billId, amount }) => {
    const html = generateChallanHTML(billId, amount ?? null);
    printChallan(html);
});

ipcMain.handle('db:print-cash-transfer', (_e, { date, amount, notes }) => {
    const html = generateTransferSlipHTML({ date, amount, notes });
    printChallan(html);
});

ipcMain.handle('db:get-challan-html', (_e, { billId, amount }) => {
    return generateChallanHTML(billId, amount ?? null);
});

// ── App Lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
    try { initDatabase(app.getPath('userData')); console.log('Database initialized successfully.'); }
    catch (error) { console.error('Failed to initialize database:', error); }
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });