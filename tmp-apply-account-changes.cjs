const Database = require('better-sqlite3')

const dbPath = process.argv[2]
if (!dbPath) {
  console.error('Missing db path')
  process.exit(1)
}

const db = new Database(dbPath)

db.transaction(() => {
  db.prepare(`
    UPDATE accounts
    SET account_name = 'Special Bill Revenue - Stationery & Office Supplies',
        account_type = 'revenue',
        normal_balance = 'credit'
    WHERE account_code = '5040'
  `).run()

  db.prepare(`
    INSERT INTO charge_account_map (charge_name, account_code)
    VALUES ('Others', '5040')
    ON CONFLICT(charge_name) DO UPDATE SET account_code = excluded.account_code
  `).run()

  db.prepare(`UPDATE accounts SET is_active = 0 WHERE account_code IN ('5000', '3000', '4010')`).run()
})()

const check = {
  remapped: db.prepare(`SELECT account_code, account_name, account_type, normal_balance, is_active FROM accounts WHERE account_code = '5040'`).get(),
  othersMap: db.prepare(`SELECT charge_name, account_code FROM charge_account_map WHERE charge_name = 'Others'`).get(),
  disabled: db.prepare(`SELECT account_code, account_name, is_active FROM accounts WHERE account_code IN ('5000', '3000', '4010') ORDER BY account_code`).all(),
}

console.log(JSON.stringify(check, null, 2))
