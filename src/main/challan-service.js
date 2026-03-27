import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { app, BrowserWindow } from 'electron';
import { getDb } from './database.js';

// Keep print windows alive to prevent Garbage Collection
const activePrintWindows = new Set();

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

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

function pick(items, pattern) {
    return items
        .filter(i => pattern.test(i.charge_name || ''))
        .reduce((s, i) => s + (Number(i.amount) || 0), 0);
}

function normalizeChargeLabel(chargeName) {
  const raw = String(chargeName || '').trim();
  if (!raw) return 'Charge';
  if (/monthly tenant challan/i.test(raw)) return 'Monthly Tenant Challan';
  if (/monthly contribution|base contribution/i.test(raw)) return 'Monthly Contribution';
  if (/mosque/i.test(raw)) return 'Mosque Fund';
  if (/garbage/i.test(raw)) return 'Garbage Charges';
  if (/aquifer/i.test(raw)) return 'Aquifer Charges';
  if (/late fee/i.test(raw)) return 'Late Fee';
  return raw;
}

function chargeSortPriority(label) {
  if (/^monthly tenant challan$/i.test(label)) return 1;
  if (/^monthly contribution$/i.test(label)) return 1;
  if (/^mosque fund$/i.test(label)) return 2;
  if (/^garbage charges$/i.test(label)) return 3;
  if (/^aquifer charges$/i.test(label)) return 4;
  if (/^late fee$/i.test(label)) return 5;
  return 50;
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

function getLogoDataURI() {
    const candidates = [
        join(process.cwd(), 'public', 'rvchs-logo.png'),
        join(process.cwd(), 'public', 'rvchs-logo.jpg'),
        join(process.cwd(), 'public', 'logo.png'),
        join(process.cwd(), 'public', 'logo.jpg'),
        join(app.getAppPath(), 'public', 'rvchs-logo.png'),
        join(app.getAppPath(), 'build', 'rvchs-logo.png'),
        join(process.cwd(), 'public', 'vite.svg'), // fallback for testing
    ];
    
    // De-duplicate paths
    const uniqueCandidates = [...new Set(candidates)];

    const found = uniqueCandidates.find(p => existsSync(p));
    if (found) {
        try {
            const b64 = readFileSync(found).toString('base64');
            let mime = 'image/png';
            if (found.endsWith('.jpg') || found.endsWith('.jpeg')) mime = 'image/jpeg';
            if (found.endsWith('.svg')) mime = 'image/svg+xml';
            
            return `data:${mime};base64,${b64}`;
        } catch (e) { 
            console.error('Error reading logo:', e); 
        }
    }
    return ''; // Return empty string if not found, template will show fallback
}

export function generateChallanHTML(billId, customAmount = null, printRemarks = null) {
    const db = getDb();

    const row = db.prepare(`
        SELECT
            b.*,
            p.plot_number,
        COALESCE(
          m.member_id,
          (
            SELECT mo.member_id
            FROM plot_ownership po
            JOIN members mo ON mo.id = po.member_id
            WHERE po.plot_id = b.plot_id
              AND (po.end_date IS NULL OR po.end_date = '')
            ORDER BY po.start_date DESC, po.id DESC
            LIMIT 1
          )
        ) AS member_code,
        COALESCE(
          m.name,
          (
            SELECT mo.name
            FROM plot_ownership po
            JOIN members mo ON mo.id = po.member_id
            WHERE po.plot_id = b.plot_id
              AND (po.end_date IS NULL OR po.end_date = '')
            ORDER BY po.start_date DESC, po.id DESC
            LIMIT 1
          )
        ) AS member_name,
            t.name AS tenant_name,
          t.tenant_id AS tenant_code,
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

    // Resolve member details with simple fail-safe fallbacks:
    // 1) direct bill member, 2) latest plot owner, 3) formatted numeric id.
    let resolvedMemberName = String(row.member_name || '').trim();
    let resolvedMemberCode = String(row.member_code || '').trim();

    if (!resolvedMemberName || !resolvedMemberCode) {
      let fallbackMember = null;

      if (row.member_id) {
        fallbackMember = db.prepare('SELECT id, name, member_id FROM members WHERE id = ?').get(row.member_id);
      }

      if ((!fallbackMember || !fallbackMember.name || !fallbackMember.member_id) && row.plot_id) {
        fallbackMember = db.prepare(`
          SELECT m.id, m.name, m.member_id
          FROM plot_ownership po
          JOIN members m ON m.id = po.member_id
          WHERE po.plot_id = ?
          ORDER BY
            CASE WHEN po.end_date IS NULL OR po.end_date = '' THEN 0 ELSE 1 END,
            po.start_date DESC,
            po.id DESC
          LIMIT 1
        `).get(row.plot_id);
      }

      if (!resolvedMemberName && fallbackMember?.name) {
        resolvedMemberName = String(fallbackMember.name).trim();
      }

      if (!resolvedMemberCode) {
        if (fallbackMember?.member_id) {
          resolvedMemberCode = String(fallbackMember.member_id).trim();
        } else if (fallbackMember?.id) {
          resolvedMemberCode = `MEM-${String(fallbackMember.id).padStart(5, '0')}`;
        } else if (row.member_id) {
          resolvedMemberCode = `MEM-${String(row.member_id).padStart(5, '0')}`;
        }
      }
    }

    // Final fallback for tenant bills where owner mapping is missing.
    if (row.bill_type === 'tenant') {
      if (!resolvedMemberName && row.tenant_name) {
        resolvedMemberName = String(row.tenant_name).trim();
      }
      if (!resolvedMemberCode && row.tenant_code) {
        resolvedMemberCode = String(row.tenant_code).trim();
      }
    }

    if (!resolvedMemberName) resolvedMemberName = 'Unassigned';
    if (!resolvedMemberCode) resolvedMemberCode = 'N/A';

    const items = db.prepare('SELECT charge_name, amount FROM bill_items WHERE bill_id = ?').all(billId);

    const advPeriod = (() => {
        try { return JSON.parse(row.extra_config || '{}').advance_period_label || ''; }
        catch { return ''; }
    })();

    const payableAfterDue = Number(row.total_amount || 0) + Number(row.late_fee || 0);
    const payable = customAmount != null
        ? Number(customAmount).toLocaleString('en-PK')
        : fmt(row.total_amount);

    const rowHtml = (label, amount, rowClass = '') => {
      const cls = rowClass ? ` class="${rowClass}"` : '';
      return `<tr${cls}><td>${label}</td><td class="amt">${amount}</td></tr>`;
    };

    const groupedItems = Object.values(
      items.reduce((acc, i) => {
        const label = normalizeChargeLabel(i.charge_name);
        if (!acc[label]) acc[label] = { label, amount: 0 };
        acc[label].amount += Number(i.amount) || 0;
        return acc;
      }, {})
    ).sort((a, b) => {
      const pa = chargeSortPriority(a.label);
      const pb = chargeSortPriority(b.label);
      if (pa !== pb) return pa - pb;
      return a.label.localeCompare(b.label);
    });

    const showArrearsRow = row.bill_type === 'monthly' && Number(row.arrears || 0) > 0.009;

    const descriptionRows = (() => {
      if (row.bill_type === 'tenant') {
        const groupedMap = groupedItems.reduce((acc, i) => {
          const tenantLabel = (/^monthly contribution$/i.test(i.label) || /^base contribution$/i.test(i.label))
            ? 'Monthly Tenant Challan'
            : i.label;
          acc[tenantLabel] = (acc[tenantLabel] || 0) + i.amount;
          return acc;
        }, {});

        const fixedTenantHeaders = [
          'Monthly Tenant Challan',
          'Mosque Fund',
          'Garbage Charges',
          'Aquifer Charges',
          'Late Fee',
        ];

        const fixedRows = fixedTenantHeaders.map((label) => rowHtml(label, fmt(groupedMap[label] || 0)));
        const extraRows = groupedItems
          .filter((i) => !fixedTenantHeaders.includes(i.label) && !/^monthly contribution$/i.test(i.label) && !/^base contribution$/i.test(i.label))
          .map((i) => rowHtml(escapeHtml(i.label), fmt(i.amount)));

        return [
          ...fixedRows,
          ...extraRows,
          rowHtml('Payable Within Due Date', payable, 'total-row'),
          rowHtml('Payable After Due Date', fmt(payableAfterDue), 'late-row'),
        ].join('');
      }

      return [
        ...groupedItems.map((i) => rowHtml(escapeHtml(i.label), fmt(i.amount))),
        showArrearsRow ? rowHtml('Arrears', fmt(row.arrears)) : null,
        rowHtml('Payable Within Due Date', payable, 'total-row'),
        rowHtml('Payable After Due Date', fmt(payableAfterDue), 'late-row'),
      ].filter(Boolean).join('');
    })();
    const specialSection = '';

    const html = readFileSync(resolveTemplatePath(), 'utf8');

    const remarksSource = (typeof printRemarks === 'string' && printRemarks.trim())
      ? printRemarks.trim()
      : (row.notice || '');
    const remarksHtml = remarksSource
      ? `<div style="margin-top:3px;white-space:pre-wrap;">${escapeHtml(remarksSource).replace(/\n/g, '<br>')}</div>`
      : '';

    return html
        .replace(/\{\{PLOT_NO\}\}/g,              row.plot_number || '')
      .replace(/\{\{MEMBERSHIP_NO\}\}/g,         resolvedMemberCode || '')
        .replace(/\{\{MEMBER_NAME\}\}/g,           resolvedMemberName || '')
        .replace(/\{\{TENANT_NAME\}\}/g,           row.tenant_name || '')
        .replace(/\{\{CHALLAN_NO\}\}/g,            row.bill_number || '')
        .replace(/\{\{BILL_MONTH\}\}/g,            fmtMonth(row.billing_month))
        .replace(/\{\{ISSUED_ON\}\}/g,             fmtDate(row.bill_date))
        .replace(/\{\{DUE_DATE\}\}/g,              fmtDate(row.due_date))
        .replace(/\{\{PAID_UPTO\}\}/g,             fmtMonth(row.paid_upto))
        .replace(/\{\{TENANT_PAID_UPTO\}\}/g,      fmtMonth(row.tenant_paid_upto))
        .replace(/\{\{NOTICE_TEXT\}\}/g, remarksHtml)
        .replace(/\{\{DESCRIPTION_ROWS\}\}/g,      descriptionRows)
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
        .replace(/\{\{SPECIAL_CHARGES_SECTION\}\}/g, specialSection)
        .replace(/\{\{LOGO_DATA_URI\}\}/g,         getLogoDataURI());
}

export function printChallan(html) {
    const win = new BrowserWindow({
        width: 900,
        height: 1100,
        show: false,
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    
    // Keep window alive to prevent Garbage Collection
    activePrintWindows.add(win);
    
    // Error handler
    win.webContents.on('crashed', () => {
        console.error('[printChallan] WebContents crashed');
        activePrintWindows.delete(win);
        if (!win.isDestroyed()) win.destroy();
    });
    
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error(`[printChallan] Failed to load HTML: ${errorCode} - ${errorDescription}`);
        activePrintWindows.delete(win);
        if (!win.isDestroyed()) win.close();
    });
    
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    win.loadURL(dataUrl);
    
    win.webContents.on('did-finish-load', () => {
        // Small delay to ensure rendering is complete
        setTimeout(() => {
            try {
          // Do not close early; closing before print/PDF finalization can corrupt output files.
          const closeSafely = () => {
            if (!win.isDestroyed()) {
              win.close();
            }
            activePrintWindows.delete(win);
          };

          win.webContents.print(
            { silent: false, printBackground: true },
            (_success, failureReason) => {
              if (failureReason) {
                console.error('[printChallan] Print failed:', failureReason);
              }
              closeSafely();
            }
          );

          // Fallback in case callback is not triggered on some printers/drivers.
          setTimeout(() => {
            if (activePrintWindows.has(win)) {
              closeSafely();
            }
          }, 120000);
            } catch (err) {
                console.error('[printChallan] Error during print:', err);
                activePrintWindows.delete(win);
                if (!win.isDestroyed()) win.close();
            }
        }, 100);
    });
    
    // Handle window close event
    win.on('closed', () => {
        activePrintWindows.delete(win);
    });
}

export function generateTransferSlipHTML({ date, amount, notes, direction = 'cash_to_bank', purpose, transferMode, chequeNo }) {
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
    const isBankToCash = direction === 'bank_to_cash';
    const voucherTitle = isBankToCash ? 'BANK TO CASH TRANSFER' : 'CASH TO BANK TRANSFER';
    const voucherType = isBankToCash ? 'Bank to Cash' : 'Cash to Bank';
    const debitLine = isBankToCash
      ? 'Debit: Cash in Hand (1000)'
      : 'Debit: Allied Bank Ltd (1001)';
    const creditLine = isBankToCash
      ? 'Credit: Allied Bank Ltd (1001)'
      : 'Credit: Cash in Hand (1000)';
    const desc = (purpose || notes || (isBankToCash ? 'Bank to cash transfer' : 'Cash transferred to bank')).trim();
    const mode = transferMode === 'online' ? 'Online Transaction' : 'Cheque Cashed';
    const chequeInfo = chequeNo ? String(chequeNo).trim() : '';
    const extraNotes = notes && notes !== purpose ? String(notes).trim() : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${isBankToCash ? 'Bank to Cash Transfer Voucher' : 'Cash to Bank Transfer Voucher'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;600;700&family=Source+Sans+3:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Source Sans 3', Arial, sans-serif; font-size: 11px; background: #f0ece4; padding: 10px; color: #111; }
  .slip { width: 740px; margin: 0 auto 6px; border: 1.5px solid #999; background: #fff; position: relative; page-break-inside: avoid; padding-right: 30px; overflow: hidden; }
  .copy-label { position: absolute; right: 3px; top: 50%; transform: translateY(-50%) rotate(90deg); transform-origin: center; font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; background: #1a4a7a; color: #fff; padding: 3px 10px; white-space: nowrap; border-radius: 0 0 3px 3px; z-index: 2; }
  .bill-header { display: flex; align-items: center; background: #d0dff0; border-bottom: 1.5px solid #999; padding: 6px 10px; gap: 10px; }
  .society-name { flex: 1; text-align: center; font-family: 'EB Garamond', Georgia, serif; font-size: 20px; font-weight: 700; color: #1a2e5a; letter-spacing: 0.5px; }
  .bill-body { display: grid; grid-template-columns: 260px 1fr; min-height: 140px; }
  .left-panel { border-right: 1.5px solid #999; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
  .info-row { display: flex; gap: 4px; line-height: 1.7; }
  .info-label { font-weight: 700; white-space: nowrap; min-width: 100px; }
  .info-value { color: #222; }
  .right-panel { padding: 0 10px 0 0; }
  .voucher-table { width: 100%; border-collapse: collapse; }
  .voucher-table th { background: #1a4a7a; color: #fff; text-align: center; padding: 5px 8px; font-size: 11px; letter-spacing: 0.4px; }
  .voucher-table td { padding: 4px 8px; border-bottom: 1px solid #e0e0e0; vertical-align: middle; line-height: 1.6; }
  .voucher-table td:last-child { text-align: right; font-variant-numeric: tabular-nums; min-width: 110px; padding-right: 14px; white-space: nowrap; }
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
      <div style="text-align:center;font-weight:700;font-size:12px;text-decoration:underline;margin-bottom:4px;letter-spacing:0.5px">${voucherTitle}</div>
      <div class="info-row"><span class="info-label">Date:</span><span class="info-value">${dateFormatted}</span></div>
      <div class="info-row"><span class="info-label">Description:</span><span class="info-value">${desc}</span></div>
      <div class="info-row"><span class="info-label">Voucher Type:</span><span class="info-value">${voucherType}</span></div>
      ${isBankToCash ? `<div class="info-row"><span class="info-label">Transfer Mode:</span><span class="info-value">${mode}</span></div>` : ''}
      ${isBankToCash && chequeInfo ? `<div class="info-row"><span class="info-label">Cheque #:</span><span class="info-value">${chequeInfo}</span></div>` : ''}
      ${extraNotes ? `<div class="info-row"><span class="info-label">Notes:</span><span class="info-value">${extraNotes}</span></div>` : ''}
      <div style="margin-top:auto;display:flex;justify-content:space-between;padding-top:8px">
        <div class="sig"><div class="sig-line">Prepared By</div></div>
        <div class="sig"><div class="sig-line">Authorised By</div></div>
      </div>
    </div>
    <div class="right-panel">
      <table class="voucher-table">
        <thead><tr><th colspan="2">Transfer Details</th></tr></thead>
        <tbody>
          <tr><td>${debitLine}</td><td>Rs. ${fmtAmt}</td></tr>
          <tr><td>${creditLine}</td><td>Rs. ${fmtAmt}</td></tr>
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
      <div style="text-align:center;font-weight:700;font-size:12px;text-decoration:underline;margin-bottom:4px;letter-spacing:0.5px">${voucherTitle}</div>
      <div class="info-row"><span class="info-label">Date:</span><span class="info-value">${dateFormatted}</span></div>
      <div class="info-row"><span class="info-label">Description:</span><span class="info-value">${desc}</span></div>
      <div class="info-row"><span class="info-label">Voucher Type:</span><span class="info-value">${voucherType}</span></div>
      ${isBankToCash ? `<div class="info-row"><span class="info-label">Transfer Mode:</span><span class="info-value">${mode}</span></div>` : ''}
      ${isBankToCash && chequeInfo ? `<div class="info-row"><span class="info-label">Cheque #:</span><span class="info-value">${chequeInfo}</span></div>` : ''}
      ${extraNotes ? `<div class="info-row"><span class="info-label">Notes:</span><span class="info-value">${extraNotes}</span></div>` : ''}
      <div style="margin-top:auto;display:flex;justify-content:space-between;padding-top:8px">
        <div class="sig"><div class="sig-line">Prepared By</div></div>
        <div class="sig"><div class="sig-line">Authorised By</div></div>
      </div>
    </div>
    <div class="right-panel">
      <table class="voucher-table">
        <thead><tr><th colspan="2">Transfer Details</th></tr></thead>
        <tbody>
          <tr><td>${debitLine}</td><td>Rs. ${fmtAmt}</td></tr>
          <tr><td>${creditLine}</td><td>Rs. ${fmtAmt}</td></tr>
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
</body>
</html>`;
}
