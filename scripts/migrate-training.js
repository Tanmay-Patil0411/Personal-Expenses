require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    console.log('Ensuring training tables exist in PostgreSQL...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS training_datasets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'kaggle',
        filename TEXT,
        row_count INTEGER NOT NULL DEFAULT 0,
        expense_row_count INTEGER NOT NULL DEFAULT 0,
        months_count INTEGER NOT NULL DEFAULT 0,
        start_date TEXT,
        end_date TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS training_records (
        id SERIAL PRIMARY KEY,
        dataset_id INTEGER REFERENCES training_datasets(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        transaction_date DATE NOT NULL,
        transaction_type transaction_type NOT NULL,
        amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
        category TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_training_records_dataset_id ON training_records(dataset_id);
      CREATE INDEX IF NOT EXISTS idx_training_records_user_id ON training_records(user_id);
      CREATE INDEX IF NOT EXISTS idx_training_records_type ON training_records(transaction_type);
      CREATE INDEX IF NOT EXISTS idx_training_records_date ON training_records(transaction_date);
    `);
    console.log('Tables verified.');

    const check = await pool.query('SELECT count(*)::int as c FROM training_records');
    if (check.rows[0].c > 0) {
      console.log('Training records already populated:', check.rows[0].c);
    } else {
      const res = await pool.query(`
        SELECT id, user_id, transaction_date, transaction_type, amount, category, payment_method, description
        FROM transactions
        WHERE transaction_date < '2023-01-01'
           OR description LIKE '%Place %'
           OR description LIKE '%Idli%'
           OR description LIKE '%Ganesh%'
           OR description LIKE '%Tata Play%'
           OR description LIKE '%booster pack%'
      `);
      console.log('Found Kaggle records in transactions table:', res.rows.length);

      if (res.rows.length > 0) {
        const targetUserId = res.rows[0].user_id;
        const expenseRows = res.rows.filter(r => r.transaction_type === 'Expense');
        const uniqueMonths = new Set(expenseRows.map(r => new Date(r.transaction_date).toISOString().slice(0, 7)));
        const dates = res.rows.map(r => new Date(r.transaction_date).toISOString().slice(0, 10)).sort();

        const dsRes = await pool.query(`
          INSERT INTO training_datasets (user_id, name, source, filename, row_count, expense_row_count, months_count, start_date, end_date, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
          RETURNING id
        `, [
          targetUserId,
          'Daily Household Transactions (Kaggle)',
          'kaggle',
          'Daily Household Transactions.csv',
          res.rows.length,
          expenseRows.length,
          uniqueMonths.size,
          dates[0],
          dates[dates.length - 1]
        ]);

        const datasetId = dsRes.rows[0].id;
        console.log('Created training_dataset id:', datasetId);

        for (let i = 0; i < res.rows.length; i += 200) {
          const chunk = res.rows.slice(i, i + 200);
          const values = [];
          const params = [];
          let p = 1;
          for (const r of chunk) {
            params.push(`($${p}, $${p+1}, $${p+2}, $${p+3}, $${p+4}, $${p+5}, $${p+6}, $${p+7})`);
            values.push(
              datasetId,
              r.user_id,
              new Date(r.transaction_date).toISOString().slice(0, 10),
              r.transaction_type,
              r.amount,
              r.category,
              r.payment_method,
              r.description
            );
            p += 8;
          }
          await pool.query(
            `INSERT INTO training_records (dataset_id, user_id, transaction_date, transaction_type, amount, category, payment_method, description) VALUES ` + params.join(', '),
            values
          );
        }
        console.log(`Inserted ${res.rows.length} rows into training_records.`);

        const ids = res.rows.map(r => r.id);
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          await pool.query(`DELETE FROM transactions WHERE id = ANY($1)`, [chunk]);
        }
        console.log('Successfully cleaned up Kaggle rows from personal transactions table.');
      }
    }

    const tCount = await pool.query('SELECT count(*)::int as c FROM transactions');
    const trCount = await pool.query('SELECT count(*)::int as c FROM training_records');
    const dsCount = await pool.query('SELECT count(*)::int as c FROM training_datasets');
    console.log({
      personalTransactionsCount: tCount.rows[0].c,
      trainingRecordsCount: trCount.rows[0].c,
      trainingDatasetsCount: dsCount.rows[0].c,
    });
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
