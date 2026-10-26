const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    connectionString: 'postgresql://postgres:Tanmay0411@127.0.0.1:5432/app_db',
  });

  const del = await pool.query("DELETE FROM predictions WHERE target_month < '2024-01'");
  console.log('Deleted stale predictions:', del.rowCount);

  const remaining = await pool.query('SELECT * FROM predictions');
  console.log('Remaining predictions in DB:', remaining.rows);

  await pool.end();
}

main().catch(console.error);
