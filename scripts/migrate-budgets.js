require('dotenv').config();
const { Pool } = require('pg');

async function migrateDb(url, label) {
  if (!url) return;
  const pool = new Pool({ connectionString: url });
  try {
    console.log(`Applying budget table column extensions to ${label}...`);
    await pool.query(`
      ALTER TABLE budgets ADD COLUMN IF NOT EXISTS name TEXT;
      ALTER TABLE budgets ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE budgets ADD COLUMN IF NOT EXISTS alert_threshold INTEGER DEFAULT 80;
      ALTER TABLE budgets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
      ALTER TABLE budgets ADD COLUMN IF NOT EXISTS period_type TEXT DEFAULT 'monthly';
      ALTER TABLE budgets ADD COLUMN IF NOT EXISTS start_date DATE;
      ALTER TABLE budgets ADD COLUMN IF NOT EXISTS end_date DATE;
      ALTER TABLE budgets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
    `);
    console.log(`Migration verified for ${label}.`);
    await pool.end();
  } catch (err) {
    console.error(`Migration failed for ${label}:`, err.message);
    await pool.end();
  }
}

async function run() {
  await migrateDb(process.env.DATABASE_URL, 'app_db');
  await migrateDb(process.env.TEST_DATABASE_URL, 'app_db_test');
  process.exit(0);
}

run();
