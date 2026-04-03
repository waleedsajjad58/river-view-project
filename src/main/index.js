// Must be FIRST — the IDE (VS Code / Cursor) sets this, which breaks Electron's built-in modules
delete process.env.ELECTRON_RUN_AS_NODE;

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import ExcelJS from 'exceljs';
import { initDatabase, getDb } from './database.js';
import { generateChallanHTML, printChallan, generateTransferSlipHTML } from './challan-service.js';

// ── PIN hashing (SHA-256 — sufficient for offline single-user desktop app) ──
const hashPin = (pin) => createHash('sha256').update(pin).digest('hex');




ipcMain.handle('db:diagnose-bills', () => {
  const db = getDb();
  return db.prepare(`
    SELECT bi.charge_name, bi.amount, b.billing_month, 
           b.status, b.amount_paid, b.subtotal, b.total_amount
    FROM bill_items bi
    JOIN bills b ON bi.bill_id = b.id
    WHERE b.bill_type = 'monthly'
    ORDER BY b.billing_month, bi.charge_name
  `).all();
});

ipcMain.handle('db:restore-all-bill-items', () => {
    const db = getDb();
    let fixed = 0;

    const allBills = db.prepare(`
        SELECT b.*, p.plot_type
        FROM bills b
        JOIN plots p ON p.id = b.plot_id
        WHERE b.bill_type IN ('monthly','tenant') AND b.is_deleted = 0
        ORDER BY b.billing_month ASC
    `).all();

    const templates = db.prepare(
        'SELECT * FROM bill_templates WHERE is_active = 1'
    ).all();

    db.transaction(() => {
        for (const bill of allBills) {
            const items = db.prepare(`
                SELECT id, charge_name, amount FROM bill_items
                WHERE bill_id = ?
                    AND charge_name NOT LIKE '%Arrears%'
                    AND charge_name NOT LIKE '%Late Fee%'
            `).all(bill.id);

            if (items.length === 0) continue;

            // Only recover bills whose non-arrears items were fully zeroed.
            const itemsTotal = items.reduce((s, i) => s + (i.amount || 0), 0);
            if (itemsTotal > 0.01) continue;

            const plotTemplates = templates.filter(t => t.plot_type === bill.plot_type);
            const templateMap = {};
            for (const t of plotTemplates) templateMap[t.charge_name] = t.amount;

            for (const item of items) {
                const baseRate = templateMap[item.charge_name] || 0;
                if (baseRate > 0) {
                    db.prepare('UPDATE bill_items SET amount = ? WHERE id = ?')
                        .run(baseRate, item.id);
                }
            }

            fixed++;
        }
    })();

    return { fixed, total: allBills.length };
});





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

ipcMain.handle('app:set-zoom-factor', (_e, { factor }) => {
    const safeFactor = Math.min(1.5, Math.max(0.8, Number(factor) || 1));
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.setZoomFactor(safeFactor);
    }
    return { factor: safeFactor };
});

ipcMain.handle('app:get-zoom-factor', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        return { factor: mainWindow.webContents.getZoomFactor() };
    }
    return { factor: 1 };
});

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

function normalizePlotPayload(plot = {}) {
    return {
        id: plot.id ? Number(plot.id) : null,
        plot_number: String(plot.plot_number || '').trim(),
        block: String(plot.block || '').trim() || null,
        marla_size: String(plot.marla_size || '').trim() || '5 Marla',
        plot_type: String(plot.plot_type || 'residential_vacant').trim(),
        commercial_floors: Number.parseInt(plot.commercial_floors, 10) || 0,
        has_water_connection: plot.has_water_connection ? 1 : 0,
        has_sewerage_connection: plot.has_sewerage_connection ? 1 : 0,
        has_mosque_contribution: plot.has_mosque_contribution === 0 || plot.has_mosque_contribution === '0' ? 0 : 1,
        upper_floors_residential: plot.upper_floors_residential ? 1 : 0,
        notes: plot.notes || null,
    };
}

function recalcPlotBills() {
    return { skipped: true };
}

function sumStoredArrears(db, { plotId = null, tenantId = null, billingMonth = null, billType = null }) {
    const where = ['b.balance_due > 0.01', 'b.is_deleted = 0'];
    const params = [];

    if (plotId !== null) {
        where.push('b.plot_id = ?');
        params.push(plotId);
    }

    if (tenantId !== null) {
        where.push('b.tenant_id = ?');
        params.push(tenantId);
    }

    if (billingMonth) {
        where.push('b.billing_month < ?');
        params.push(billingMonth);
    }

    if (billType) {
        where.push('b.bill_type = ?');
        params.push(billType);
    }

    const row = db.prepare(`
        SELECT COALESCE(SUM(b.balance_due), 0) as total
        FROM bills b
        WHERE ${where.join(' AND ')}
    `).get(...params);

    return row?.total || 0;
}

function sumBillAdjustments(db, billId) {
    return db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM adjustments
        WHERE bill_id = ?
    `).get(billId)?.total || 0;
}

function syncBillTotals(db, billId) {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    if (!bill) throw new Error('Bill not found');
    if (bill.status === 'voided') return bill;

    const adjustmentTotal = sumBillAdjustments(db, billId);
    const totalAmount = Number(bill.subtotal || 0)
        + Number(bill.late_fee || 0)
        + Number(bill.arrears || 0)
        + Number(adjustmentTotal || 0);
    const paidAmount = Number(bill.amount_paid || 0);
    const balanceDue = Math.max(0, totalAmount - paidAmount);
    const status = totalAmount <= 0.01 ? 'paid' : balanceDue <= 0.01 ? 'paid' : paidAmount <= 0.01 ? 'unpaid' : 'partial';
    const desiredCredit = Math.max(0, paidAmount - totalAmount);
    const creditDelta = desiredCredit - Number(bill.credit_applied || 0);

    db.prepare(`
        UPDATE bills SET
            total_amount = ?,
            balance_due = ?,
            credit_applied = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(totalAmount, balanceDue, desiredCredit, status, billId);

    if (Math.abs(creditDelta) > 0.01) {
        db.prepare(`
            INSERT INTO plot_credits (plot_id, balance, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(plot_id) DO UPDATE SET
              balance = MAX(0, balance + excluded.balance),
              updated_at = datetime('now')
        `).run(bill.plot_id, creditDelta);
    }

    return { ...bill, total_amount: totalAmount, balance_due: balanceDue, status, adjustment_total: adjustmentTotal };
}

ipcMain.handle('db:update-plot', (_e, plot) => {
    const normalized = normalizePlotPayload(plot);
    return getDb().prepare(`
        UPDATE plots SET plot_number=@plot_number, marla_size=@marla_size, plot_type=@plot_type,
        commercial_floors=@commercial_floors, has_water_connection=@has_water_connection,
        has_sewerage_connection=@has_sewerage_connection, has_mosque_contribution=@has_mosque_contribution,
        upper_floors_residential=@upper_floors_residential,
        notes=@notes, updated_at=CURRENT_TIMESTAMP WHERE id=@id
    `).run(normalized);
});

ipcMain.handle('db:get-plots', () => {
    const db = getDb();
    return db.prepare(`
        SELECT p.*, m.name as owner_name, m.phone as owner_phone
        FROM plots p
        LEFT JOIN plot_ownership po ON p.id = po.plot_id AND po.end_date IS NULL
        LEFT JOIN members m ON po.member_id = m.id
        WHERE p.is_deleted = 0
        ORDER BY p.plot_number
    `).all();
});

ipcMain.handle('db:get-plot', (_e, id) => {
    const db = getDb();
    return db.prepare('SELECT * FROM plots WHERE id = ? AND is_deleted = 0').get(id);
});

