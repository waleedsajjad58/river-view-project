import Database from 'better-sqlite3';
import { join } from 'path';
import fs from 'fs';

let db;

export function initDatabase(userDataPath) {
  const dbDir = join(userDataPath, 'database');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = join(dbDir, 'riverview_erp.db');
  console.log('Database path:', dbPath);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');  // CRITICAL: enforce referential integrity

  runMigrations();
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT
    )
  `);

  const getVersion = db.prepare(`SELECT value FROM settings WHERE key = 'schema_version'`);
  let currentVersion = 0;
  const row = getVersion.get();
  if (row) {
    currentVersion = parseInt(row.value, 10);
  } else {
    db.prepare(`INSERT INTO settings (key, value, description) VALUES ('schema_version', '0', 'Current database schema version')`).run();
  }

  console.log(`Current DB version: ${currentVersion}`);

  // Migration 1: Core tables
  if (currentVersion < 1) {
    console.log('Running migration 1 (core tables)...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        role TEXT DEFAULT 'accountant',
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        record_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        changed_by INTEGER REFERENCES users(id),
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS plots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plot_number TEXT NOT NULL UNIQUE,
        block TEXT,
        marla_size TEXT NOT NULL,
        plot_type TEXT NOT NULL,
        commercial_floors INTEGER DEFAULT 0,
        has_water_connection BOOLEAN DEFAULT 0,
        has_sewerage_connection BOOLEAN DEFAULT 0,
        upper_floors_residential BOOLEAN DEFAULT 0,
        status TEXT DEFAULT 'active',
        extra_config TEXT,
        is_deleted BOOLEAN DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        cnic TEXT,
        phone TEXT,
        address TEXT,
        is_member BOOLEAN DEFAULT 1,
        membership_date DATE,
        share_count INTEGER DEFAULT 4,
        extra_config TEXT,
        is_deleted BOOLEAN DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS plot_ownership (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plot_id INTEGER NOT NULL REFERENCES plots(id),
        member_id INTEGER NOT NULL REFERENCES members(id),
        ownership_type TEXT DEFAULT 'owner',
        start_date DATE NOT NULL,
        end_date DATE,
        transfer_deed_amount DECIMAL(15,2),
        extra_config TEXT,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS plot_type_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plot_id INTEGER NOT NULL REFERENCES plots(id),
        old_type TEXT NOT NULL,
        new_type TEXT NOT NULL,
        changed_at DATE NOT NULL,
        changed_by INTEGER REFERENCES users(id),
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        cnic TEXT,
        phone TEXT,
        plot_id INTEGER NOT NULL REFERENCES plots(id),
        start_date DATE,
        end_date DATE,
        monthly_rent DECIMAL(10,2) DEFAULT 2500,
        extra_config TEXT,
        is_deleted BOOLEAN DEFAULT 0,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS bill_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plot_type TEXT NOT NULL,
        charge_name TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        is_conditional BOOLEAN DEFAULT 0,
        condition_field TEXT,
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        extra_config TEXT,
        UNIQUE(plot_type, charge_name)
      );

      CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_number TEXT NOT NULL UNIQUE,
        plot_id INTEGER NOT NULL REFERENCES plots(id),
        member_id INTEGER REFERENCES members(id),
        tenant_id INTEGER REFERENCES tenants(id),
        bill_type TEXT DEFAULT 'monthly',
        bill_date DATE NOT NULL,
        due_date DATE NOT NULL,
        billing_month TEXT,
        subtotal DECIMAL(10,2) NOT NULL,
        late_fee DECIMAL(10,2) DEFAULT 0,
        arrears DECIMAL(10,2) DEFAULT 0,
        total_amount DECIMAL(10,2) NOT NULL,
        amount_paid DECIMAL(10,2) DEFAULT 0,
        balance_due DECIMAL(10,2) DEFAULT 0,
        status TEXT DEFAULT 'unpaid',
        extra_config TEXT,
        is_deleted BOOLEAN DEFAULT 0,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bill_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_id INTEGER NOT NULL REFERENCES bills(id),
        charge_name TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        is_custom BOOLEAN DEFAULT 0,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_id INTEGER NOT NULL REFERENCES bills(id),
        payment_date DATE NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_method TEXT DEFAULT 'cash',
        receipt_number TEXT,
        voucher_number TEXT,
        received_by INTEGER REFERENCES users(id),
        notes TEXT,
        ledger_entry_id INTEGER,
        cashbook_entry_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_code TEXT NOT NULL UNIQUE,
        account_name TEXT NOT NULL,
        account_type TEXT NOT NULL,
        parent_id INTEGER REFERENCES accounts(id),
        normal_balance TEXT DEFAULT 'debit',
        is_active BOOLEAN DEFAULT 1,
        extra_config TEXT
      );

      CREATE TABLE IF NOT EXISTS journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date DATE NOT NULL,
        description TEXT NOT NULL,
        voucher_number TEXT,
        reference_type TEXT,
        reference_id INTEGER,
        is_reversal BOOLEAN DEFAULT 0,
        reversal_of INTEGER REFERENCES journal_entries(id),
        created_by INTEGER REFERENCES users(id),
        extra_config TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS journal_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        debit DECIMAL(15,2) DEFAULT 0,
        credit DECIMAL(15,2) DEFAULT 0,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS ledger_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date DATE NOT NULL,
        description TEXT NOT NULL,
        voucher_number TEXT,
        reference_type TEXT,
        reference_id INTEGER,
        debit_account_id INTEGER REFERENCES accounts(id),
        credit_account_id INTEGER REFERENCES accounts(id),
        amount DECIMAL(15,2) NOT NULL,
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        entry_type TEXT DEFAULT 'auto',
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cashbook_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date DATE NOT NULL,
        description TEXT NOT NULL,
        voucher_number TEXT,
        receipt_number TEXT,
        cash_in DECIMAL(10,2) DEFAULT 0,
        bank_in DECIMAL(10,2) DEFAULT 0,
        cash_out DECIMAL(10,2) DEFAULT 0,
        bank_out DECIMAL(10,2) DEFAULT 0,
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        ledger_entry_id INTEGER REFERENCES ledger_entries(id),
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fiscal_year TEXT NOT NULL,
        category TEXT NOT NULL,
        allocated_amount DECIMAL(15,2) NOT NULL,
        spent_amount DECIMAL(15,2) DEFAULT 0,
        extra_config TEXT,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS expenditures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expenditure_date DATE NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_method TEXT DEFAULT 'cash',
        voucher_number TEXT,
        vendor_name TEXT,
        budget_id INTEGER REFERENCES budgets(id),
        account_id INTEGER REFERENCES accounts(id),
        ledger_entry_id INTEGER,
        cashbook_entry_id INTEGER,
        journal_entry_id INTEGER,
        created_by INTEGER REFERENCES users(id),
        extra_config TEXT,
        is_deleted BOOLEAN DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bank_deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deposit_date DATE NOT NULL,
        deposit_number TEXT,
        bank_name TEXT,
        branch TEXT,
        account_number TEXT,
        total_amount DECIMAL(15,2) NOT NULL,
        period_from DATE,
        period_to DATE,
        description TEXT,
        status TEXT DEFAULT 'pending',
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        created_by INTEGER REFERENCES users(id),
        is_deleted BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS onetime_charges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        charge_name TEXT NOT NULL UNIQUE,
        base_amount DECIMAL(15,2),
        is_percentage BOOLEAN DEFAULT 0,
        percentage_value DECIMAL(5,2),
        varies_by_marla BOOLEAN DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        extra_config TEXT,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS backup_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        backup_date DATETIME NOT NULL,
        backup_path TEXT NOT NULL,
        backup_type TEXT DEFAULT 'manual',
        file_size INTEGER,
        notes TEXT
      );
    `);
    db.prepare(`UPDATE settings SET value = '1' WHERE key = 'schema_version'`).run();
    currentVersion = 1;
  }

  // Migration 2: Seed default bill templates and settings
  if (currentVersion < 2) {
    console.log('Running migration 2 (seed defaults)...');

    const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)`);
    const settings = [
      ['society_name', 'River View Co-operative Housing Society Limited, Lahore', 'Society name'],
      ['society_address', 'Near Kothi, 20th Sindh Baluchistan Road, Lahore', 'Society address'],
      ['fiscal_year_start_month', '7', 'Fiscal year start month (7=July)'],
      ['default_due_days', '15', 'Days after bill date before it is overdue'],
      ['late_fee_type', 'flat', 'flat or percentage'],
      ['late_fee_value', '500', 'Late fee amount or percentage'],
      ['bill_number_prefix', 'RV-', 'Bill number prefix'],
      ['receipt_prefix', 'REC-', 'Receipt number prefix'],
      ['backup_auto_enabled', '1', 'Auto backup enabled'],
      ['backup_auto_interval_hours', '24', 'Auto backup interval'],
      ['tenant_challan_amount', '2500', 'Monthly challan amount charged for plots with active tenants'],
    ];
    for (const s of settings) {
      insertSetting.run(s[0], s[1], s[2]);
    }

    const insertTemplate = db.prepare(`INSERT OR IGNORE INTO bill_templates (plot_type, charge_name, amount, is_conditional, condition_field, sort_order) VALUES (?, ?, ?, ?, ?, ?)`);
    const templates = [
      ['residential_constructed', 'Monthly Contribution', 5000, 0, null, 1],
      ['residential_constructed', 'Garbage Collection', 300, 0, null, 2],
      ['residential_constructed', 'Aquifer Contribution', 300, 0, null, 3],
      ['residential_constructed', 'Mosque Contribution', 500, 0, null, 4],
      ['residential_vacant', 'Monthly Contribution', 5000, 0, null, 1],
      ['residential_vacant', 'Aquifer Contribution', 300, 0, null, 2],
      ['residential_vacant', 'Mosque Contribution', 500, 0, null, 3],
      ['commercial', 'Base Contribution', 1500, 0, null, 1],
      ['commercial', 'Mosque Contribution', 500, 0, null, 2],
      ['commercial', 'Aquifer Contribution', 300, 1, 'has_water_connection', 3],
      ['commercial', 'Garbage Collection', 300, 1, 'upper_floors_residential', 4],
      ['commercial', 'Per Extra Floor', 700, 1, 'commercial_floors', 5],
    ];
    for (const t of templates) {
      insertTemplate.run(t[0], t[1], t[2], t[3], t[4], t[5]);
    }

    const insertCharge = db.prepare(`INSERT OR IGNORE INTO onetime_charges (charge_name, base_amount, is_percentage, percentage_value, varies_by_marla, notes) VALUES (?, ?, ?, ?, ?, ?)`);
    
    // Updated exact list of charges
    const charges = [
      ['Membership Charges', 1000, 0, null, 0, ''],
      ['Share Capital', 4000, 0, null, 0, 'One thousand for each share'],
      ['Transfer Contribution from buyer', null, 1, 3.0, 0, '3% of highest: Sale Deed / DC Rate / FBR Rate'],
      ['Transfer Contribution from Seller', null, 1, 1.0, 0, '1% of highest: Sale Deed / DC Rate / FBR Rate'],
      ['Possession Contribution', 100000, 0, null, 1, 'Half for 10 Marla'],
      ['Demarcation Contribution', 100000, 0, null, 1, 'Half for 10 Marla'],
      ['Water Connection Charges', 15000, 0, null, 0, ''],
      ['Sewerage Connection Charges', 15000, 0, null, 0, ''],
      ['Park Booking (Member)', 20000, 0, null, 0, 'Per day'],
      ['Park Booking (Non-Member)', 40000, 0, null, 0, 'Per day'],
      ['NOC for Sub Division (Corner Plot)', 1000000, 0, null, 0, ''],
      ['NOC for Sub Division (Pre-2019 Constructed)', 500000, 0, null, 0, '']
    ];
    
    for (const c of charges) {
      insertCharge.run(c[0], c[1], c[2], c[3], c[4], c[5]);
    }

    db.prepare(`INSERT OR IGNORE INTO users (username, display_name, pin_hash, role) VALUES ('admin', 'Administrator', '1234', 'admin')`).run();

    db.prepare(`UPDATE settings SET value = '2' WHERE key = 'schema_version'`).run();
    currentVersion = 2;
  }

  // Migration 3: One active owner per plot
  if (currentVersion < 3) {
    console.log('Running migration 3 (integrity guards)...');
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_owner
      ON plot_ownership(plot_id) WHERE end_date IS NULL;
    `);
    db.prepare(`UPDATE settings SET value = '3' WHERE key = 'schema_version'`).run();
    currentVersion = 3;
  }

  // Migration 4: SKIPPED (was broken — replaced by Migration 7)
  // The original Migration 4 index only had (plot_id, billing_month) which prevented
  // tenant bills (same plot_id + billing_month, different bill_type) from being inserted.
  // Migration 7 drops and recreates it correctly.
  if (currentVersion < 4) {
    console.log('Running migration 4 (skipped — superseded by migration 7)...');
    db.prepare(`UPDATE settings SET value = '4' WHERE key = 'schema_version'`).run();
    currentVersion = 4;
  }

  // Migration 5: Chart of Accounts Seed
  if (currentVersion < 5) {
    console.log('Running migration 5 (Chart of Accounts seed)...');
    const insertAccount = db.prepare(`INSERT OR IGNORE INTO accounts
      (account_code, account_name, account_type, normal_balance) VALUES (?, ?, ?, ?)`);

    const defaultAccounts = [
      ['1000', 'Cash in Hand', 'asset', 'debit'],
      ['1001', 'Allied Bank Ltd', 'asset', 'debit'],
      ['1200', 'Member Receivables', 'asset', 'debit'],
      ['2000', 'Advance Receipts', 'liability', 'credit'],
      ['3000', 'Society Funds / Retained Earnings', 'equity', 'credit'],
      ['4000', 'Monthly Subscriptions', 'revenue', 'credit'],
      ['4001', 'Transfer Fees', 'revenue', 'credit'],
      ['4002', 'Commercial Surcharge', 'revenue', 'credit'],
      ['4003', 'Late Fees & Fines', 'revenue', 'credit'],
      ['4004', 'Other Special Charges', 'revenue', 'credit'],
      ['5000', 'General Operating Expenses', 'expense', 'debit'],
      ['5001', 'Salaries & Wages', 'expense', 'debit'],
      ['5002', 'Maintenance & Repairs', 'expense', 'debit'],
      ['5003', 'Utilities', 'expense', 'debit'],
    ];

    const tx = db.transaction(() => {
      for (const acc of defaultAccounts) {
        insertAccount.run(acc[0], acc[1], acc[2], acc[3]);
      }
      db.prepare(`UPDATE settings SET value = '5' WHERE key = 'schema_version'`).run();
    });
    tx();
    currentVersion = 5;
  }

  // Migration 6: Backup log + Expenditures
  if (currentVersion < 6) {
    console.log('Running migration 6 (backup_log + expenditures)...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS backup_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        backup_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        backup_path TEXT NOT NULL,
        backup_type TEXT DEFAULT 'manual',
        file_size INTEGER DEFAULT 0,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS expenditures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expenditure_date DATE NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        amount REAL NOT NULL DEFAULT 0,
        payment_method TEXT DEFAULT 'cash',
        receipt_number TEXT,
        approved_by TEXT,
        account_id INTEGER REFERENCES accounts(id),
        is_deleted BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.prepare(`UPDATE settings SET value = '6' WHERE key = 'schema_version'`).run();
    currentVersion = 6;
  }

  // Migration 7: FIX — correct billing unique index to include bill_type
  // This replaces the broken Migration 4 index which prevented tenant bills
  // from being inserted alongside monthly bills for the same plot+month.
  if (currentVersion < 7) {
    console.log('Running migration 7 (fix billing unique index to include bill_type)...');
    db.exec(`
      DROP INDEX IF EXISTS idx_one_bill_per_plot_month;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_bill_per_plot_month
      ON bills(plot_id, billing_month, bill_type)
      WHERE is_deleted = 0 AND billing_month IS NOT NULL;
    `);
    db.prepare(`UPDATE settings SET value = '7' WHERE key = 'schema_version'`).run();
    currentVersion = 7;
  }

  // Migration 8: Add tenant_challan_amount setting + locked_months table + audit log writes
  if (currentVersion < 8) {
    console.log('Running migration 8 (tenant setting, month locking, audit log activation)...');

    // Add tenant challan amount to settings if not already there
    db.prepare(`INSERT OR IGNORE INTO settings (key, value, description) VALUES ('tenant_challan_amount', '2500', 'Monthly challan amount for plots with active tenants')`).run();

    // Locked months table — accountant closes a month, no more bill generation/editing allowed
    db.exec(`
      CREATE TABLE IF NOT EXISTS locked_months (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        billing_month TEXT NOT NULL UNIQUE,  -- format YYYY-MM
        locked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        locked_by INTEGER REFERENCES users(id),
        notes TEXT
      );
    `);

    db.prepare(`UPDATE settings SET value = '8' WHERE key = 'schema_version'`).run();
    currentVersion = 8;
  }

  // Migration 9: Add missing columns to expenditures table
  // vendor_name and journal_entry_id were referenced in index.js but never created in migration 6
  if (currentVersion < 9) {
    console.log('Running migration 9 (add vendor_name + journal_entry_id to expenditures)...');
    // ALTER TABLE ADD COLUMN is safe — SQLite ignores if column already exists via try/catch
    const addCol = (sql) => { try { db.exec(sql); } catch(e) { /* column already exists */ } };
    addCol(`ALTER TABLE expenditures ADD COLUMN vendor_name TEXT`);
    addCol(`ALTER TABLE expenditures ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id)`);
    db.prepare(`UPDATE settings SET value = '9' WHERE key = 'schema_version'`).run();
    currentVersion = 9;
  }

  // Migration 10: Fix column mismatches that caused expenditure crashes
  // - Adds voucher_number to expenditures (code used voucher_number, old schema had receipt_number)
  // - Adds voucher_number to journal_entries and ledger_entries
  // - Adds updated_at to expenditures (reverse/delete handlers referenced it but it didn't exist)
  // - Back-fills missing cashbook entries for posted expenditures
  if (currentVersion < 10) {
    console.log('Running migration 10 (voucher_number + updated_at column fixes + cashbook backfill)...');
    const addCol = (sql) => { try { db.exec(sql); } catch(e) { /* already exists */ } };
    addCol(`ALTER TABLE expenditures ADD COLUMN voucher_number TEXT`);
    addCol(`ALTER TABLE expenditures ADD COLUMN updated_at DATETIME`);
    addCol(`ALTER TABLE journal_entries ADD COLUMN voucher_number TEXT`);
    addCol(`ALTER TABLE ledger_entries ADD COLUMN voucher_number TEXT`);
    // Back-fill updated_at for existing rows
    db.exec(`UPDATE expenditures SET updated_at = created_at WHERE updated_at IS NULL`);

    // Back-fill missing cashbook entries for expenditures that have a journal_entry_id
    // but no corresponding cashbook_entries row (result of old crash bug)
    const missingCashbook = db.prepare(`
        SELECT e.*, je.id as je_id
        FROM expenditures e
        JOIN journal_entries je ON je.id = e.journal_entry_id
        WHERE e.is_deleted = 0
          AND e.journal_entry_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM cashbook_entries ce WHERE ce.journal_entry_id = e.journal_entry_id
          )
    `).all();

    for (const exp of missingCashbook) {
        const desc = `${exp.category}: ${exp.description}${exp.vendor_name ? ' (' + exp.vendor_name + ')' : ''}`;
        db.prepare(`INSERT INTO cashbook_entries (entry_date, description, voucher_number, cash_out, bank_out, journal_entry_id)
            VALUES (?, ?, ?, ?, ?, ?)`)
            .run(
                exp.expenditure_date,
                desc,
                exp.voucher_number || null,
                exp.payment_method === 'cash' ? exp.amount : 0,
                exp.payment_method === 'bank' ? exp.amount : 0,
                exp.je_id
            );
        console.log(`[Migration 10] Back-filled cashbook entry for expenditure id=${exp.id}`);
    }

    db.prepare(`UPDATE settings SET value = '10' WHERE key = 'schema_version'`).run();
    currentVersion = 10;
  }

  // Migration 11: Bank deposits tracking table
  if (currentVersion < 11) {
    console.log('Running migration 11 (bank_deposits table)...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS bank_deposits (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        deposit_date     TEXT    NOT NULL,
        bank_name        TEXT    NOT NULL DEFAULT 'Allied Bank Ltd',
        account_number   TEXT,
        amount           REAL    NOT NULL,
        description      TEXT,
        reference_number TEXT,
        deposited_by     TEXT,
        created_at       TEXT    DEFAULT (datetime('now'))
      )
    `);
    db.prepare(`UPDATE settings SET value = '11' WHERE key = 'schema_version'`).run();
    currentVersion = 11;
  }

  // Migration 12: Plot advance credit balance
  if (currentVersion < 12) {
    console.log('Running migration 12 (plot_credits table)...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS plot_credits (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        plot_id    INTEGER NOT NULL UNIQUE REFERENCES plots(id),
        balance    REAL    NOT NULL DEFAULT 0,
        updated_at TEXT    DEFAULT (datetime('now'))
      )
    `);
    db.prepare(`UPDATE settings SET value = '12' WHERE key = 'schema_version'`).run();
    currentVersion = 12;
  }

  // Migration 13: Fix tenants with empty-string end_date/start_date (should be NULL)
  if (currentVersion < 13) {
    console.log('Running migration 13 (fix empty string end_date/start_date on tenants)...');
    db.exec(`UPDATE tenants SET end_date = NULL WHERE end_date = ''`);
    db.exec(`UPDATE tenants SET start_date = NULL WHERE start_date = ''`);
    db.prepare(`UPDATE settings SET value = '13' WHERE key = 'schema_version'`).run();
    currentVersion = 13;
  }

  // Migration 14: Reconcile bank_deposits columns
  // Handles two possible prior states:
  //  a) Created by initial schema (has total_amount, journal_entry_id; missing reference_number, deposited_by)
  //  b) Created by migration 11 (has amount, reference_number, deposited_by; missing total_amount, journal_entry_id)
  if (currentVersion < 14) {
    console.log('Running migration 14 (reconcile bank_deposits columns)...');
    const tryAdd = (sql) => { try { db.exec(sql); } catch(_) { /* column already exists, skip */ } };
    tryAdd(`ALTER TABLE bank_deposits ADD COLUMN total_amount REAL`);
    // If rows have amount but total_amount is null, copy amount → total_amount
    try { db.exec(`UPDATE bank_deposits SET total_amount = amount WHERE (total_amount IS NULL OR total_amount = 0) AND amount IS NOT NULL AND amount > 0`); } catch(_) {}
    tryAdd(`ALTER TABLE bank_deposits ADD COLUMN reference_number TEXT`);
    tryAdd(`ALTER TABLE bank_deposits ADD COLUMN deposited_by TEXT`);
    tryAdd(`ALTER TABLE bank_deposits ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id)`);
    db.prepare(`UPDATE settings SET value = '14' WHERE key = 'schema_version'`).run();
    currentVersion = 14;
  }

  // Migration 15: charge_account_map + payment_allocations tables
  if (currentVersion < 15) {
    console.log('Running migration 15 (charge_account_map + payment_allocations)...');

    db.exec(`
      CREATE TABLE IF NOT EXISTS payment_allocations (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id     INTEGER NOT NULL REFERENCES payments(id),
        bill_id        INTEGER NOT NULL REFERENCES bills(id),
        amount_applied REAL    NOT NULL,
        created_at     TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_alloc_payment ON payment_allocations(payment_id);
      CREATE INDEX IF NOT EXISTS idx_alloc_bill    ON payment_allocations(bill_id);

      CREATE TABLE IF NOT EXISTS charge_account_map (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        charge_name  TEXT NOT NULL UNIQUE,
        account_code TEXT NOT NULL
      );
    `);

    // Seed default mappings
    const insertMap = db.prepare(`
      INSERT OR IGNORE INTO charge_account_map (charge_name, account_code) VALUES (?, ?)
    `);
    insertMap.run('Monthly Contribution',    '4000');
    insertMap.run('Base Contribution',       '4000');
    insertMap.run('Monthly Tenant Challan',  '4004');
    insertMap.run('Mosque Contribution',     '4001');
    insertMap.run('Mosque Fund',             '4001');
    insertMap.run('Garbage Collection',      '4002');
    insertMap.run('Garbage Charges',         '4002');
    insertMap.run('Aquifer Contribution',    '4003');
    insertMap.run('Aquifer Charges',         '4003');
    insertMap.run('Per Extra Floor',         '4000');

    // Also seed new fund accounts if not already present
    const insertAcc = db.prepare(`
      INSERT OR IGNORE INTO accounts (account_code, account_name, account_type, normal_balance)
      VALUES (?, ?, 'revenue', 'credit')
    `);
    insertAcc.run('4001', 'Mosque Fund Collections');
    insertAcc.run('4002', 'Garbage Fund Collections');
    insertAcc.run('4003', 'Aquifer Fund Collections');
    insertAcc.run('4004', 'Tenant Challan Income');

    // Force-update account names to correct fund names
    db.prepare(`UPDATE accounts SET account_name = 'Mosque Fund Collections'  WHERE account_code = '4001'`).run();
    db.prepare(`UPDATE accounts SET account_name = 'Garbage Fund Collections' WHERE account_code = '4002'`).run();
    db.prepare(`UPDATE accounts SET account_name = 'Aquifer Fund Collections' WHERE account_code = '4003'`).run();
    db.prepare(`UPDATE accounts SET account_name = 'Tenant Challan Income'    WHERE account_code = '4004'`).run();

    db.prepare(`UPDATE settings SET value = '15' WHERE key = 'schema_version'`).run();
    currentVersion = 15;
  }

  // Migration 16: bills.notice for per-month remarks printed on challans
  if (currentVersion < 16) {
    console.log('Running migration 16 (add bills.notice column)...');
    try {
      db.exec(`ALTER TABLE bills ADD COLUMN notice TEXT`);
    } catch (_) {
      // Column already exists on some installations.
    }
    db.prepare(`UPDATE settings SET value = '16' WHERE key = 'schema_version'`).run();
    currentVersion = 16;
  }

  // Migration 17: Enforce exact special charges master list for all installs
  if (currentVersion < 17) {
    console.log('Running migration 17 (special charges master list sync)...');

    const upsertCharge = db.prepare(`
      INSERT INTO onetime_charges (charge_name, base_amount, is_percentage, percentage_value, varies_by_marla, is_active, notes)
      VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(charge_name) DO UPDATE SET
        base_amount = excluded.base_amount,
        is_percentage = excluded.is_percentage,
        percentage_value = excluded.percentage_value,
        varies_by_marla = excluded.varies_by_marla,
        is_active = 1,
        notes = excluded.notes
    `);

    const charges = [
      ['Membership Charges', 1000, 0, null, 0, 'Rs. 1000 fixed'],
      ['Share Capital', 4000, 0, null, 0, 'Rs. 4000 fixed (Rs. 1000 per share x 4)'],
      ['Transfer Contribution from buyer', null, 1, 3.0, 0, '3% of highest: Sale Deed / DC Rate / FBR Rate'],
      ['Transfer Contribution from Seller', null, 1, 1.0, 0, '1% of highest: Sale Deed / DC Rate / FBR Rate'],
      ['Possession Contribution', 100000, 0, null, 1, 'Rs. 100,000 fixed; half for 10 Marla'],
      ['Demarcation Contribution', 100000, 0, null, 1, 'Rs. 100,000 fixed; half for 10 Marla'],
      ['Water Connection Charges', 15000, 0, null, 0, 'Rs. 15,000 fixed'],
      ['Sewerage Connection Charges', 15000, 0, null, 0, 'Rs. 15,000 fixed'],
      ['Park Booking (Member)', 20000, 0, null, 0, 'Rs. 20,000 per day'],
      ['Park Booking (Non-Member)', 40000, 0, null, 0, 'Rs. 40,000 per day'],
      ['NOC for Sub Division (Corner Plot)', 1000000, 0, null, 0, 'Rs. 1,000,000 fixed'],
      ['NOC for Sub Division (Pre-2019 Constructed)', 500000, 0, null, 0, 'Rs. 500,000 fixed'],
      ['Others', null, 0, null, 0, 'Custom amount entered manually'],
    ];

    for (const c of charges) {
      upsertCharge.run(c[0], c[1], c[2], c[3], c[4], c[5]);
    }

    // Deactivate legacy aliases so the UI consistently shows the approved names/rates.
    const legacyNames = [
      'Membership',
      'Transfer (Buyer)',
      'Transfer (Seller)',
      'Water Connection',
      'Sewerage Connection',
      'NOC Sub-Division (Corner)',
      'NOC Sub-Division (Pre-2019)',
      'Mosque Fund (Transfer)'
    ];
    const deactivateLegacy = db.prepare('UPDATE onetime_charges SET is_active = 0 WHERE charge_name = ?');
    for (const name of legacyNames) {
      deactivateLegacy.run(name);
    }

    db.prepare(`UPDATE settings SET value = '17' WHERE key = 'schema_version'`).run();
    currentVersion = 17;
  }

  // Migration 18: Banks management table
  if (currentVersion < 18) {
    console.log('Running migration 18 (banks management table)...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS banks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bank_name TEXT NOT NULL UNIQUE,
        account_number TEXT,
        branch_name TEXT,
        branch_code TEXT,
        iban TEXT,
        account_id INTEGER REFERENCES accounts(id),
        is_active BOOLEAN DEFAULT 1,
        is_default BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get the existing Allied Bank account (1001)
    const alliedAccount = db.prepare("SELECT id FROM accounts WHERE account_code = '1001'").get();

    // Insert Allied Bank as the default bank linked to account 1001
    if (alliedAccount) {
      db.prepare(`
        INSERT OR IGNORE INTO banks (bank_name, account_id, is_active, is_default)
        VALUES ('Allied Bank Ltd (ABL)', ?, 1, 1)
      `).run(alliedAccount.id);
    }

    db.prepare(`UPDATE settings SET value = '18' WHERE key = 'schema_version'`).run();
    currentVersion = 18;
  }

  // Migration 19: Add Special Challan Revenue and Expense Categories to Chart of Accounts
  if (currentVersion < 19) {
    console.log('Running migration 19 (Special Challan revenue & expense categories)...');
    
    const insertAccount = db.prepare(`
      INSERT OR IGNORE INTO accounts (account_code, account_name, account_type, normal_balance)
      VALUES (?, ?, ?, ?)
    `);

    // Revenue accounts for Special Challan (4xxx series)
    const revenueAccounts = [
      ['4010', 'Membership Charges Income', 'revenue', 'credit'],
      ['4011', 'Share Capital Income', 'revenue', 'credit'],
      ['4012', 'Transfer Contribution (Buyer)', 'revenue', 'credit'],
      ['4013', 'Transfer Contribution (Seller)', 'revenue', 'credit'],
      ['4014', 'Possession Contribution Income', 'revenue', 'credit'],
      ['4015', 'Demarcation Contribution Income', 'revenue', 'credit'],
      ['4016', 'Water Connection Charges Income', 'revenue', 'credit'],
      ['4017', 'Sewerage Connection Charges Income', 'revenue', 'credit'],
      ['4018', 'Park Booking Income (Member)', 'revenue', 'credit'],
      ['4019', 'Park Booking Income (Non-Member)', 'revenue', 'credit'],
      ['4020', 'NOC Sub Division Income', 'revenue', 'credit'],
      ['4021', 'Other Special Charges Income', 'revenue', 'credit'],
    ];

    // Expense accounts from Record Expenditures categories (5xxx series)
    const expenseAccounts = [
      ['5010', 'Generator / Fuel Expenses', 'expense', 'debit'],
      ['5011', 'Security Expenses', 'expense', 'debit'],
      ['5012', 'Cleaning Expenses', 'expense', 'debit'],
      ['5013', 'Bank Charges', 'expense', 'debit'],
      ['5014', 'Electricity Bill - Tube-well', 'expense', 'debit'],
      ['5015', 'Electricity Bill - Streetlight', 'expense', 'debit'],
      ['5016', 'Electricity Bill - Office', 'expense', 'debit'],
      ['5017', 'Telephone Bill - Office', 'expense', 'debit'],
      ['5018', 'Telephone Bill - Security', 'expense', 'debit'],
      ['5019', 'Repair & Maintenance - Electricity Equipment', 'expense', 'debit'],
      ['5020', 'Repair & Maintenance - Machinery & Equipment', 'expense', 'debit'],
      ['5021', 'Repair & Maintenance - Office & Equipment', 'expense', 'debit'],
      ['5022', 'Advertisement (AGM)', 'expense', 'debit'],
      ['5023', 'Books & Periodicals & Newspapers', 'expense', 'debit'],
      ['5024', 'Oil & Lubricants Expenses', 'expense', 'debit'],
      ['5025', 'Post & Telegram Contribution', 'expense', 'debit'],
      ['5026', 'Printing & Stationery', 'expense', 'debit'],
      ['5027', 'Audit Fee', 'expense', 'debit'],
      ['5028', 'Professional Fee', 'expense', 'debit'],
      ['5029', 'Punjab Employees Social Security', 'expense', 'debit'],
      ['5030', 'Travelling & Conveyance', 'expense', 'debit'],
      ['5031', 'Tree Plantation', 'expense', 'debit'],
      ['5032', 'Entertainment', 'expense', 'debit'],
      ['5033', 'Entertainment AGM', 'expense', 'debit'],
      ['5034', 'Repair & Maintenance - Building/Boundary Wall', 'expense', 'debit'],
      ['5035', 'Maintenance - Water Pipe Line', 'expense', 'debit'],
      ['5036', 'Maintenance - Sewerage Pipeline/Gutters', 'expense', 'debit'],
      ['5037', 'Repair & Maintenance - Internal Roads', 'expense', 'debit'],
      ['5038', 'Miscellaneous Expenses', 'expense', 'debit'],
      ['5039', 'Unexpected Expenses', 'expense', 'debit'],
      ['5040', 'Stationery & Office Supplies', 'expense', 'debit'],
    ];

    db.transaction(() => {
      for (const acc of revenueAccounts) {
        insertAccount.run(acc[0], acc[1], acc[2], acc[3]);
      }
      for (const acc of expenseAccounts) {
        insertAccount.run(acc[0], acc[1], acc[2], acc[3]);
      }
    })();

    db.prepare(`UPDATE settings SET value = '19' WHERE key = 'schema_version'`).run();
    currentVersion = 19;
  }

  // Migration 20: Create expense_category_map and seed charge_account_map for Special Challans
  if (currentVersion < 20) {
    console.log('Running migration 20 (expense category mapping & special challan revenue mapping)...');

    // Create expense category to account mapping table
    db.exec(`
      CREATE TABLE IF NOT EXISTS expense_category_map (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        category_name TEXT NOT NULL UNIQUE,
        account_code TEXT NOT NULL
      )
    `);

    // Seed expense category mappings
    const insertExpMap = db.prepare(`
      INSERT OR IGNORE INTO expense_category_map (category_name, account_code) VALUES (?, ?)
    `);

    const expenseMappings = [
      ['Salaries', '5001'],
      ['Generator / Fuel', '5010'],
      ['Maintenance & Repairs', '5002'],
      ['Utilities', '5003'],
      ['Stationery & Office', '5040'],
      ['Security', '5011'],
      ['Cleaning', '5012'],
      ['Bank Charges', '5013'],
      ['Electricity Bill Tube-well', '5014'],
      ['Electricity Bill Streetlight', '5015'],
      ['Electricity Bill Office', '5016'],
      ['Telephone Bill Office', '5017'],
      ['Telephone Bill Security', '5018'],
      ['Repair & Maintenance Electricity Equipments', '5019'],
      ['Repair & Maintenance Machinery & Equipments', '5020'],
      ['Repair & Maintenance Office & Equipments', '5021'],
      ['Advertisement (AGM)', '5022'],
      ['Books & Periodicals & Newspapers', '5023'],
      ['Oil & Lubricants Expenses', '5024'],
      ['Post & Telegram Contribution', '5025'],
      ['Printing & Stationery Contribution', '5026'],
      ['Audit fee', '5027'],
      ['Professional fee', '5028'],
      ['Punjab Employees Social Security', '5029'],
      ['Travelling & Conveyance Contribution', '5030'],
      ['Tree Plantation', '5031'],
      ['Entertainment', '5032'],
      ['Entertainment AGM', '5033'],
      ['Repair & Maintenance of Building/Boundary wall', '5034'],
      ['Maintenance of Water Pipe Line', '5035'],
      ['Maintenance of Sewerage Pipeline/Gutters', '5036'],
      ['Repair & Maintenance of Internal Roads', '5037'],
      ['Miscellaneous Expenses', '5038'],
      ['Unexpected Expenses', '5039'],
      ['Other', '5000'],
    ];

    // Seed Special Challan revenue mappings (charge_account_map)
    const insertChargeMap = db.prepare(`
      INSERT OR IGNORE INTO charge_account_map (charge_name, account_code) VALUES (?, ?)
    `);

    const specialChallanMappings = [
      ['Membership Charges', '4010'],
      ['Share Capital', '4011'],
      ['Transfer Contribution from buyer', '4012'],
      ['Transfer Contribution from Seller', '4013'],
      ['Possession Contribution', '4014'],
      ['Demarcation Contribution', '4015'],
      ['Water Connection Charges', '4016'],
      ['Sewerage Connection Charges', '4017'],
      ['Park Booking (Member)', '4018'],
      ['Park Booking (Non-Member)', '4019'],
      ['NOC for Sub Division (Corner Plot)', '4020'],
      ['NOC for Sub Division (Pre-2019 Constructed)', '4020'],
      ['Others', '4021'],
    ];

    db.transaction(() => {
      for (const [cat, code] of expenseMappings) {
        insertExpMap.run(cat, code);
      }
      for (const [charge, code] of specialChallanMappings) {
        insertChargeMap.run(charge, code);
      }
    })();

    db.prepare(`UPDATE settings SET value = '20' WHERE key = 'schema_version'`).run();
    currentVersion = 20;
  }
}