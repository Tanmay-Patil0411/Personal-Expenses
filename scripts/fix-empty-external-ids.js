const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    connectionString: 'postgresql://postgres:Tanmay0411@127.0.0.1:5432/app_db',
  });

  const res = await pool.query(
    "UPDATE transactions SET external_transaction_id = NULL WHERE external_transaction_id = '' OR trim(external_transaction_id) = ''"
  );
  console.log(`Updated ${res.rowCount} rows with empty external_transaction_id to NULL.`);

  const rows = await pool.query(
    'SELECT id, user_id, amount, external_transaction_id, description FROM transactions'
  );
  console.log('Current transactions:', rows.rows);

  await pool.end();
}

main().catch(console.error);
