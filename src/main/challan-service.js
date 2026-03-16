import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { app, BrowserWindow } from 'electron';
import { getDb } from './database.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt(val) {
    if (!val || Number(val) === 0) return '-';
    return Number(val).toLocaleString('en-PK');
}

function fmtDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

function fmtMonth(monthStr) {
    if (!monthStr) return '';
    const parts = String(monthStr).split('-');
    if (parts.length !== 2) return String(monthStr);
    const mi = Number(parts[1]) - 1;
    if (mi < 0 || mi > 11) return String(monthStr);
    return `${MONTHS[mi]}-${String(parts[0]).slice(-2)}`;
}

function pick(items, pattern) {
    return items
        .filter(i => pattern.test(i.charge_name || ''))
        .reduce((s, i) => s + (Number(i.amount) || 0), 0);
}

function resolveTemplatePath() {
    const candidates = [
        join(app.getAppPath(), 'out', 'renderer', 'bill-template.html'),
        join(app.getAppPath(), 'public', 'bill-template.html'),
        join(process.cwd(), 'public', 'bill-template.html'),
        join(process.cwd(), 'out', 'renderer', 'bill-template.html'),
    ];
    const found = candidates.find(p => existsSync(p));
    if (!found) throw new Error('bill-template.html not found in any expected location');
    return found;
}

export function generateChallanHTML(billId, customAmount = null) {
    const db = getDb();

    const row = db.prepare(`
        SELECT
            b.*,
            p.plot_number,
            m.name AS member_name,
            t.name AS tenant_name,
            (SELECT MAX(b2.billing_month) FROM bills b2
             WHERE b2.plot_id = b.plot_id AND b2.status = 'paid' AND b2.is_deleted = 0) AS paid_upto,
            (SELECT MAX(b3.billing_month) FROM bills b3
             WHERE b3.tenant_id = b.tenant_id AND b3.status = 'paid' AND b3.is_deleted = 0
               AND b3.tenant_id IS NOT NULL) AS tenant_paid_upto
        FROM bills b
        LEFT JOIN plots p ON p.id = b.plot_id
        LEFT JOIN members m ON m.id = b.member_id
        LEFT JOIN tenants t ON t.id = b.tenant_id
        WHERE b.id = ? AND b.is_deleted = 0
    `).get(billId);

    if (!row) throw new Error('Bill not found: ' + billId);

    const items = db.prepare('SELECT charge_name, amount FROM bill_items WHERE bill_id = ?').all(billId);

    const advPeriod = (() => {
        try { return JSON.parse(row.extra_config || '{}').advance_period_label || ''; }
        catch { return ''; }
    })();

    const payableAfterDue = Number(row.total_amount || 0) + Number(row.late_fee || 0);
    const payable = customAmount != null
        ? Number(customAmount).toLocaleString('en-PK')
        : fmt(row.total_amount);

    // Build special charges section for special bills
    let specialSection = '';
    if (row.bill_type === 'special' && items.length > 0) {
        const itemRows = items.map(i =>
            `<tr><td>${i.charge_name}</td><td>Rs. ${Number(i.amount).toLocaleString('en-PK')}</td></tr>`
        ).join('');
        specialSection = `
        <div class="special-section">
            <div class="special-section-title">&#9733; Special Charges Breakdown</div>
            <table class="special-charges-table">
                ${itemRows}
            </table>
        </div>`;
    }

    const html = readFileSync(resolveTemplatePath(), 'utf8');

    return html
        .replace(/\{\{PLOT_NO\}\}/g,              row.plot_number || '')
        .replace(/\{\{MEMBERSHIP_NO\}\}/g,         row.member_id ? `M-${row.member_id}` : '')
        .replace(/\{\{MEMBER_NAME\}\}/g,           row.member_name || '')
        .replace(/\{\{TENANT_NAME\}\}/g,           row.tenant_name || '')
        .replace(/\{\{CHALLAN_NO\}\}/g,            row.bill_number || '')
        .replace(/\{\{BILL_MONTH\}\}/g,            fmtMonth(row.billing_month))
        .replace(/\{\{ISSUED_ON\}\}/g,             fmtDate(row.bill_date))
        .replace(/\{\{DUE_DATE\}\}/g,              fmtDate(row.due_date))
        .replace(/\{\{PAID_UPTO\}\}/g,             fmtMonth(row.paid_upto))
        .replace(/\{\{TENANT_PAID_UPTO\}\}/g,      fmtMonth(row.tenant_paid_upto))
        .replace(/\{\{ADV_PERIOD\}\}/g,            advPeriod)
        .replace(/\{\{RECEIPT_PERIOD\}\}/g,        advPeriod || fmtMonth(row.billing_month))
        .replace(/\{\{MONTHLY_CONTRIBUTION\}\}/g,  fmt(pick(items, /monthly contribution/i)))
        .replace(/\{\{ARREARS\}\}/g,               fmt(row.arrears))
        .replace(/\{\{GARBAGE_CHARGES\}\}/g,       fmt(pick(items, /garbage/i)))
        .replace(/\{\{AQUIFER_CHARGES\}\}/g,       fmt(pick(items, /aquifer/i)))
        .replace(/\{\{TENANT_MONTHLY\}\}/g,        fmt(pick(items, /tenant.*challan|monthly.*tenant/i)))
        .replace(/\{\{TENANT_GARBAGE\}\}/g,        fmt(pick(items, /tenant.*garbage/i)))
        .replace(/\{\{TENANT_AQUIFER\}\}/g,        fmt(pick(items, /tenant.*aquifer/i)))
        .replace(/\{\{SUBDIVISION\}\}/g,           fmt(pick(items, /subdivision/i)))
        .replace(/\{\{ADV_MONTHLY\}\}/g,           fmt(pick(items, /adv.*monthly/i)))
        .replace(/\{\{ADV_AQUIFER\}\}/g,           fmt(pick(items, /adv.*aquifer/i)))
        .replace(/\{\{ADV_GARBAGE\}\}/g,           fmt(pick(items, /adv.*garbage/i)))
        .replace(/\{\{PARK_BOOKING\}\}/g,          fmt(pick(items, /park.*booking/i)))
        .replace(/\{\{MOSQUE\}\}/g,                fmt(pick(items, /mosque/i)))
        .replace(/\{\{CURRENT_TOTAL\}\}/g,         fmt(row.subtotal))
        .replace(/\{\{PAYABLE_AMOUNT\}\}/g,        payable)
        .replace(/\{\{PAYABLE_AFTER_DUE\}\}/g,     fmt(payableAfterDue))
        .replace(/\{\{SPECIAL_CHARGES_SECTION\}\}/g, specialSection);
}

export function printChallan(html) {
    const win = new BrowserWindow({
        width: 900,
        height: 1100,
        show: false,
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.webContents.on('did-finish-load', () => {
        win.webContents.print({ silent: false, printBackground: true }, () => win.close());
    });
}
