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

export function generateTransferSlipHTML({ date, amount, notes }) {
    const templateHtml = readFileSync(resolveTemplatePath(), 'utf8');
    // Extract logo <img> tag from the bill template
    const logoMatch = templateHtml.match(/<img\s+src="data:image[^"]*"[^>]*>/);
    const logoTag = logoMatch
        ? logoMatch[0].replace(/style="[^"]*"/, '').replace(/>$/, ' style="width:100%;height:100%;object-fit:contain" />')
        : '';
    const logoHtml = logoTag
        ? `<div style="width:52px;height:52px;flex-shrink:0">${logoTag}</div>`
        : `<div style="width:52px;height:52px;border:2px solid #1a4a7a;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#1a4a7a;text-align:center;line-height:1.2;background:#e8f0fb;flex-shrink:0">RV<br>CHS</div>`;

    const fmtAmt = Number(amount).toLocaleString('en-PK');
    const dateFormatted = fmtDate(date);
    const desc = notes || 'Cash transferred to bank';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Cash to Bank Transfer Voucher</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;600;700&family=Source+Sans+3:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Source Sans 3', Arial, sans-serif; font-size: 11px; background: #f0ece4; padding: 10px; color: #111; }
  .slip { width: 740px; margin: 0 auto 6px; border: 1.5px solid #999; background: #fff; position: relative; page-break-inside: avoid; }
  .copy-label { position: absolute; right: -26px; top: 50%; transform: translateY(-50%) rotate(90deg); font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; background: #1a4a7a; color: #fff; padding: 3px 10px; white-space: nowrap; border-radius: 0 0 3px 3px; }
  .bill-header { display: flex; align-items: center; background: #d0dff0; border-bottom: 1.5px solid #999; padding: 6px 10px; gap: 10px; }
  .society-name { flex: 1; text-align: center; font-family: 'EB Garamond', Georgia, serif; font-size: 20px; font-weight: 700; color: #1a2e5a; letter-spacing: 0.5px; }
  .bill-body { display: grid; grid-template-columns: 260px 1fr; min-height: 140px; }
  .left-panel { border-right: 1.5px solid #999; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
  .info-row { display: flex; gap: 4px; line-height: 1.7; }
  .info-label { font-weight: 700; white-space: nowrap; min-width: 100px; }
  .info-value { color: #222; }
  .right-panel { padding: 0; }
  .voucher-table { width: 100%; border-collapse: collapse; }
  .voucher-table th { background: #1a4a7a; color: #fff; text-align: center; padding: 5px 8px; font-size: 11px; letter-spacing: 0.4px; }
  .voucher-table td { padding: 4px 8px; border-bottom: 1px solid #e0e0e0; vertical-align: middle; line-height: 1.6; }
  .voucher-table td:last-child { text-align: right; font-variant-numeric: tabular-nums; min-width: 80px; }
  .voucher-table tr.amount-row td { font-weight: 700; font-size: 13px; background: #d0dff0; border-top: 1.5px solid #1a4a7a; }
  .sig-row { display: flex; justify-content: space-between; padding: 20px 16px 8px; }
  .sig { text-align: center; width: 140px; }
  .sig-line { border-top: 1px solid #555; padding-top: 4px; font-size: 10px; color: #666; }
  .bill-footer { border-top: 1.5px solid #999; text-align: center; padding: 4px 8px; font-size: 9.5px; color: #444; background: #f7f5f0; line-height: 1.6; }
  .separator { width: 740px; margin: 0 auto; border: none; border-top: 2px dashed #aaa; margin-bottom: 6px; }
  @media print { body { background: #fff; padding: 0; } .slip { margin: 0 auto; border: 1px solid #888; } .separator { border-color: #888; } }
</style>
</head>
<body>

<!-- ═══════ OFFICE COPY ═══════ -->
<div class="slip">
  <div class="copy-label">Office Copy</div>
  <div class="bill-header">
    ${logoHtml}
    <div class="society-name">River View Co-operative Housing Society Ltd.</div>
  </div>
  <div class="bill-body">
    <div class="left-panel">
      <div style="text-align:center;font-weight:700;font-size:12px;text-decoration:underline;margin-bottom:4px;letter-spacing:0.5px">CASH TO BANK TRANSFER</div>
      <div class="info-row"><span class="info-label">Date:</span><span class="info-value">${dateFormatted}</span></div>
      <div class="info-row"><span class="info-label">Description:</span><span class="info-value">${desc}</span></div>
      <div class="info-row"><span class="info-label">Voucher Type:</span><span class="info-value">Cash to Bank</span></div>
      <div style="margin-top:auto;display:flex;justify-content:space-between;padding-top:8px">
        <div class="sig"><div class="sig-line">Prepared By</div></div>
        <div class="sig"><div class="sig-line">Authorised By</div></div>
      </div>
    </div>
    <div class="right-panel">
      <table class="voucher-table">
        <thead><tr><th colspan="2">Transfer Details</th></tr></thead>
        <tbody>
          <tr><td>Debit: Allied Bank Ltd (1001)</td><td>Rs. ${fmtAmt}</td></tr>
          <tr><td>Credit: Cash in Hand (1000)</td><td>Rs. ${fmtAmt}</td></tr>
          <tr class="amount-row"><td>Amount Transferred</td><td>Rs. ${fmtAmt}</td></tr>
        </tbody>
      </table>
      <div class="sig-row">
        <div class="sig"><div class="sig-line">Cashier / Treasurer</div></div>
        <div class="sig"><div class="sig-line">President / Secretary</div></div>
      </div>
    </div>
  </div>
  <div class="bill-footer">
    Direct / Online Bill Payment, A/C # 2029-0015385-0201, Bank Islami, Thokar Niazbaig Branch, Lahore.<br>
    WhatsApp: 03234148632, 03444000003 &nbsp;&middot;&nbsp; Ph. # 042-32294375
  </div>
</div>

<hr class="separator"/>

<!-- ═══════ BANK COPY ═══════ -->
<div class="slip">
  <div class="copy-label">Bank Copy</div>
  <div class="bill-header">
    ${logoHtml}
    <div class="society-name">River View Co-operative Housing Society Ltd.</div>
  </div>
  <div class="bill-body">
    <div class="left-panel">
      <div style="text-align:center;font-weight:700;font-size:12px;text-decoration:underline;margin-bottom:4px;letter-spacing:0.5px">CASH TO BANK TRANSFER</div>
      <div class="info-row"><span class="info-label">Date:</span><span class="info-value">${dateFormatted}</span></div>
      <div class="info-row"><span class="info-label">Description:</span><span class="info-value">${desc}</span></div>
      <div class="info-row"><span class="info-label">Voucher Type:</span><span class="info-value">Cash to Bank</span></div>
      <div style="margin-top:auto;display:flex;justify-content:space-between;padding-top:8px">
        <div class="sig"><div class="sig-line">Prepared By</div></div>
        <div class="sig"><div class="sig-line">Authorised By</div></div>
      </div>
    </div>
    <div class="right-panel">
      <table class="voucher-table">
        <thead><tr><th colspan="2">Transfer Details</th></tr></thead>
        <tbody>
          <tr><td>Debit: Allied Bank Ltd (1001)</td><td>Rs. ${fmtAmt}</td></tr>
          <tr><td>Credit: Cash in Hand (1000)</td><td>Rs. ${fmtAmt}</td></tr>
          <tr class="amount-row"><td>Amount Transferred</td><td>Rs. ${fmtAmt}</td></tr>
        </tbody>
      </table>
      <div class="sig-row">
        <div class="sig"><div class="sig-line">Cashier / Treasurer</div></div>
        <div class="sig"><div class="sig-line">President / Secretary</div></div>
      </div>
    </div>
  </div>
  <div class="bill-footer">
    Direct / Online Bill Payment, A/C # 2029-0015385-0201, Bank Islami, Thokar Niazbaig Branch, Lahore.<br>
    WhatsApp: 03234148632, 03444000003 &nbsp;&middot;&nbsp; Ph. # 042-32294375
  </div>
</div>

<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;
}