ipcMain.handle('db:add-plot', (_e, plot) => {
    const db = getDb();
    const normalized = normalizePlotPayload(plot);
    if (!normalized.plot_number) throw new Error('Plot number is required');

    return db.transaction(() => {
        const result = db.prepare(`
            INSERT INTO plots (
                plot_number, block, marla_size, plot_type, commercial_floors,
                has_water_connection, has_sewerage_connection, has_mosque_contribution,
                upper_floors_residential, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            normalized.plot_number,
            normalized.block,
            normalized.marla_size,
            normalized.plot_type,
            normalized.commercial_floors,
            normalized.has_water_connection,
            normalized.has_sewerage_connection,
            normalized.has_mosque_contribution,
            normalized.upper_floors_residential,
            normalized.notes,
        );

        const plotId = result.lastInsertRowid;
        if (plot.addOwnerId || plot.assignOwnerId) {
            const memberId = Number(plot.addOwnerId || plot.assignOwnerId);
            if (memberId) {
                db.prepare(`
                    INSERT INTO plot_ownership (plot_id, member_id, start_date)
                    VALUES (?, ?, ?)
                `).run(plotId, memberId, plot.ownerStartDate || new Date().toISOString().split('T')[0]);
            }
        }

        writeAuditLog(db, 'plots', plotId, 'CREATE', {
            plot_number: normalized.plot_number,
            plot_type: normalized.plot_type,
        });

        return { lastInsertRowid: plotId };
    })();
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
const sanitizeMemberPayload = (member = {}) => ({
    ...member,
    member_id: String(member.member_id || '').trim(),
    name: String(member.name || '').trim(),
    cnic: String(member.cnic || '').trim(),
    phone: String(member.phone || '').trim(),
    membership_date: String(member.membership_date || '').trim(),
    share_count: Number.parseInt(member.share_count, 10) || 4,
    address: member.address || null,
    notes: member.notes || null,
});

const validateRequiredMemberFields = (member) => {
    if (!member.member_id) throw new Error('Member ID is required');
    if (!member.name) throw new Error('Name is required');
    if (!member.cnic) throw new Error('CNIC is required');
    if (!member.phone) throw new Error('Phone number is required');
    if (!member.membership_date) throw new Error('Membership date is required');
    if (!/^\d{13}$/.test(member.cnic)) throw new Error('CNIC must be exactly 13 digits');
    if (!/^\d{11}$/.test(member.phone)) throw new Error('Phone number must be exactly 11 digits');
};

ipcMain.handle('db:get-members', () => getDb().prepare('SELECT * FROM members WHERE is_deleted = 0 ORDER BY member_id, name').all());

ipcMain.handle('db:add-member', (_e, member) => {
    const normalized = sanitizeMemberPayload(member);
    validateRequiredMemberFields(normalized);
    return getDb().prepare(`
        INSERT INTO members (member_id, name, cnic, phone, address, is_member, membership_date, notes)
        VALUES (@member_id, @name, @cnic, @phone, @address, @is_member, @membership_date, @notes)
    `).run(normalized);
});

ipcMain.handle('db:get-member', (_e, id) => getDb().prepare('SELECT * FROM members WHERE id = ? AND is_deleted = 0').get(id));

ipcMain.handle('db:update-member', (_e, member) => {
    const normalized = sanitizeMemberPayload(member);
    validateRequiredMemberFields(normalized);
    return getDb().prepare(`
        UPDATE members SET member_id=@member_id, name=@name, cnic=@cnic, phone=@phone, address=@address, is_member=@is_member,
        membership_date=@membership_date, notes=@notes WHERE id=@id
    `).run(normalized);
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
    const totalOutstanding = bills.reduce((s, b) => s + (['unpaid', 'partial', 'overdue'].includes(b.status) ? (b.balance_due || 0) : 0), 0);
    const unpaidCount = bills.filter(b => ['unpaid', 'partial', 'overdue'].includes(b.status)).length;

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

    let bills = [];
    try {
        const hasAdjustments = !!db.prepare(
            "SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'adjustments'"
        ).get();

        bills = db.prepare(`
            SELECT b.*,
                   b.subtotal as current_charges,
                   b.arrears as previous_dues,
                   b.balance_due as actual_balance,
                   ${hasAdjustments ? "COALESCE((SELECT SUM(a.amount) FROM adjustments a WHERE a.bill_id = b.id), 0)" : '0'} as adjustment_total,
                   (SELECT GROUP_CONCAT(bi.charge_name, ', ') FROM bill_items bi WHERE bi.bill_id = b.id) as charge_names
            FROM bills b
            WHERE b.plot_id = ? AND b.is_deleted = 0
            ORDER BY b.bill_date DESC
        `).all(plotId);
    } catch (err) {
        if (!String(err?.message || '').toLowerCase().includes('no such table: adjustments')) throw err;
        bills = db.prepare(`
            SELECT b.*,
                   b.subtotal as current_charges,
                   b.arrears as previous_dues,
                   b.balance_due as actual_balance,
                   0 as adjustment_total,
                   (SELECT GROUP_CONCAT(bi.charge_name, ', ') FROM bill_items bi WHERE bi.bill_id = b.id) as charge_names
            FROM bills b
            WHERE b.plot_id = ? AND b.is_deleted = 0
            ORDER BY b.bill_date DESC
        `).all(plotId);
    }

    const totalBilled = bills.reduce((s, b) => s + (b.total_amount || 0), 0);
    const totalPaid = bills.reduce((s, b) => s + (b.amount_paid || 0), 0);
    const totalOutstanding = bills.reduce((s, b) => s + (['unpaid', 'partial', 'overdue'].includes(b.status) ? (b.balance_due || 0) : 0), 0);
    const unpaidCount = bills.filter(b => ['unpaid', 'partial', 'overdue'].includes(b.status)).length;
    const monthlyCount = bills.filter(b => b.bill_type === 'monthly').length;
    const specialCount = bills.filter(b => b.bill_type === 'special').length;
    const generalCount = bills.filter(b => b.bill_type === 'general').length;

    return { plot, bills, summary: { totalBilled, totalPaid, totalOutstanding, unpaidCount, monthlyCount, specialCount, generalCount } };
});

ipcMain.handle('db:fix-baked-arrears', () => {
    const db = getDb();
    void db;
    return { message: 'Bills already correct via FIFO balance_due' };
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
const sanitizeTenantPayload = (tenant = {}) => ({
    ...tenant,
    tenant_id: String(tenant.tenant_id || '').trim(),
    name: String(tenant.name || '').trim(),
    cnic: String(tenant.cnic || '').trim(),
    phone: String(tenant.phone || '').trim(),
    plot_id: Number.parseInt(tenant.plot_id, 10) || 0,
    start_date: String(tenant.start_date || '').trim(),
    end_date: String(tenant.end_date || '').trim() || null,
    monthly_rent: Number(tenant.monthly_rent) || 0,
    notes: tenant.notes || null,
});

const validateRequiredTenantFields = (tenant) => {
    if (!tenant.tenant_id) throw new Error('Tenant ID is required');
    if (!tenant.name) throw new Error('Name is required');
    if (!tenant.cnic) throw new Error('CNIC is required');
    if (!tenant.phone) throw new Error('Phone number is required');
    if (!tenant.plot_id) throw new Error('Plot is required');
    if (!tenant.start_date) throw new Error('Start date is required');
};

ipcMain.handle('db:get-tenants', (_e, plotId) => {
    const db = getDb();
    if (plotId) return db.prepare('SELECT * FROM tenants WHERE plot_id = ? AND is_deleted = 0 ORDER BY tenant_id, name').all(plotId);
    return db.prepare('SELECT t.*, p.plot_number FROM tenants t JOIN plots p ON t.plot_id = p.id WHERE t.is_deleted = 0 ORDER BY t.tenant_id, t.name').all();
});

ipcMain.handle('db:add-tenant', (_e, tenant) => {
    const t = sanitizeTenantPayload(tenant);
    validateRequiredTenantFields(t);
    return getDb().prepare(`
        INSERT INTO tenants (tenant_id, name, cnic, phone, plot_id, start_date, end_date, monthly_rent, notes)
        VALUES (@tenant_id, @name, @cnic, @phone, @plot_id, @start_date, @end_date, @monthly_rent, @notes)
    `).run(t);
});

ipcMain.handle('db:update-tenant', (_e, tenant) => {
    const t = sanitizeTenantPayload(tenant);
    validateRequiredTenantFields(t);
    return getDb().prepare(`
        UPDATE tenants SET tenant_id=@tenant_id, name=@name, cnic=@cnic, phone=@phone, plot_id=@plot_id,
        start_date=@start_date, end_date=@end_date, monthly_rent=@monthly_rent, notes=@notes WHERE id=@id
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

ipcMain.handle('db:add-expenditure', (_e, { expenditureDate, category, description, amount, paymentMethod, receiptNumber, vendorName, accountId, bankId }) => {
    const db = getDb();
    return db.transaction(() => {
        const normalizedPaymentMethod = paymentMethod === 'cash' ? 'cash' : 'bank';

        // ── Auto-generate voucher number: EXP-YYYYMMDD-NNN ──
        const dateCompact = (expenditureDate || new Date().toISOString().split('T')[0]).replace(/-/g, '');
        const seqRow = db.prepare("SELECT COUNT(*) as c FROM expenditures WHERE expenditure_date = ? AND is_deleted = 0").get(expenditureDate);
        const seq = String((seqRow?.c || 0) + 1).padStart(3, '0');
        const autoVoucher = `EXP-${dateCompact}-${seq}`;
        const voucherNumber = receiptNumber || autoVoucher;

        const result = db.prepare(`
            INSERT INTO expenditures (expenditure_date, category, description, amount, payment_method, voucher_number, vendor_name, account_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(expenditureDate, category, description, amount, normalizedPaymentMethod, voucherNumber, vendorName || null, accountId || null);
        const expId = result.lastInsertRowid;

        // Look up expense account from expense_category_map, fallback to accountId or 5000
        let expenseAccountId = accountId;
        if (!expenseAccountId && category) {
            const catMap = db.prepare('SELECT account_code FROM expense_category_map WHERE category_name = ?').get(category);
            if (catMap) {
                const acc = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(catMap.account_code);
                if (acc) expenseAccountId = acc.id;
            }
        }
        if (!expenseAccountId) {
            expenseAccountId = db.prepare("SELECT id FROM accounts WHERE account_code = '5000'").get()?.id;
        }

        let paymentAccount = null;
        if (normalizedPaymentMethod === 'bank') {
            if (bankId) {
                const bankRecord = db.prepare('SELECT account_id FROM banks WHERE id = ? AND is_active = 1').get(bankId);
                if (bankRecord?.account_id) {
                    paymentAccount = db.prepare('SELECT id FROM accounts WHERE id = ?').get(bankRecord.account_id);
                }
            }
            if (!paymentAccount) {
                const defaultBank = db.prepare('SELECT account_id FROM banks WHERE is_default = 1 AND is_active = 1').get();
                if (defaultBank?.account_id) {
                    paymentAccount = db.prepare('SELECT id FROM accounts WHERE id = ?').get(defaultBank.account_id);
                }
            }
            if (!paymentAccount) {
                paymentAccount = db.prepare("SELECT id FROM accounts WHERE account_code = '1001'").get();
            }
        } else {
            paymentAccount = db.prepare("SELECT id FROM accounts WHERE account_code = '1000'").get();
        }

        if (expenseAccountId && paymentAccount) {
            const desc = `${category}: ${description}${vendorName ? ' (' + vendorName + ')' : ''}`;

            const jeResult = db.prepare(
                "INSERT INTO journal_entries (entry_date, description, voucher_number, reference_type, reference_id) VALUES (?, ?, ?, 'expenditure', ?)"
            ).run(expenditureDate, desc, voucherNumber, expId);
            const jeId = jeResult.lastInsertRowid;

            db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)').run(jeId, expenseAccountId, amount);
            db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)').run(jeId, paymentAccount.id, amount);

            db.prepare("INSERT INTO ledger_entries (entry_date, description, voucher_number, reference_type, reference_id, debit_account_id, amount, journal_entry_id) VALUES (?, ?, ?, 'expenditure', ?, ?, ?, ?)")
                .run(expenditureDate, desc, voucherNumber, expId, expenseAccountId, amount, jeId);
            db.prepare("INSERT INTO ledger_entries (entry_date, description, voucher_number, reference_type, reference_id, credit_account_id, amount, journal_entry_id) VALUES (?, ?, ?, 'expenditure', ?, ?, ?, ?)")
                .run(expenditureDate, desc, voucherNumber, expId, paymentAccount.id, amount, jeId);

            db.prepare('INSERT INTO cashbook_entries (entry_date, description, voucher_number, cash_out, bank_out, journal_entry_id) VALUES (?, ?, ?, ?, ?, ?)')
                .run(expenditureDate, desc, voucherNumber,
                    normalizedPaymentMethod === 'cash' ? amount : 0,
                    normalizedPaymentMethod === 'bank' ? amount : 0,
                    jeId);

            db.prepare('UPDATE expenditures SET journal_entry_id = ?, account_id = ? WHERE id = ?').run(jeId, expenseAccountId, expId);
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
        let paymentAccount = null;
        if (exp.journal_entry_id) {
            paymentAccount = db.prepare(`
                SELECT account_id as id
                FROM journal_lines
                WHERE journal_entry_id = ? AND credit > 0
                ORDER BY id ASC
                LIMIT 1
            `).get(exp.journal_entry_id);
        }
        if (!paymentAccount) {
            const fallbackCode = exp.payment_method === 'bank' ? '1001' : '1000';
            paymentAccount = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(fallbackCode);
        }

        // Look up by stored account_id first, then by category name match, then fall back to 5000
        const expenseAccount =
            (exp.account_id && db.prepare('SELECT id FROM accounts WHERE id = ?').get(exp.account_id)) ||
            db.prepare('SELECT id FROM accounts WHERE account_name LIKE ?').get(`%${exp.category}%`) ||
            db.prepare("SELECT id FROM accounts WHERE account_code = '5000'").get();

        if (!paymentAccount) throw new Error(`Cash/bank account not found for payment method: ${exp.payment_method}`);
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
            db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)').run(jeId, paymentAccount.id, exp.amount);

            db.prepare("INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, credit_account_id, amount, journal_entry_id) VALUES (?, ?, 'expenditure_reversal', ?, ?, ?, ?)")
                .run(today, desc, id, expenseAccount.id, exp.amount, jeId);
            db.prepare("INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, debit_account_id, amount, journal_entry_id) VALUES (?, ?, 'expenditure_reversal', ?, ?, ?, ?)")
                .run(today, desc, id, paymentAccount.id, exp.amount, jeId);

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
    const defaults = ['Salaries & Wages', 'Maintenance & Repairs', 'Utilities', 'Stationery & Office', 'Security', 'Gardening', 'Generator & Fuel', 'Legal & Professional', 'Gate Tool Tax', 'Bank Charges', 'Miscellaneous'];
    return [...new Set([...defaults, ...used])].sort();
});

ipcMain.handle('db:get-expense-category-master', () => {
    const db = getDb();
    return db.prepare(`
        SELECT ecm.category_name, ecm.account_code, a.account_name, a.id as account_id
        FROM expense_category_map ecm
        LEFT JOIN accounts a ON a.account_code = ecm.account_code
        ORDER BY ecm.category_name
    `).all();
});

ipcMain.handle('db:add-expense-ledger-header', (_e, { name }) => {
    const db = getDb();
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Header name is required');

    return db.transaction(() => {
        const existsCategory = db.prepare('SELECT id FROM expense_category_map WHERE lower(category_name) = lower(?)').get(cleanName);
        if (existsCategory) throw new Error('This expense header already exists');

        const existingAccount = db.prepare(`
            SELECT id, account_code
            FROM accounts
            WHERE lower(account_name) = lower(?)
            LIMIT 1
        `).get(cleanName);

        let accountCode;
        let accountId;
        if (existingAccount) {
            accountCode = existingAccount.account_code;
            accountId = existingAccount.id;
            db.prepare(`
                UPDATE accounts
                SET account_type = 'expense', normal_balance = 'debit', is_active = 1
                WHERE id = ?
            `).run(accountId);
        } else {
            const lastCode = db.prepare(`
                SELECT account_code
                FROM accounts
                WHERE account_type = 'expense' AND account_code GLOB '[0-9]*'
                ORDER BY CAST(account_code AS INTEGER) DESC
                LIMIT 1
            `).get();

            const nextCode = Math.max(5000, Number(lastCode?.account_code || 5039) + 1);
            accountCode = String(nextCode);

            const inserted = db.prepare(`
                INSERT INTO accounts (account_code, account_name, account_type, normal_balance, is_active)
                VALUES (?, ?, 'expense', 'debit', 1)
            `).run(accountCode, cleanName);
            accountId = inserted.lastInsertRowid;
        }

        db.prepare(`
            INSERT INTO expense_category_map (category_name, account_code)
            VALUES (?, ?)
        `).run(cleanName, accountCode);

        writeAuditLog(db, 'expense_category_map', cleanName, 'CREATE', {
            category_name: cleanName,
            account_code: accountCode,
        });

        return { success: true, accountCode, accountId, categoryName: cleanName };
    })();
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


ipcMain.handle('db:generate-monthly-bills', (_e, { billingMonth, notice }) => {
    const db = getDb();
    const plots = db.prepare('SELECT * FROM plots WHERE is_deleted = 0').all();
    const templates = db.prepare('SELECT * FROM bill_templates WHERE is_active = 1 ORDER BY sort_order').all();
    const settingsMap = {};
    for (const s of db.prepare('SELECT key, value FROM settings').all()) settingsMap[s.key] = s.value;

    const prefix = settingsMap['bill_number_prefix'] || 'RV-';
    const dueDays = parseInt(settingsMap['default_due_days'] || '15');
    const tenantChallanAmount = parseFloat(settingsMap['tenant_challan_amount'] || '2500');
    let generated = 0;

    const MONTHLY_CHARGE_MAP = {};
    try {
        const chargeMapRows = db.prepare('SELECT charge_name, account_code FROM charge_account_map').all();
        for (const r of chargeMapRows) MONTHLY_CHARGE_MAP[r.charge_name] = r.account_code;
    } catch {
        Object.assign(MONTHLY_CHARGE_MAP, {
            'Monthly Contribution': '4000',
                'Contribution for Commercial property - Rs. 1500/- per month for vacant and single story': '4000',
                'Contribution for Commercial property': '4000',
                'Base Contribution': '4000',
            'Monthly Tenant Challan': '4004',
                'Contribution for Mosque': '4001',
                'Mosque Contribution': '4001',
            'Mosque Fund': '4001',
                'Contribution for garbage collection if upper stories are used for residential purpose': '4002',
                'Garbage Collection': '4002',
            'Garbage Charges': '4002',
                'Contribution for Aquifer if water connection is provided': '4003',
                'Aquifer Contribution': '4003',
            'Aquifer Charges': '4003',
                'Contribution for each constructed story other than ground floor': '4000',
                'Per Extra Floor': '4000',
        });
    }

    const receivableAccount = db.prepare("SELECT id FROM accounts WHERE account_code = '1200'").get();

    // Enforce month locking — refuse to generate bills for a locked month
    const isLocked = db.prepare('SELECT id FROM locked_months WHERE billing_month = ?').get(billingMonth);
    if (isLocked) throw new Error(`${billingMonth} is locked. Unlock it before generating bills.`);

    db.transaction(() => {
        for (const plot of plots) {
            const owner = db.prepare("SELECT member_id FROM plot_ownership WHERE plot_id = ? AND (end_date IS NULL OR end_date = '') ORDER BY start_date DESC, id DESC LIMIT 1").get(plot.id);
            const existing = db.prepare("SELECT id FROM bills WHERE plot_id = ? AND billing_month = ? AND bill_type = 'monthly' AND is_deleted = 0").get(plot.id, billingMonth);
            if (!existing) {
                const items = [];

                for (const t of templates.filter(t => t.plot_type === plot.plot_type)) {
                    if (/mosque/i.test(t.charge_name) && !plot.has_mosque_contribution) {
                        continue;
                    }

                    // Safety fallback for legacy/misaligned template metadata.
                    // If aquifer is configured but condition flags are incorrect in DB,
                    // still honor water-connection-based inclusion for commercial plots.
                    if (plot.plot_type === 'commercial' && /aquifer/i.test(t.charge_name)) {
                        if (plot.has_water_connection) {
                            items.push({ charge_name: t.charge_name, amount: t.amount });
                        }
                        continue;
                    }

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

                if (items.length > 0) {
                    const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
                    const arrears = sumStoredArrears(db, { plotId: plot.id, billingMonth });
                    const total = subtotal + arrears;
                    const billDate  = billingMonth + '-01';
                    const dueDate   = new Date(billDate);
                    dueDate.setDate(dueDate.getDate() + dueDays);
                    const dueDateStr = dueDate.toISOString().split('T')[0];
                    const seq = String((db.prepare('SELECT COUNT(*) as c FROM bills WHERE billing_month = ?').get(billingMonth)?.c || 0) + 1).padStart(3, '0');
                    const billNumber = `${prefix}${billingMonth}-${seq}`;

                    const result = db.prepare(`
                        INSERT INTO bills (bill_number, plot_id, member_id, bill_type, bill_date, due_date,
                        billing_month, subtotal, arrears, total_amount, balance_due, status, notice)
                        VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)
                    `).run(billNumber, plot.id, owner?.member_id || null,
                        billDate, dueDateStr, billingMonth,
                        subtotal,
                        arrears,
                        total,
                        total,
                        notice || null
                    );

                    const billId = result.lastInsertRowid;
                    const insertItem = db.prepare('INSERT INTO bill_items (bill_id, charge_name, amount, is_custom) VALUES (?, ?, ?, 0)');
                    for (const item of items) insertItem.run(billId, item.charge_name, item.amount);
                    if (arrears > 0.01) insertItem.run(billId, 'Arrears', arrears);

                    // Link monthly member fees to Member Receivables (accrual posting).
                    if ((subtotal || 0) > 0.01 && receivableAccount?.id) {
                        const billDateForPosting = billDate;
                        const jeResult = db.prepare(
                            "INSERT INTO journal_entries (entry_date, description, reference_type, reference_id) VALUES (?, ?, 'bill_generation', ?)"
                        ).run(
                            billDateForPosting,
                            `Monthly bill generated for Plot ${plot.plot_number} (${billingMonth})`,
                            billId
                        );
                        const jeId = jeResult.lastInsertRowid;

                        db.prepare(
                            'INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)'
                        ).run(jeId, receivableAccount.id, subtotal);

                        db.prepare(
                            "INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, debit_account_id, amount, journal_entry_id) VALUES (?, ?, 'bill_generation', ?, ?, ?, ?)"
                        ).run(
                            billDateForPosting,
                            `Monthly bill generated for Plot ${plot.plot_number}`,
                            billId,
                            receivableAccount.id,
                            subtotal,
                            jeId
                        );

                        const creditsByAccount = {};
                        for (const item of items) {
                            const accountCode = MONTHLY_CHARGE_MAP[item.charge_name] || '4000';
                            creditsByAccount[accountCode] = (creditsByAccount[accountCode] || 0) + Number(item.amount || 0);
                        }

                        for (const [accountCode, amountValue] of Object.entries(creditsByAccount)) {
                            if (amountValue < 0.005) continue;
                            const creditAcc = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(accountCode);
                            if (!creditAcc) continue;
                            db.prepare(
                                'INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)'
                            ).run(jeId, creditAcc.id, amountValue);
                            db.prepare(
                                "INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, credit_account_id, amount, journal_entry_id) VALUES (?, ?, 'bill_generation', ?, ?, ?, ?)"
                            ).run(
                                billDateForPosting,
                                `Monthly bill generated for Plot ${plot.plot_number}`,
                                billId,
                                creditAcc.id,
                                amountValue,
                                jeId
                            );
                        }
                    }

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
                    const tenantItems = [];

                    // Keep tenant bill structure consistent each month.
                    tenantItems.push({ charge_name: 'Monthly Tenant Challan', amount: tenantChallanAmount });

                    const templateByName = (name) =>
                        templates.find((t) => t.plot_type === plot.plot_type && t.charge_name === name);

                    const mosqueTemplate = templateByName('Contribution for Mosque') || templateByName('Mosque Contribution');
                    const aquiferTemplate = templateByName('Contribution for Aquifer if water connection is provided') || templateByName('Aquifer Contribution');
                    const garbageTemplate = templateByName('Contribution for garbage collection if upper stories are used for residential purpose') || templateByName('Garbage Collection');

                    if (mosqueTemplate) tenantItems.push({ charge_name: mosqueTemplate.charge_name, amount: mosqueTemplate.amount });
                    if (aquiferTemplate) tenantItems.push({ charge_name: aquiferTemplate.charge_name, amount: aquiferTemplate.amount });
                    if (garbageTemplate) tenantItems.push({ charge_name: garbageTemplate.charge_name, amount: garbageTemplate.amount });

                    const subtotal = tenantItems.reduce((sum, i) => sum + i.amount, 0);
                    const arrears = sumStoredArrears(db, { tenantId: tenant.id, billingMonth, billType: 'tenant' });
                    const total = subtotal + arrears;

                    const billDate = billingMonth + '-01';
                    const dueDate = new Date(billDate);
                    dueDate.setDate(dueDate.getDate() + dueDays);
                    const seq = String((db.prepare('SELECT COUNT(*) as c FROM bills WHERE billing_month = ?').get(billingMonth)?.c || 0) + 1).padStart(3, '0');
                    const tenantBillResult = db.prepare(`
                        INSERT INTO bills (bill_number, plot_id, member_id, tenant_id, bill_type, bill_date, due_date,
                        billing_month, subtotal, arrears, total_amount, balance_due, status, notice)
                        VALUES (?, ?, ?, ?, 'tenant', ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)
                    `).run(
                        `${prefix}${billingMonth}-${seq}-T`,
                        plot.id,
                        owner?.member_id || null,
                        tenant.id,
                        billDate,
                        dueDate.toISOString().split('T')[0],
                        billingMonth,
                        subtotal,
                        arrears,
                        total,
                        total,
                        notice || null
                    );

                    const insertTenantItem = db.prepare('INSERT INTO bill_items (bill_id, charge_name, amount, is_custom) VALUES (?, ?, ?, 0)');
                    for (const item of tenantItems) {
                        insertTenantItem.run(tenantBillResult.lastInsertRowid, item.charge_name, item.amount);
                    }
                    if (arrears > 0.01) insertTenantItem.run(tenantBillResult.lastInsertRowid, 'Arrears', arrears);

                    // Tenant monthly challan accrual: debit receivable, credit mapped revenue.
                    if ((subtotal || 0) > 0.01 && receivableAccount?.id) {
                        const tenantBillId = tenantBillResult.lastInsertRowid;
                        const jeResult = db.prepare(
                            "INSERT INTO journal_entries (entry_date, description, reference_type, reference_id) VALUES (?, ?, 'bill_generation', ?)"
                        ).run(
                            billDate,
                            `Tenant bill generated for Plot ${plot.plot_number} (${billingMonth})`,
                            tenantBillId
                        );
                        const jeId = jeResult.lastInsertRowid;

                        db.prepare(
                            'INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)'
                        ).run(jeId, receivableAccount.id, subtotal);

                        db.prepare(
                            "INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, debit_account_id, amount, journal_entry_id) VALUES (?, ?, 'bill_generation', ?, ?, ?, ?)"
                        ).run(
                            billDate,
                            `Tenant bill generated for Plot ${plot.plot_number}`,
                            tenantBillId,
                            receivableAccount.id,
                            subtotal,
                            jeId
                        );

                        const creditsByAccount = {};
                        for (const item of tenantItems) {
                            const accountCode = MONTHLY_CHARGE_MAP[item.charge_name] || '4000';
                            creditsByAccount[accountCode] = (creditsByAccount[accountCode] || 0) + Number(item.amount || 0);
                        }

                        for (const [accountCode, amountValue] of Object.entries(creditsByAccount)) {
                            if (amountValue < 0.005) continue;
                            const creditAcc = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(accountCode);
                            if (!creditAcc) continue;
                            db.prepare(
                                'INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)'
                            ).run(jeId, creditAcc.id, amountValue);
                            db.prepare(
                                "INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, credit_account_id, amount, journal_entry_id) VALUES (?, ?, 'bill_generation', ?, ?, ?, ?)"
                            ).run(
                                billDate,
                                `Tenant bill generated for Plot ${plot.plot_number}`,
                                tenantBillId,
                                creditAcc.id,
                                amountValue,
                                jeId
                            );
                        }
                    }
                    generated++;
                }
            }
        }

    })();
    return { generated, month: billingMonth };
});

// ── One-time fix: redistribute Arrears bill_items into per-charge rows ────────
// Safe to run multiple times — checks before touching each bill
ipcMain.handle('db:fix-arrears-bill-items', () => {
  const db = getDb();

  // Find all bills that still have an "Arrears (Previous Balance)" bill_item row
  const badBills = db.prepare(`
    SELECT DISTINCT b.id, b.plot_id, b.billing_month, b.subtotal, b.arrears, b.total_amount
    FROM bills b
    JOIN bill_items bi ON bi.bill_id = b.id
    WHERE bi.charge_name LIKE '%Arrears%'
      AND b.is_deleted = 0
  `).all();

  let fixed = 0;
  const errors = [];

  db.transaction(() => {
    for (const bill of badBills) {
      try {
        // Get current charge items (excluding arrears + late fee rows)
        const chargeItems = db.prepare(`
          SELECT id, charge_name, amount FROM bill_items
          WHERE bill_id = ?
            AND charge_name NOT LIKE '%Arrears%'
            AND charge_name NOT LIKE '%Late Fee%'
        `).all(bill.id);

        if (chargeItems.length === 0) continue;

        // Get per-charge historical owed from all PREVIOUS unpaid bills
        const historicalByCharge = db.prepare(`
          SELECT
            bi.charge_name,
            COALESCE(SUM(
              CASE WHEN b.subtotal > 0
                THEN bi.amount * (b.balance_due / b.subtotal)
                ELSE 0
              END
            ), 0) as owed
          FROM bill_items bi
          JOIN bills b ON bi.bill_id = b.id
          WHERE b.plot_id = ?
            AND b.billing_month < ?
            AND b.balance_due > 0.01
            AND b.is_deleted = 0
            AND bi.charge_name NOT LIKE '%Arrears%'
            AND bi.charge_name NOT LIKE '%Late Fee%'
          GROUP BY bi.charge_name
        `).all(bill.plot_id, bill.billing_month);

        const historicalMap = {};
        for (const row of historicalByCharge) {
          historicalMap[row.charge_name] = row.owed || 0;
        }

        const updateItem = db.prepare(
          'UPDATE bill_items SET amount = ? WHERE id = ?'
        );
        const insertItem = db.prepare(
          'INSERT INTO bill_items (bill_id, charge_name, amount) VALUES (?, ?, ?)'
        );

        // Update each existing charge row: add its historical portion
        for (const item of chargeItems) {
          const historical = historicalMap[item.charge_name] || 0;
          if (historical > 0.01) {
            updateItem.run(item.amount + historical, item.id);
          }
          // Remove from map so we know it was handled
          delete historicalMap[item.charge_name];
        }

        // Any historical charges not in current bill (old charge type)
        // get their own new row
        for (const [charge_name, owed] of Object.entries(historicalMap)) {
          if (owed > 0.01) {
            insertItem.run(bill.id, charge_name, owed);
          }
        }

        // Delete the arrears row — now redistributed
        db.prepare(`
          DELETE FROM bill_items
          WHERE bill_id = ? AND charge_name LIKE '%Arrears%'
        `).run(bill.id);

        fixed++;
      } catch (e) {
        errors.push(`Bill ${bill.id}: ${e.message}`);
      }
    }
  })();

  return { fixed, total: badBills.length, errors };
});

// ── Bills ─────────────────────────────────────────────────────
ipcMain.handle('db:get-bills', (_e, filters) => {
    const db = getDb();
    let query = `
        SELECT b.*, p.plot_number, m.name as owner_name, t.name as tenant_name,
               (SELECT GROUP_CONCAT(bi.charge_name, ', ') FROM bill_items bi WHERE bi.bill_id = b.id) as charge_name
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
        SELECT b.*, p.plot_number, p.marla_size, p.plot_type, p.commercial_floors, m.name as owner_name, m.phone, m.address
        FROM bills b LEFT JOIN plots p ON b.plot_id = p.id LEFT JOIN members m ON b.member_id = m.id WHERE b.id = ?
    `).get(billId);
    const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id').all(billId);
    const payments = db.prepare('SELECT * FROM payments WHERE bill_id = ? ORDER BY payment_date DESC').all(billId);
    const adjustments = db.prepare(`
        SELECT a.*, u.display_name as created_by_name, u.username as created_by_username
        FROM adjustments a
        LEFT JOIN users u ON u.id = a.created_by
        WHERE a.bill_id = ?
        ORDER BY a.created_at DESC, a.id DESC
    `).all(billId);
    const adjustmentTotal = adjustments.reduce((sum, row) => sum + (row.amount || 0), 0);
    return {
        bill,
        items,
        payments,
        adjustments,
        summary: {
            subtotal: bill?.subtotal || 0,
            adjustmentTotal,
            totalAmount: bill?.total_amount || 0,
            amountPaid: bill?.amount_paid || 0,
            balanceDue: bill?.balance_due || 0,
        }
    };
});

ipcMain.handle('db:add-custom-bill-item', (_e, { billId, chargeName, amount }) => {
    const db = getDb();
    const bill = db.prepare('SELECT status FROM bills WHERE id = ?').get(billId);
    if (!bill) throw new Error('Bill not found');
    if (bill.status === 'paid') throw new Error('Cannot modify a paid bill');
    throw new Error('Bills are immutable after generation');
});

ipcMain.handle('db:add-adjustment', (_e, { billId, amount, reason, createdBy }) => {
    const db = getDb();
    const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND is_deleted = 0').get(billId);
    if (!bill) throw new Error('Bill not found');
    if (bill.status === 'voided') throw new Error('Cannot adjust a voided bill');

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) < 0.01) {
        throw new Error('Enter a valid adjustment amount');
    }

    const note = String(reason || '').trim();
    if (!note) throw new Error('Reason is required');

    return db.transaction(() => {
        const result = db.prepare(`
            INSERT INTO adjustments (bill_id, house_id, amount, reason, created_by)
            VALUES (?, ?, ?, ?, ?)
        `).run(billId, bill.plot_id, numericAmount, note, createdBy || null);

        writeAuditLog(db, 'adjustments', result.lastInsertRowid, 'CREATE', {
            billId,
            houseId: bill.plot_id,
            amount: numericAmount,
            reason: note,
            createdBy: createdBy || null,
        });

        return syncBillTotals(db, billId);
    })();
});

ipcMain.handle('db:void-bill', (_e, { billId, reason, voidedBy }) => {
    const db = getDb();
    const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND is_deleted = 0').get(billId);
    if (!bill) throw new Error('Bill not found');
    if (bill.status === 'voided') throw new Error('Bill is already voided');

    const note = String(reason || '').trim();
    if (!note) throw new Error('Reason is required');

    return db.transaction(() => {
        db.prepare(`
            UPDATE bills SET
                status = 'voided',
                balance_due = 0,
                void_reason = ?,
                voided_by = ?,
                voided_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(note, voidedBy || null, billId);

        writeAuditLog(db, 'bills', billId, 'VOID', {
            reason: note,
            voidedBy: voidedBy || null,
        });

        return { success: true };
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
ipcMain.handle('db:record-payment', (_e, { billId, amount, paymentMethod, bankId, receiptNumber, notes }) => {
  const db = getDb();

    // Backward-compatible guard: older DB files may miss this column if they skipped migrations.
    const hasBankIdColumn = db.prepare(`
        SELECT 1
        FROM pragma_table_info('payments')
        WHERE name = 'bank_id'
    `).get();
    if (!hasBankIdColumn) {
        db.exec(`ALTER TABLE payments ADD COLUMN bank_id INTEGER REFERENCES banks(id)`);
    }

  return db.transaction(() => {
                const normalizedPaymentMethod = paymentMethod === 'cash' ? 'cash' : 'bank';

    const bill = db.prepare(`
      SELECT b.*, p.plot_number, p.id as pid
      FROM bills b LEFT JOIN plots p ON b.plot_id = p.id
      WHERE b.id = ?
    `).get(billId);
    if (!bill) throw new Error('Bill not found');
    if (bill.status === 'voided') throw new Error('Cannot record payment on a voided bill');

        let selectedBank = null;
        if (normalizedPaymentMethod === 'bank') {
            if (!bankId) throw new Error('Select a bank account for bank payments');
            selectedBank = db.prepare(`
                SELECT b.*, a.account_code, a.account_name as linked_account_name
                FROM banks b
                LEFT JOIN accounts a ON b.account_id = a.id
                WHERE b.id = ? AND b.is_active = 1
            `).get(bankId);
            if (!selectedBank) throw new Error('Selected bank was not found');
            if (!selectedBank.account_id) throw new Error('Selected bank is not linked to an account');
        }

    // ── Receipt number ──────────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    const receiptPrefix = db.prepare(
      "SELECT value FROM settings WHERE key = 'receipt_prefix'"
    ).get()?.value || 'REC-';
    const dateCompact = today.replace(/-/g, '');
    const seqRow = db.prepare(
      "SELECT COUNT(*) as c FROM payments WHERE payment_date = date('now')"
    ).get();
    const seq = String((seqRow?.c || 0) + 1).padStart(3, '0');
    const finalReceipt = receiptNumber || `${receiptPrefix}${dateCompact}-${seq}`;

    // ── Insert master payment ────────────────────────────────
    const payResult = db.prepare(`
            INSERT INTO payments (bill_id, payment_date, amount, payment_method, bank_id, receipt_number, notes)
            VALUES (?, date('now'), ?, ?, ?, ?, ?)
                `).run(billId, amount, normalizedPaymentMethod, selectedBank?.id || null, finalReceipt, notes || null);
    const paymentId = payResult.lastInsertRowid;

    // ── Build charge → account map from DB (dynamic, respects future edits) ──
    // Fallback to default if table doesn't exist yet (before migration runs)
    const CHARGE_MAP = {};
    try {
      const chargeMapRows = db.prepare('SELECT charge_name, account_code FROM charge_account_map').all();
      for (const r of chargeMapRows) CHARGE_MAP[r.charge_name] = r.account_code;
    } catch (_) {
      // Table doesn't exist yet — use defaults until migration 15 runs
      Object.assign(CHARGE_MAP, {
        'Monthly Contribution': '4000',
                'Contribution for Commercial property - Rs. 1500/- per month for vacant and single story': '4000',
                'Contribution for Commercial property': '4000',
                'Base Contribution': '4000',
        'Monthly Tenant Challan': '4004',
                'Contribution for Mosque': '4001',
                'Mosque Contribution': '4001',
        'Mosque Fund': '4001',
                'Contribution for garbage collection if upper stories are used for residential purpose': '4002',
                'Garbage Collection': '4002',
        'Garbage Charges': '4002',
                'Contribution for Aquifer if water connection is provided': '4003',
                'Aquifer Contribution': '4003',
        'Aquifer Charges': '4003',
                'Contribution for each constructed story other than ground floor': '4000',
                'Per Extra Floor': '4000',
      });
    }

    // ── FIFO: all unpaid bills for this plot, oldest first ───
    const unpaidBills = db.prepare(`
      SELECT * FROM bills
      WHERE plot_id = ? AND balance_due > 0.01 AND is_deleted = 0
      ORDER BY billing_month ASC, id ASC
    `).all(bill.plot_id);

    let remaining = amount;
    
    // ── Journal entry (one per payment, multiple credit lines) ──
        const debitAccountCode = normalizedPaymentMethod === 'cash'
            ? '1000'
            : selectedBank?.account_code || '1001';
        const debitAccount = normalizedPaymentMethod === 'cash'
            ? db.prepare('SELECT id FROM accounts WHERE account_code = ?').get('1000')
            : db.prepare('SELECT id FROM accounts WHERE id = ?').get(selectedBank.account_id);

        const desc = normalizedPaymentMethod === 'cash'
            ? `Payment received — Plot ${bill.plot_number} (${finalReceipt})`
            : `Payment received via ${selectedBank.bank_name} — Plot ${bill.plot_number} (${finalReceipt})`;
    const jeResult = db.prepare(`
      INSERT INTO journal_entries
        (entry_date, description, voucher_number, reference_type, reference_id)
      VALUES (?, ?, ?, 'payment', ?)
    `).run(today, desc, finalReceipt, paymentId);
    const jeId = jeResult.lastInsertRowid;

    // Dr. Cash/Bank — full payment amount
    if (debitAccount) {
      db.prepare(
        'INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)'
      ).run(jeId, debitAccount.id, amount);
    }

    // ── Accumulate credit lines per account (merge across bills) ──
    // accountCode → total credit amount
    const creditAccumulator = {};

    const addCredit = (accountCode, creditAmount) => {
      if (!accountCode || creditAmount < 0.005) return;
      creditAccumulator[accountCode] = (creditAccumulator[accountCode] || 0) + creditAmount;
    };

    // ── Process each bill FIFO ───────────────────────────────
    for (const ub of unpaidBills) {
      if (remaining <= 0.01) break;

      const apply = Math.min(remaining, ub.balance_due);
      remaining -= apply;

      // Record allocation
      db.prepare(
        'INSERT INTO payment_allocations (payment_id, bill_id, amount_applied) VALUES (?, ?, ?)'
      ).run(paymentId, ub.id, apply);

      // Update bill balance
      const newPaid    = (ub.amount_paid || 0) + apply;
      const newBalance = Math.max(0, ub.total_amount - newPaid);
      const newStatus  = newBalance <= 0.01 ? 'paid' : 'partial';

      db.prepare(`
        UPDATE bills
        SET amount_paid = ?, balance_due = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newPaid, newBalance, newStatus, ub.id);

            // Monthly owner bills clear receivable (1200) on collection.
            if (ub.bill_type === 'monthly' || ub.bill_type === 'tenant') {
                addCredit('1200', apply);
                continue;
            }

            // ── Split credit proportionally across this bill's charges ──
      // Get bill_items for THIS bill (uses actual amounts, handles old rates)
      const items = db.prepare(`
        SELECT bi.charge_name, bi.amount
        FROM bill_items bi
        WHERE bi.bill_id = ?
          AND bi.charge_name NOT LIKE '%Arrears%'
          AND bi.charge_name NOT LIKE '%Late Fee%'
      `).all(ub.id);

      const itemsTotal = items.reduce((s, i) => s + (i.amount || 0), 0);

      if (items.length > 0 && itemsTotal > 0.01) {
        // Fully paid bill: exact amounts; partial: proportional
        const isFullyPaid = apply >= ub.balance_due - 0.01;

        if (isFullyPaid) {
          // ── Exact allocation — each charge gets its full amount ──
          // But only the portion that was still unpaid on this bill
          const previouslyPaid = ub.amount_paid || 0;
          const prevRatio = Math.min(previouslyPaid / ub.total_amount, 1);

          for (const item of items) {
            // Amount still unpaid for this charge
            const chargeOwed = item.amount * (1 - prevRatio);
            const accountCode = CHARGE_MAP[item.charge_name] || '4000';
            addCredit(accountCode, chargeOwed);
          }
        } else {
          // ── Proportional allocation ──────────────────────────────
          // Each charge gets: (charge_amount / items_total) × apply
          let allocated = 0;
          const sortedItems = [...items].sort((a, b) => b.amount - a.amount); // largest first
          
          for (let i = 0; i < sortedItems.length; i++) {
            const item = sortedItems[i];
            const isLast = i === sortedItems.length - 1;
            const accountCode = CHARGE_MAP[item.charge_name] || '4000';
            
            let chargeCredit;
            if (isLast) {
              // Last item absorbs rounding remainder
              chargeCredit = Math.max(0, apply - allocated);
            } else {
              chargeCredit = Math.round((item.amount / itemsTotal) * apply * 100) / 100;
              allocated += chargeCredit;
            }
            addCredit(accountCode, chargeCredit);
          }
        }
      } else {
        // No bill_items found (e.g. legacy bill) — all goes to 4000
        addCredit('4000', apply);
      }
    }

    // ── Write all credit journal lines ──────────────────────
    for (const [accountCode, creditAmount] of Object.entries(creditAccumulator)) {
      if (creditAmount < 0.005) continue;
      const account = db.prepare(
        'SELECT id FROM accounts WHERE account_code = ?'
      ).get(accountCode);
      if (account) {
        db.prepare(
          'INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)'
        ).run(jeId, account.id, creditAmount);
      }
    }

    // ── Ledger + cashbook entries ────────────────────────────
    if (debitAccount) {
      const leResult = db.prepare(`
        INSERT INTO ledger_entries
          (entry_date, description, voucher_number, reference_type, reference_id,
           debit_account_id, amount, journal_entry_id)
        VALUES (?, ?, ?, 'payment', ?, ?, ?, ?)
      `).run(today, desc, finalReceipt, paymentId, debitAccount.id, amount, jeId);

      // One ledger credit line per fund account
      for (const [accountCode, creditAmount] of Object.entries(creditAccumulator)) {
        if (creditAmount < 0.005) continue;
        const account = db.prepare(
          'SELECT id FROM accounts WHERE account_code = ?'
        ).get(accountCode);
        if (account) {
          db.prepare(`
            INSERT INTO ledger_entries
              (entry_date, description, voucher_number, reference_type, reference_id,
               credit_account_id, amount, journal_entry_id)
            VALUES (?, ?, ?, 'payment', ?, ?, ?, ?)
          `).run(today, desc, finalReceipt, paymentId, account.id, creditAmount, jeId);
        }
      }

      db.prepare(`
        INSERT INTO cashbook_entries
          (entry_date, description, receipt_number, cash_in, bank_in,
           journal_entry_id, ledger_entry_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        today, desc, finalReceipt,
        paymentMethod === 'cash' ? amount : 0,
        paymentMethod !== 'cash' ? amount : 0,
        jeId, leResult.lastInsertRowid
      );
    }

    // ── Overpayment → advance credit ────────────────────────
    if (remaining > 0.01) {
      db.prepare(`
        INSERT INTO plot_credits (plot_id, balance, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(plot_id) DO UPDATE SET
          balance    = balance + excluded.balance,
          updated_at = datetime('now')
      `).run(bill.plot_id, remaining);
    }

    writeAuditLog(db, 'payments', paymentId, 'PAYMENT_FIFO', {
            billId, amount, paymentMethod: normalizedPaymentMethod, bankId: selectedBank?.id || null,
      receiptNumber: finalReceipt,
      fundBreakdown: creditAccumulator
    });

    return {
      receiptNumber: finalReceipt,
      advance: remaining > 0.01 ? remaining : 0,
      fundBreakdown: creditAccumulator,
    };
  })();
});

// ── Running Balance ───────────────────────────────────────────
ipcMain.handle('db:get-running-balance', (_e, plotId) => {
  const db = getDb();
  const r = db.prepare(`
    SELECT
      COALESCE(SUM(total_amount), 0) as total_billed,
      COALESCE(SUM(amount_paid),  0) as total_paid,
      COALESCE(SUM(balance_due),  0) as running_balance
    FROM bills
    WHERE plot_id = ? AND is_deleted = 0
  `).get(plotId);
  const credit = db.prepare('SELECT balance FROM plot_credits WHERE plot_id = ?').get(plotId);
  return {
    total_billed:     r?.total_billed     || 0,
    total_paid:       r?.total_paid       || 0,
    running_balance:  r?.running_balance  || 0,
    advance_credit:   credit?.balance     || 0,
  };
});

// ── FIFO Preview (call before posting payment) ────────────────
ipcMain.handle('db:get-payment-preview', (_e, { plotId, amount }) => {
  const db = getDb();
  const unpaidBills = db.prepare(`
    SELECT b.*, p.plot_number
    FROM bills b LEFT JOIN plots p ON b.plot_id = p.id
    WHERE b.plot_id = ? AND b.balance_due > 0.01 AND b.is_deleted = 0
    ORDER BY b.billing_month ASC, b.id ASC
  `).all(plotId);

  let remaining = amount;
  const breakdown = [];

  for (const b of unpaidBills) {
    if (remaining <= 0.01) break;
    const apply   = Math.min(remaining, b.balance_due);
    const leftover = b.balance_due - apply;
    breakdown.push({
      bill_id:       b.id,
      bill_number:   b.bill_number,
      billing_month: b.billing_month,
      bill_type:     b.bill_type,
      balance_due:   b.balance_due,
      amount_applied: apply,
      remaining_after: leftover,
      fully_cleared:  leftover <= 0.01,
    });
    remaining -= apply;
  }

  return {
    breakdown,
    total_applied: amount - remaining,
    advance_credit: remaining > 0.01 ? remaining : 0,
  };
});

// ── Defaulters List ───────────────────────────────────────────
ipcMain.handle('db:get-defaulters-list', () => {
  const db = getDb();
  return db.prepare(`
    SELECT
      p.id as plot_id,
      p.plot_number,
      p.plot_type,
      m.name  as owner_name,
      m.phone as owner_phone,
      COALESCE(SUM(b.total_amount), 0) as total_billed,
      COALESCE(SUM(b.amount_paid),  0) as total_paid,
      COALESCE(SUM(b.balance_due),  0) as running_balance,
      COUNT(CASE WHEN b.balance_due > 0.01 THEN 1 END) as unpaid_bills,
      MIN(CASE WHEN b.balance_due > 0.01 THEN b.billing_month END) as oldest_unpaid_month,
      MAX(CASE WHEN b.balance_due > 0.01 THEN b.billing_month END) as latest_unpaid_month
    FROM plots p
    LEFT JOIN plot_ownership po ON po.plot_id = p.id AND po.end_date IS NULL
    LEFT JOIN members m ON m.id = po.member_id
    LEFT JOIN bills b ON b.plot_id = p.id AND b.is_deleted = 0
    WHERE p.is_deleted = 0
    GROUP BY p.id
    HAVING running_balance > 0.01
    ORDER BY running_balance DESC
  `).all();
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
ipcMain.handle('db:get-onetime-charges', () => getDb().prepare(`
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
`).all());

ipcMain.handle('db:create-special-bill', (_e, payload) => {
    const db = getDb();
    const { plotId, notes, dueDate } = payload || {};

    const normalizedItems = Array.isArray(payload?.items)
        ? payload.items
            .map((item) => ({
                chargeName: String(item?.chargeName || '').trim(),
                amount: Number(item?.amount || 0),
            }))
            .filter((item) => item.chargeName && item.amount > 0)
        : [];

    // Backward compatibility for old single-item payload.
    if (normalizedItems.length === 0) {
        const legacyChargeName = String(payload?.chargeName || '').trim();
        const legacyAmount = Number(payload?.amount || 0);
        if (legacyChargeName && legacyAmount > 0) {
            normalizedItems.push({ chargeName: legacyChargeName, amount: legacyAmount });
        }
    }

    if (!plotId || normalizedItems.length === 0) {
        throw new Error('Please provide plot and at least one valid special charge');
    }

    const plot = db.prepare('SELECT * FROM plots WHERE id = ? AND is_deleted = 0').get(plotId);
    if (!plot) throw new Error('Plot not found');
    const owner = db.prepare('SELECT member_id FROM plot_ownership WHERE plot_id = ? AND end_date IS NULL').get(plotId);
    const prefix = db.prepare("SELECT value FROM settings WHERE key = 'bill_number_prefix'").get()?.value || 'RV-';
    const seq = String((db.prepare('SELECT COUNT(*) as c FROM bills').get()?.c || 0) + 1).padStart(3, '0');
    const today = new Date().toISOString().split('T')[0];
    const dueDateStr = dueDate || new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    // Keep special bills outside month-uniqueness enforcement.
    // The unique index applies only when billing_month is not null.
    const billingMonth = null;
    const totalAmount = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
    
    return db.transaction(() => {
        const receivableAccount = db.prepare("SELECT id FROM accounts WHERE account_code = '1200'").get();
        const chargeMap = {};
        try {
            const chargeMapRows = db.prepare('SELECT charge_name, account_code FROM charge_account_map').all();
            for (const row of chargeMapRows) chargeMap[row.charge_name] = row.account_code;
        } catch {
            Object.assign(chargeMap, {
                'Others': '4021',
            });
        }

        const hasCustomCharge = db.prepare(`
            SELECT 1
            FROM onetime_charges
            WHERE lower(trim(charge_name)) = lower(trim(?))
        `);
        const upsertCustomCharge = db.prepare(`
            INSERT INTO onetime_charges (
                charge_name, base_amount, is_percentage, percentage_value, varies_by_marla, is_active, notes
            ) VALUES (?, ?, 0, NULL, 0, 1, ?)
            ON CONFLICT(charge_name) DO UPDATE SET
                base_amount = excluded.base_amount,
                is_percentage = excluded.is_percentage,
                percentage_value = excluded.percentage_value,
                varies_by_marla = excluded.varies_by_marla,
                is_active = 1,
                notes = excluded.notes
        `);
        const upsertSpecialChargeMap = db.prepare(`
            INSERT INTO charge_account_map (charge_name, account_code)
            VALUES (?, '4021')
            ON CONFLICT(charge_name) DO UPDATE SET account_code = excluded.account_code
        `);

        for (const item of normalizedItems) {
            const exists = hasCustomCharge.get(item.chargeName);
            if (!exists) {
                upsertCustomCharge.run(item.chargeName, item.amount, 'Custom special charge');
            }
            upsertSpecialChargeMap.run(item.chargeName);
        }

        const result = db.prepare(`
            INSERT INTO bills (bill_number, plot_id, member_id, bill_type, bill_date, due_date, billing_month,
                             subtotal, arrears, total_amount, balance_due, status, notes)
            VALUES (?, ?, ?, 'special', ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)
        `).run(`${prefix}SP-${seq}`, plotId, owner?.member_id || null, today, dueDateStr, billingMonth,
               totalAmount, 0, totalAmount, totalAmount, notes || null);

        const insertItem = db.prepare('INSERT INTO bill_items (bill_id, charge_name, amount) VALUES (?, ?, ?)');
        for (const item of normalizedItems) {
            insertItem.run(result.lastInsertRowid, item.chargeName, item.amount);
        }

        if ((totalAmount || 0) > 0.01 && receivableAccount?.id) {
            const billId = result.lastInsertRowid;
            const billDescription = `Special bill generated for Plot ${plot.plot_number}`;
            const jeResult = db.prepare(
                "INSERT INTO journal_entries (entry_date, description, reference_type, reference_id) VALUES (?, ?, 'bill_generation', ?)"
            ).run(today, billDescription, billId);
            const jeId = jeResult.lastInsertRowid;

            db.prepare(
                'INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)'
            ).run(jeId, receivableAccount.id, totalAmount);

            db.prepare(
                "INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, debit_account_id, amount, journal_entry_id) VALUES (?, ?, 'bill_generation', ?, ?, ?, ?)"
            ).run(today, billDescription, billId, receivableAccount.id, totalAmount, jeId);

            const creditsByAccount = {};
            for (const item of normalizedItems) {
                const accountCode = chargeMap[item.chargeName] || '4000';
                creditsByAccount[accountCode] = (creditsByAccount[accountCode] || 0) + Number(item.amount || 0);
            }

            for (const [accountCode, amountValue] of Object.entries(creditsByAccount)) {
                if (amountValue < 0.005) continue;
                const creditAccount = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(accountCode);
                if (!creditAccount) continue;

                db.prepare(
                    'INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)'
                ).run(jeId, creditAccount.id, amountValue);

                db.prepare(
                    "INSERT INTO ledger_entries (entry_date, description, reference_type, reference_id, credit_account_id, amount, journal_entry_id) VALUES (?, ?, 'bill_generation', ?, ?, ?, ?)"
                ).run(today, billDescription, billId, creditAccount.id, amountValue, jeId);
            }
        }
    })();
});

ipcMain.handle('db:generate-special-bills-all', (_e, payload) => {
    return {
        generated: 0,
        skipped: 0,
        totalPlots: 0,
        billingMonth: payload?.billingMonth || null,
        message: 'Special bill batch generation is disabled while bills are immutable.'
    };
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

ipcMain.handle('db:get-ledger-headings-summary', (_e, { startDate, endDate }) => {
    const db = getDb();
    const start = startDate || '1900-01-01';
    const end = endDate || '2999-12-31';

    return db.prepare(`
        SELECT
            a.id,
            a.account_code,
            a.account_name,
            a.account_type,
            a.normal_balance,
            a.parent_id,
            p.account_name AS parent_name,
            COALESCE(le.total_debit, 0) AS total_debit,
            COALESCE(le.total_credit, 0) AS total_credit,
            COALESCE(le.entry_count, 0) AS entry_count,
            COALESCE(ch.child_count, 0) AS child_count
        FROM accounts a
        LEFT JOIN accounts p ON p.id = a.parent_id
        LEFT JOIN (
            SELECT
                x.account_id,
                SUM(CASE WHEN x.side = 'debit' THEN x.amount ELSE 0 END) AS total_debit,
                SUM(CASE WHEN x.side = 'credit' THEN x.amount ELSE 0 END) AS total_credit,
                COUNT(DISTINCT x.entry_id) AS entry_count
            FROM (
                SELECT id AS entry_id, debit_account_id AS account_id, amount, 'debit' AS side
                FROM ledger_entries
                WHERE entry_date BETWEEN ? AND ?
                UNION ALL
                SELECT id AS entry_id, credit_account_id AS account_id, amount, 'credit' AS side
                FROM ledger_entries
                WHERE entry_date BETWEEN ? AND ?
            ) x
            GROUP BY x.account_id
        ) le ON le.account_id = a.id
        LEFT JOIN (
            SELECT parent_id, COUNT(*) AS child_count
            FROM accounts
            WHERE parent_id IS NOT NULL AND is_active = 1
            GROUP BY parent_id
        ) ch ON ch.parent_id = a.id
        WHERE a.is_active = 1
        ORDER BY a.account_code
    `).all(start, end, start, end).map((row) => ({
        ...row,
        balance: row.normal_balance === 'debit'
            ? Number(row.total_debit || 0) - Number(row.total_credit || 0)
            : Number(row.total_credit || 0) - Number(row.total_debit || 0),
    }));
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
ipcMain.handle('db:get-fund-summary', (_e, { startDate, endDate } = {}) => {
  const db = getDb();

    const normalizeChargeSql = `
        CASE
            WHEN lower(trim(bi.charge_name)) IN ('aquifer charges', 'aquifer contribution', 'contribution for aquifer if water connection is provided') THEN 'Aquifer Contribution'
            WHEN lower(trim(bi.charge_name)) IN ('garbage charges', 'garbage collection', 'contribution for garbage collection if upper stories are used for residential purpose') THEN 'Garbage Collection'
            WHEN lower(trim(bi.charge_name)) IN ('mosque fund', 'mosque contribution', 'contribution for mosque') THEN 'Mosque Contribution'
            WHEN lower(trim(bi.charge_name)) IN (
                'base contribution',
                'contribution for commercial property',
                'contribution for commercial property - rs. 1500/- per month for vacant and single story',
                'per extra floor',
                'contribution for each constructed story other than ground floor'
            ) THEN 'Commercial Contribution'
            WHEN lower(trim(bi.charge_name)) = 'transfer contribution from buyer' THEN 'Transfer Contribution from buyer'
            ELSE trim(bi.charge_name)
        END
    `;

    const sectionSql = `
        CASE
            WHEN b.bill_type IN ('monthly', 'tenant') THEN 'monthly'
            WHEN b.bill_type = 'special' AND b.billing_month IS NOT NULL THEN 'monthly'
            ELSE 'special'
        END
    `;

    const billDateFilter = [];
    const billDateParams = [];
    if (startDate) { billDateFilter.push('b.bill_date >= ?'); billDateParams.push(startDate + '-01'); }
    if (endDate) {
        billDateFilter.push("b.bill_date <= date(? || '-01', 'start of month', '+1 month', '-1 day')");
        billDateParams.push(endDate);
    }
    const whereBillDate = billDateFilter.length > 0 ? ` AND ${billDateFilter.join(' AND ')}` : '';

    const payDateFilter = [];
    const payDateParams = [];
    if (startDate) { payDateFilter.push('p.payment_date >= ?'); payDateParams.push(startDate + '-01'); }
    if (endDate) {
        payDateFilter.push("p.payment_date <= date(? || '-01', 'start of month', '+1 month', '-1 day')");
        payDateParams.push(endDate);
    }
    const wherePayDate = payDateFilter.length > 0 ? ` AND ${payDateFilter.join(' AND ')}` : '';

    const outstandingRows = db.prepare(`
        WITH base_items AS (
            SELECT
                b.id AS bill_id,
                ${sectionSql} AS section,
                ${normalizeChargeSql} AS charge_name,
                bi.amount AS amount,
                b.balance_due
            FROM bills b
            JOIN bill_items bi ON bi.bill_id = b.id
            WHERE b.is_deleted = 0
                AND bi.charge_name NOT LIKE '%Arrears%'
                AND bi.charge_name NOT LIKE '%Late Fee%'
                ${whereBillDate}
        ),
        item_totals AS (
            SELECT bill_id, SUM(amount) AS items_sum
            FROM base_items
            GROUP BY bill_id
        )
        SELECT
            bi.section,
            bi.charge_name,
            COALESCE(SUM(
                CASE
                    WHEN it.items_sum > 0 THEN bi.balance_due * (bi.amount / it.items_sum)
                    ELSE 0
                END
            ), 0) AS total_outstanding
        FROM base_items bi
        JOIN item_totals it ON it.bill_id = bi.bill_id
        GROUP BY bi.section, bi.charge_name
    `).all(...billDateParams);

    const collectedAllocRows = db.prepare(`
        WITH base_items AS (
            SELECT
                b.id AS bill_id,
                ${sectionSql} AS section,
                ${normalizeChargeSql} AS charge_name,
                bi.amount AS amount
            FROM bills b
            JOIN bill_items bi ON bi.bill_id = b.id
            WHERE b.is_deleted = 0
                AND bi.charge_name NOT LIKE '%Arrears%'
                AND bi.charge_name NOT LIKE '%Late Fee%'
        ),
        item_totals AS (
            SELECT bill_id, SUM(amount) AS items_sum
            FROM base_items
            GROUP BY bill_id
        )
        SELECT
            bi.section,
            bi.charge_name,
            COALESCE(SUM(
                CASE
                    WHEN it.items_sum > 0 THEN pa.amount_applied * (bi.amount / it.items_sum)
                    ELSE 0
                END
            ), 0) AS total_collected
        FROM payment_allocations pa
        JOIN payments p ON p.id = pa.payment_id
        JOIN base_items bi ON bi.bill_id = pa.bill_id
        JOIN item_totals it ON it.bill_id = bi.bill_id
        WHERE 1=1 ${wherePayDate}
        GROUP BY bi.section, bi.charge_name
    `).all(...payDateParams);

    const collectedDirectRows = db.prepare(`
        WITH base_items AS (
            SELECT
                b.id AS bill_id,
                ${sectionSql} AS section,
                ${normalizeChargeSql} AS charge_name,
                bi.amount AS amount
            FROM bills b
            JOIN bill_items bi ON bi.bill_id = b.id
            WHERE b.is_deleted = 0
                AND bi.charge_name NOT LIKE '%Arrears%'
                AND bi.charge_name NOT LIKE '%Late Fee%'
        ),
        item_totals AS (
            SELECT bill_id, SUM(amount) AS items_sum
            FROM base_items
            GROUP BY bill_id
        )
        SELECT
            bi.section,
            bi.charge_name,
            COALESCE(SUM(
                CASE
                    WHEN it.items_sum > 0 THEN p.amount * (bi.amount / it.items_sum)
                    ELSE 0
                END
            ), 0) AS total_collected
        FROM payments p
        LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
        JOIN base_items bi ON bi.bill_id = p.bill_id
        JOIN item_totals it ON it.bill_id = bi.bill_id
        WHERE pa.id IS NULL ${wherePayDate}
        GROUP BY bi.section, bi.charge_name
    `).all(...payDateParams);

    const merged = new Map();
    const ensure = (section, charge_name) => {
        const key = `${section}::${charge_name}`;
        if (!merged.has(key)) {
            merged.set(key, {
                section,
                charge_name,
                total_collected: 0,
                total_outstanding: 0,
            });
        }
        return merged.get(key);
    };

    for (const row of outstandingRows) {
        const r = ensure(row.section, row.charge_name);
        r.total_outstanding += Number(row.total_outstanding || 0);
    }
    for (const row of collectedAllocRows) {
        const r = ensure(row.section, row.charge_name);
        r.total_collected += Number(row.total_collected || 0);
    }
    for (const row of collectedDirectRows) {
        const r = ensure(row.section, row.charge_name);
        r.total_collected += Number(row.total_collected || 0);
    }

    return [...merged.values()]
        .map((r) => ({
            ...r,
            total_collected: Math.round(r.total_collected * 100) / 100,
            total_outstanding: Math.round(r.total_outstanding * 100) / 100,
        }))
        .sort((a, b) => {
            if (a.section !== b.section) return a.section.localeCompare(b.section);
            if (b.total_collected !== a.total_collected) return b.total_collected - a.total_collected;
            return a.charge_name.localeCompare(b.charge_name);
        });
});

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

    // Special Challan Income breakdown by charge type
    const scP = []; let scF = '';
    if (startDate) { scF += ' AND b.bill_date >= ?'; scP.push(startDate); }
    if (endDate) { scF += ' AND b.bill_date <= ?'; scP.push(endDate); }
    const specialChargesIncome = db.prepare(`
        SELECT 
            bi.charge_name,
            COUNT(DISTINCT b.id) as bill_count,
            COALESCE(SUM(CASE WHEN b.amount_paid > 0 THEN MIN(bi.amount, b.amount_paid) ELSE 0 END), 0) as collected
        FROM bills b
        JOIN bill_items bi ON bi.bill_id = b.id
        WHERE b.is_deleted = 0 AND b.bill_type = 'special' ${scF}
        GROUP BY bi.charge_name
        HAVING collected > 0
        ORDER BY collected DESC
    `).all(...scP);

    // Expense categories breakdown
    const expP = []; let expF = '';
    if (startDate) { expF += ' AND expenditure_date >= ?'; expP.push(startDate); }
    if (endDate) { expF += ' AND expenditure_date <= ?'; expP.push(endDate); }
    const expenseCategories = db.prepare(`
        SELECT 
            category,
            COUNT(*) as count,
            SUM(amount) as total_amount
        FROM expenditures
        WHERE is_deleted = 0 ${expF}
        GROUP BY category
        ORDER BY total_amount DESC
    `).all(...expP);

    return { 
        revenue, 
        expenses, 
        billRevenue: billRevenue?.total || 0, 
        directExpenses: directExpenses?.total || 0,
        specialChargesIncome,
        expenseCategories
    };
});

// ── Expense Tally Report ──────────────────────────────────────
ipcMain.handle('db:report-expense-tally', (_e, { startDate, endDate } = {}) => {
    const db = getDb();
    const params = [];
    let dateFilter = '';
    if (startDate) { dateFilter += ' AND e.expenditure_date >= ?'; params.push(startDate); }
    if (endDate) { dateFilter += ' AND e.expenditure_date <= ?'; params.push(endDate); }

    // Get expense tally grouped by category
    const byCategory = db.prepare(`
        SELECT 
            e.category,
            COUNT(*) as count,
            SUM(e.amount) as total_amount,
            SUM(CASE WHEN e.payment_method = 'cash' THEN e.amount ELSE 0 END) as cash_amount,
            SUM(CASE WHEN e.payment_method = 'bank' THEN e.amount ELSE 0 END) as bank_amount,
            SUM(CASE WHEN e.payment_method = 'cheque' THEN e.amount ELSE 0 END) as cheque_amount
        FROM expenditures e
        WHERE e.is_deleted = 0 ${dateFilter}
        GROUP BY e.category
        ORDER BY total_amount DESC
    `).all(...params);

    // Get grand totals
    const totals = db.prepare(`
        SELECT 
            COUNT(*) as total_count,
            COALESCE(SUM(amount), 0) as grand_total,
            SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END) as total_cash,
            SUM(CASE WHEN payment_method = 'bank' THEN amount ELSE 0 END) as total_bank,
            SUM(CASE WHEN payment_method = 'cheque' THEN amount ELSE 0 END) as total_cheque
        FROM expenditures
        WHERE is_deleted = 0 ${dateFilter}
    `).get(...params);

    return { byCategory, totals };
});

// ── Special Charges Income Tally Report ───────────────────────
ipcMain.handle('db:report-special-charges-income', (_e, { startDate, endDate } = {}) => {
    const db = getDb();
    const params = [];
    let dateFilter = '';
    if (startDate) { dateFilter += ' AND b.bill_date >= ?'; params.push(startDate); }
    if (endDate) { dateFilter += ' AND b.bill_date <= ?'; params.push(endDate); }

    // Get special charges income grouped by charge name
    const byCharge = db.prepare(`
        SELECT 
            bi.charge_name,
            COUNT(DISTINCT b.id) as bill_count,
            SUM(bi.amount) as total_billed,
            SUM(CASE WHEN b.status = 'paid' THEN bi.amount ELSE 0 END) as total_paid_full,
            SUM(
                CASE 
                    WHEN b.status = 'partial' THEN 
                        ROUND(bi.amount * (b.amount_paid / NULLIF(b.total_amount, 0)), 2)
                    WHEN b.status = 'paid' THEN bi.amount
                    ELSE 0 
                END
            ) as total_collected,
            SUM(
                CASE 
                    WHEN b.status IN ('unpaid', 'partial') THEN 
                        ROUND(bi.amount * (b.balance_due / NULLIF(b.total_amount, 0)), 2)
                    ELSE 0 
                END
            ) as total_outstanding
        FROM bill_items bi
        JOIN bills b ON bi.bill_id = b.id
        WHERE b.bill_type = 'special' AND b.is_deleted = 0 ${dateFilter}
        GROUP BY bi.charge_name
        ORDER BY total_billed DESC
    `).all(...params);

    // Get grand totals
    const totals = db.prepare(`
        SELECT 
            COUNT(DISTINCT b.id) as total_bills,
            COALESCE(SUM(b.total_amount), 0) as grand_billed,
            COALESCE(SUM(b.amount_paid), 0) as grand_collected,
            COALESCE(SUM(b.balance_due), 0) as grand_outstanding
        FROM bills b
        WHERE b.bill_type = 'special' AND b.is_deleted = 0 ${dateFilter}
    `).get(...params);

    return { byCharge, totals };
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

function formatExportHeader(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferWorksheetColumns(keys, data) {
    return keys.map((key) => {
        const longest = data.reduce((max, row) => {
            const value = row[key] === null || row[key] === undefined ? '' : String(row[key]);
            return Math.max(max, value.length);
        }, formatExportHeader(key).length);
        return { width: Math.min(Math.max(longest + 4, 14), 28) };
    });
}

async function writeFormattedWorkbook(filePath, sheetName, title, subtitle, keys, data) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'River View ERP';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(sheetName.slice(0, 31), {
        views: [{ state: 'frozen', ySplit: 4 }],
        pageSetup: {
            margins: {
                left: 0.4,
                right: 0.4,
                top: 0.55,
                bottom: 0.55,
                header: 0.2,
                footer: 0.2,
            },
            orientation: keys.length > 6 ? 'landscape' : 'portrait',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
        },
    });

    const totalColumns = Math.max(keys.length, 1);
    worksheet.mergeCells(1, 1, 1, totalColumns);
    worksheet.getCell(1, 1).value = title;
    worksheet.getCell(1, 1).font = { bold: true, size: 13, name: 'Calibri' };
    worksheet.getCell(1, 1).alignment = { horizontal: 'left', vertical: 'middle' };
    worksheet.getRow(1).height = 22;

    worksheet.mergeCells(2, 1, 2, totalColumns);
    worksheet.getCell(2, 1).value = subtitle;
    worksheet.getCell(2, 1).font = { bold: true, size: 13, name: 'Calibri' };
    worksheet.getCell(2, 1).alignment = { horizontal: 'left', vertical: 'middle' };
    worksheet.getRow(2).height = 20;

    worksheet.mergeCells(3, 1, 3, totalColumns);
    worksheet.getCell(3, 1).value = `Generated: ${new Date().toLocaleDateString('en-PK')} | Records: ${data.length}`;
    worksheet.getCell(3, 1).font = { size: 11, name: 'Calibri' };
    worksheet.getCell(3, 1).alignment = { horizontal: 'left', vertical: 'middle' };
    worksheet.getRow(3).height = 18;

    const headerRow = worksheet.getRow(5);
    const numericColumns = keys
        .map((key, index) => ({ key, index: index + 1 }))
        .filter(({ key }) => data.some((row) => typeof row[key] === 'number'))
        .map(({ index }) => index);

    keys.forEach((key, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = formatExportHeader(key);
        cell.font = { bold: true, size: 13, name: 'Calibri' };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        };
    });
    headerRow.height = 24;

    data.forEach((rowData, rowIndex) => {
        const row = worksheet.getRow(6 + rowIndex);
        keys.forEach((key, columnIndex) => {
            const value = rowData[key] ?? '';
            const cell = row.getCell(columnIndex + 1);
            cell.value = value;
            cell.font = { size: 11, name: 'Calibri' };
            cell.alignment = {
                horizontal: numericColumns.includes(columnIndex + 1) ? 'center' : 'left',
                vertical: 'middle',
            };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            };
            if (typeof value === 'number') {
                cell.numFmt = Number.isInteger(value) ? '#,##0' : '#,##0.00';
            }
        });
        row.height = 21;
    });

    worksheet.columns = inferWorksheetColumns(keys, data);
    await workbook.xlsx.writeFile(filePath);
}

const EXPENDITURE_CATEGORY_HEADERS = [
        'Salaries',
        'Generator / Fuel',
        'Maintenance & Repairs',
        'Utilities',
        'Stationery & Office',
        'Security',
        'Cleaning',
        'Bank Charges',
        'Electricity Bill Tube-well',
        'Electricity Bill Streetlight',
        'Electricity Bill Office',
        'Telephone Bill Office',
        'Telephone Bill Security',
        'Repair & Maintenance Electricity Equipments',
        'Repair & Maintenance Machinery & Equipments',
        'Repair & Maintenance Office & Equipments',
        'Advertisement (AGM)',
        'Books & Periodicals & Newspapers',
        'Oil & Lubricants Expenses',
        'Post & Telegram Contribution',
        'Printing & Stationery Contribution',
        'Audit fee',
        'Professional fee',
        'Punjab Employees Social Security',
        'Travelling & Conveyance Contribution',
        'Tree Plantation',
        'Entertainment',
        'Entertainment AGM',
        'Repair & Maintenance of Building/Boundary wall',
        'Maintenance of Water Pipe Line',
        'Maintenance of Sewerage Pipeline/Gutters',
        'Repair & Maintenance of Internal Roads',
        'Miscellaneous Expenses',
        'Unexpected Expenses',
        'Other',
    ];

function buildStructuredExpenditureExport(rows) {
    // Build column structure: metadata + all category columns
    const keys = [
        'expenditure_date',
        'description',
        'vendor_name',
        'payment_method',
        'receipt_number',
        ...EXPENDITURE_CATEGORY_HEADERS,
    ];

    // Transform each expense row into a multi-column row (one amount per matching category)
    const data = rows.map((item) => {
        const row = {
            expenditure_date: item.expenditure_date || '',
            description: item.description || '',
            vendor_name: item.vendor_name || '',
            payment_method: item.payment_method || '',
            receipt_number: item.receipt_number || '',
        };

        // Initialize all category columns to 0
        for (const header of EXPENDITURE_CATEGORY_HEADERS) {
            row[header] = 0;
        }

        // Place the amount in the matching category column
        const category = item.category || 'Other';
        if (EXPENDITURE_CATEGORY_HEADERS.includes(category)) {
            row[category] = Number(item.amount) || 0;
        } else {
            // Unmapped categories go to "Other"
            row['Other'] = (Number(row['Other']) || 0) + (Number(item.amount) || 0);
        }
        return row;
    });

    // Add totals row
    const totalsRow = {
        expenditure_date: '',
        description: 'TOTAL',
        vendor_name: '',
        payment_method: '',
        receipt_number: '',
    };
    for (const header of EXPENDITURE_CATEGORY_HEADERS) {
        totalsRow[header] = data.reduce((s, r) => s + (Number(r[header]) || 0), 0);
    }
    data.push(totalsRow);

    return { keys, data };
}

async function exportSpreadsheet(tableType) {
    const db = getDb();
    let data = [], defaultFilename = '';
    let customKeys = null;
    if (tableType === 'plots') {
        data = db.prepare('SELECT p.*, m.name as owner_name FROM plots p LEFT JOIN plot_ownership po ON p.id = po.plot_id AND po.end_date IS NULL LEFT JOIN members m ON po.member_id = m.id WHERE p.is_deleted = 0 ORDER BY p.plot_number').all();
        if (data.length > 0) {
            customKeys = Object.keys(data[0]).filter((key) => key !== 'block');
        }
        defaultFilename = 'plots_export.xlsx';
    } else if (tableType === 'members') {
        data = db.prepare('SELECT * FROM members WHERE is_deleted = 0').all();
        defaultFilename = 'members_export.xlsx';
    } else if (tableType === 'bills') {
        data = db.prepare('SELECT b.*, p.plot_number, m.name as member_name FROM bills b JOIN plots p ON b.plot_id = p.id LEFT JOIN members m ON b.member_id = m.id WHERE b.is_deleted = 0 ORDER BY b.bill_date DESC').all();
        defaultFilename = 'bills_export.xlsx';
    } else if (tableType === 'expenditures') {
        const raw = db.prepare('SELECT * FROM expenditures WHERE is_deleted = 0 ORDER BY expenditure_date DESC, id DESC').all();
        const formatted = buildStructuredExpenditureExport(raw);
        data = formatted.data;
        customKeys = formatted.keys;
        defaultFilename = 'expenditures_export.xlsx';
    }
    if (!data || data.length === 0) return { success: false, message: 'No data to export' };
    const { filePath } = await dialog.showSaveDialog({ title: 'Export Data', defaultPath: defaultFilename, filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }] });
    if (!filePath) return { success: false, message: 'Export cancelled' };
    const keys = customKeys || Object.keys(data[0]);
    await writeFormattedWorkbook(filePath, tableType, 'River View Cooperative Housing Society Ltd.', `${formatExportHeader(tableType)} Export`, keys, data);
    return { success: true, path: filePath };
}

ipcMain.handle('db:export-spreadsheet', async (_e, tableType) => exportSpreadsheet(tableType));
ipcMain.handle('db:export-csv', async (_e, tableType) => exportSpreadsheet(tableType));

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
               COALESCE((SELECT SUM(a.amount) FROM adjustments a WHERE a.bill_id = b.id), 0) as adjustment_total,
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
        totalOutstanding: bills.reduce((s, b) => s + (['unpaid', 'partial', 'overdue'].includes(b.status) ? (b.balance_due || 0) : 0), 0),
        unpaidCount: bills.filter(b => ['unpaid', 'partial', 'overdue'].includes(b.status)).length,
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

ipcMain.handle('db:get-cash-bank-transfers', (_e, { startDate, endDate } = {}) => {
    const db = getDb();
    const from = startDate || '1900-01-01';
    const to = endDate || '2999-12-31';

    return db.prepare(`
        SELECT
            ce.id,
            ce.entry_date,
            ce.description,
            ce.cash_in,
            ce.bank_in,
            ce.cash_out,
            ce.bank_out,
            CASE
                WHEN ce.cash_out > 0 AND ce.bank_in > 0 THEN 'cash_to_bank'
                WHEN ce.cash_in > 0 AND ce.bank_out > 0 THEN 'bank_to_cash'
                ELSE 'transfer'
            END AS transfer_type,
            CASE
                WHEN ce.cash_out > 0 AND ce.bank_in > 0 THEN ce.bank_in
                WHEN ce.cash_in > 0 AND ce.bank_out > 0 THEN ce.cash_in
                ELSE 0
            END AS amount,
            COALESCE(b.bank_name, '') AS bank_name
        FROM cashbook_entries ce
        LEFT JOIN journal_lines jl ON jl.journal_entry_id = ce.journal_entry_id AND jl.debit > 0
        LEFT JOIN accounts a ON a.id = jl.account_id
        LEFT JOIN banks b ON b.account_id = a.id
        WHERE (
            (ce.cash_out > 0 AND ce.bank_in > 0)
            OR (ce.cash_in > 0 AND ce.bank_out > 0)
        )
            AND ce.entry_date >= ?
            AND ce.entry_date <= ?
        ORDER BY ce.entry_date DESC, ce.id DESC
        LIMIT 500
    `).all(from, to);
});

// ── Banks Management ─────────────────────────────────────────────
ipcMain.handle('db:get-banks', () => {
    return getDb().prepare(`
        SELECT b.*, a.account_code, a.account_name as linked_account_name
        FROM banks b
        LEFT JOIN accounts a ON b.account_id = a.id
        WHERE b.is_active = 1
        ORDER BY b.is_default DESC, b.bank_name ASC
    `).all();
});

ipcMain.handle('db:get-all-banks', () => {
    return getDb().prepare(`
        SELECT b.*, a.account_code, a.account_name as linked_account_name
        FROM banks b
        LEFT JOIN accounts a ON b.account_id = a.id
        ORDER BY b.is_default DESC, b.bank_name ASC
    `).all();
});

ipcMain.handle('db:add-bank', (_e, { bankName, accountNumber, branchName, branchCode, iban }) => {
    const db = getDb();
    const normalizedBankName = String(bankName || '').trim();
    if (!normalizedBankName) throw new Error('Bank name is required');

    return db.transaction(() => {
        // Generate next account code for bank (1001, 1002, 1003...)
        const lastBankAccount = db.prepare(`
            SELECT account_code FROM accounts 
            WHERE account_code LIKE '100%' AND account_type = 'asset'
            ORDER BY account_code DESC LIMIT 1
        `).get();
        
        const nextCode = lastBankAccount 
            ? String(parseInt(lastBankAccount.account_code, 10) + 1).padStart(4, '0')
            : '1001';

        // Create account in chart of accounts
        const accountResult = db.prepare(`
            INSERT INTO accounts (account_code, account_name, account_type, normal_balance)
            VALUES (?, ?, 'asset', 'debit')
        `).run(nextCode, normalizedBankName);

        // Create bank entry linked to the account
        const bankResult = db.prepare(`
            INSERT INTO banks (bank_name, account_number, branch_name, branch_code, iban, account_id, is_active, is_default)
            VALUES (?, ?, ?, ?, ?, ?, 1, 0)
        `).run(
            normalizedBankName,
            accountNumber || null,
            branchName || null,
            branchCode || null,
            iban || null,
            accountResult.lastInsertRowid
        );

        const createdBank = db.prepare(`
            SELECT b.*, a.account_code, a.account_name as linked_account_name
            FROM banks b
            LEFT JOIN accounts a ON b.account_id = a.id
            WHERE b.id = ?
        `).get(bankResult.lastInsertRowid);

        return { 
            success: true, 
            bankId: bankResult.lastInsertRowid,
            accountId: accountResult.lastInsertRowid,
            accountCode: nextCode,
            bank: createdBank,
        };
    })();
});

ipcMain.handle('db:update-bank', (_e, { id, bankName, accountNumber, branchName, branchCode, iban }) => {
    const db = getDb();
    if (!id) throw new Error('Bank ID is required');
    if (!bankName || !bankName.trim()) throw new Error('Bank name is required');

    return db.transaction(() => {
        // Update bank record
        db.prepare(`
            UPDATE banks SET 
                bank_name = ?,
                account_number = ?,
                branch_name = ?,
                branch_code = ?,
                iban = ?
            WHERE id = ?
        `).run(bankName.trim(), accountNumber || null, branchName || null, branchCode || null, iban || null, id);

        // Also update the linked account name
        const bank = db.prepare('SELECT account_id FROM banks WHERE id = ?').get(id);
        if (bank && bank.account_id) {
            db.prepare('UPDATE accounts SET account_name = ? WHERE id = ?').run(bankName.trim(), bank.account_id);
        }

        return { success: true };
    })();
});

ipcMain.handle('db:delete-bank', (_e, { id }) => {
    const db = getDb();
    if (!id) throw new Error('Bank ID is required');

    const bank = db.prepare('SELECT * FROM banks WHERE id = ?').get(id);
    if (!bank) throw new Error('Bank not found');
    if (bank.is_default) throw new Error('Cannot delete the default bank');

    // Check if bank has any transactions
    const hasTransactions = db.prepare(`
        SELECT COUNT(*) as cnt FROM cashbook_entries 
        WHERE description LIKE '%' || ? || '%'
    `).get(bank.bank_name);

    if (hasTransactions && hasTransactions.cnt > 0) {
        // Soft delete - just deactivate
        db.prepare('UPDATE banks SET is_active = 0 WHERE id = ?').run(id);
        if (bank.account_id) {
            db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').run(bank.account_id);
        }
    } else {
        // Hard delete
        db.prepare('DELETE FROM banks WHERE id = ?').run(id);
        if (bank.account_id) {
            db.prepare('DELETE FROM accounts WHERE id = ?').run(bank.account_id);
        }
    }

    return { success: true };
});

ipcMain.handle('db:set-default-bank', (_e, { id }) => {
    const db = getDb();
    if (!id) throw new Error('Bank ID is required');

    return db.transaction(() => {
        db.prepare('UPDATE banks SET is_default = 0').run();
        db.prepare('UPDATE banks SET is_default = 1 WHERE id = ?').run(id);
        return { success: true };
    })();
});

ipcMain.handle('db:cash-to-bank', (_e, { date, amount, notes, bankId }) => {
    const db = getDb();
    const cash = db.prepare("SELECT id FROM accounts WHERE account_code = '1000'").get();

    // Resolve bank from explicit selection first, then default active bank, then legacy account 1001 fallback.
    let bankRow = null;
    if (bankId) {
        bankRow = db.prepare(`
            SELECT b.id, b.bank_name, b.account_id
            FROM banks b
            WHERE b.id = ? AND b.is_active = 1
        `).get(bankId);
        if (!bankRow) throw new Error('Selected bank not found or inactive');
    }
    if (!bankRow) {
        bankRow = db.prepare(`
            SELECT b.id, b.bank_name, b.account_id
            FROM banks b
            WHERE b.is_active = 1
            ORDER BY b.is_default DESC, b.id ASC
            LIMIT 1
        `).get();
    }

    let bank = null;
    let bankName = 'Bank';
    if (bankRow?.account_id) {
        bank = db.prepare('SELECT id FROM accounts WHERE id = ?').get(bankRow.account_id);
        bankName = bankRow.bank_name || bankName;
    }
    if (!bank) {
        bank = db.prepare("SELECT id FROM accounts WHERE account_code = '1001'").get();
    }

    if (!cash || !bank) throw new Error('Accounts not found');
    
    return db.transaction(() => {
        const description = notes || `Cash transferred to ${bankName}`;
        const je = db.prepare("INSERT INTO journal_entries (entry_date, description, reference_type) VALUES (?, ?, 'transfer')")
            .run(date, description);
        const jeId = je.lastInsertRowid;
        db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)').run(jeId, bank.id, amount);
        db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)').run(jeId, cash.id, amount);
        db.prepare("INSERT INTO ledger_entries (entry_date, description, reference_type, debit_account_id, amount, journal_entry_id) VALUES (?, ?, 'transfer', ?, ?, ?)")
            .run(date, description, bank.id, amount, jeId);
        db.prepare("INSERT INTO ledger_entries (entry_date, description, reference_type, credit_account_id, amount, journal_entry_id) VALUES (?, ?, 'transfer', ?, ?, ?)")
            .run(date, description, cash.id, amount, jeId);
        db.prepare('INSERT INTO cashbook_entries (entry_date, description, cash_out, bank_in, cash_in, bank_out, journal_entry_id) VALUES (?, ?, ?, ?, 0, 0, ?)')
            .run(date, description, amount, amount, jeId);
        return { success: true };
    })();
});

ipcMain.handle('db:bank-to-cash', (_e, { date, amount, purpose, transferMode, chequeNo, notes, bankId }) => {
    const db = getDb();
    const cash = db.prepare("SELECT id FROM accounts WHERE account_code = '1000'").get();

    let bankRow = null;
    if (bankId) {
        bankRow = db.prepare(`
            SELECT b.id, b.bank_name, b.account_id
            FROM banks b
            WHERE b.id = ? AND b.is_active = 1
        `).get(bankId);
        if (!bankRow) throw new Error('Selected bank not found or inactive');
    }
    if (!bankRow) {
        bankRow = db.prepare(`
            SELECT b.id, b.bank_name, b.account_id
            FROM banks b
            WHERE b.is_active = 1
            ORDER BY b.is_default DESC, b.id ASC
            LIMIT 1
        `).get();
    }

    let bank = null;
    let bankName = 'Bank';
    if (bankRow?.account_id) {
        bank = db.prepare('SELECT id FROM accounts WHERE id = ?').get(bankRow.account_id);
        bankName = bankRow.bank_name || bankName;
    }
    if (!bank) {
        bank = db.prepare("SELECT id FROM accounts WHERE account_code = '1001'").get();
    }

    if (!cash || !bank) throw new Error('Accounts not found');

    const mode = transferMode === 'online' ? 'online' : 'cheque';
    const instrument = mode === 'cheque' ? `Cheque #${(chequeNo || '').trim()}` : 'Online transaction';
    const purposeText = (purpose || '').trim() || `${bankName} to cash transfer`;
    const extraNotes = (notes || '').trim();
    const description = `${purposeText} (${instrument}${extraNotes ? `; ${extraNotes}` : ''})`;

    if (mode === 'cheque' && !(chequeNo || '').trim()) {
        throw new Error('Cheque number is required for cheque cashing');
    }

    return db.transaction(() => {
        const je = db.prepare("INSERT INTO journal_entries (entry_date, description, reference_type) VALUES (?, ?, 'transfer')")
            .run(date, description);
        const jeId = je.lastInsertRowid;

        // Opposite of cash-to-bank: Dr Cash / Cr Bank
        db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)').run(jeId, cash.id, amount);
        db.prepare('INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)').run(jeId, bank.id, amount);
        db.prepare("INSERT INTO ledger_entries (entry_date, description, reference_type, debit_account_id, amount, journal_entry_id) VALUES (?, ?, 'transfer', ?, ?, ?)")
            .run(date, description, cash.id, amount, jeId);
        db.prepare("INSERT INTO ledger_entries (entry_date, description, reference_type, credit_account_id, amount, journal_entry_id) VALUES (?, ?, 'transfer', ?, ?, ?)")
            .run(date, description, bank.id, amount, jeId);

        db.prepare('INSERT INTO cashbook_entries (entry_date, description, cash_in, bank_out, cash_out, bank_in, journal_entry_id) VALUES (?, ?, ?, ?, 0, 0, ?)')
            .run(date, description, amount, amount, jeId);

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
                            INSERT INTO members (member_id, name, cnic, phone, membership_date, notes)
                            VALUES (?, ?, 'N/A', 'N/A', date('now'), ?)
                        `).run(`MEM-${String(memNo).padStart(5, '0')}`, name, `MEM#${memNo}`);
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

ipcMain.handle('db:print-challan', (_e, { billId, amount, remarks }) => {
    try {
        const html = generateChallanHTML(billId, amount ?? null, remarks ?? null);
        printChallan(html);
    } catch (err) {
        console.error(`[print-challan] Error for bill ${billId}:`, err);
        throw new Error(`Print failed: ${err.message}`);
    }
});

ipcMain.handle('db:print-cash-transfer', (_e, { date, amount, notes }) => {
    const html = generateTransferSlipHTML({ date, amount, notes, direction: 'cash_to_bank' });
    printChallan(html);
});

ipcMain.handle('db:print-bank-to-cash-transfer', (_e, { date, amount, purpose, transferMode, chequeNo, notes }) => {
    const html = generateTransferSlipHTML({
        date,
        amount,
        purpose,
        transferMode,
        chequeNo,
        notes,
        direction: 'bank_to_cash',
    });
    printChallan(html);
});

ipcMain.handle('db:get-challan-html', (_e, { billId, amount, remarks }) => {
    return generateChallanHTML(billId, amount ?? null, remarks ?? null);
});

// ── App Lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
    try { initDatabase(app.getPath('userData')); console.log('Database initialized successfully.'); }
    catch (error) { console.error('Failed to initialize database:', error); }
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });