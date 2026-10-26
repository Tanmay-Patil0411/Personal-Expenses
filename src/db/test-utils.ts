import { sql } from "drizzle-orm";
import { db } from "./index";

// Drops + recreates the tables needed by the test suite in the isolated
// test database (app_db_test). Keeps tests independent of each other and of
// any personal records in the main database.
export const TEST_DDL = `
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS predictions;
DROP TABLE IF EXISTS model_runs;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS app_settings;
DROP TABLE IF EXISTS training_records;
DROP TABLE IF EXISTS training_datasets;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS users;
DROP TYPE IF EXISTS transaction_type;

CREATE TYPE transaction_type AS ENUM ('Income', 'Expense');

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_users_email ON users(email);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

CREATE TABLE password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token);

CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  transaction_type transaction_type NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  external_transaction_id TEXT UNIQUE
);
CREATE INDEX idx_transactions_type ON transactions(transaction_type);
CREATE INDEX idx_transactions_date ON transactions(transaction_date);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);

CREATE TABLE budgets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  category TEXT,
  budget_amount NUMERIC(14,2) NOT NULL CHECK (budget_amount > 0),
  name TEXT,
  notes TEXT,
  alert_threshold INTEGER DEFAULT 80,
  status TEXT DEFAULT 'active',
  period_type TEXT DEFAULT 'monthly',
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT budgets_user_month_category UNIQUE NULLS NOT DISTINCT (user_id, month, category)
);

CREATE TABLE model_runs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  dataset_mode TEXT NOT NULL DEFAULT 'real',
  data_start_date TEXT,
  data_end_date TEXT,
  training_start TIMESTAMPTZ NOT NULL,
  training_end TIMESTAMPTZ,
  sequence_length INTEGER NOT NULL,
  training_status TEXT NOT NULL,
  error_message TEXT,
  mae NUMERIC(18,6),
  rmse NUMERIC(18,6),
  mape NUMERIC(18,6),
  train_samples INTEGER,
  val_samples INTEGER,
  test_samples INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE predictions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  target_month TEXT NOT NULL,
  predicted_expense NUMERIC(14,2) NOT NULL,
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE training_datasets (
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

CREATE TABLE training_records (
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
CREATE INDEX idx_training_records_dataset_id ON training_records(dataset_id);
CREATE INDEX idx_training_records_user_id ON training_records(user_id);
CREATE INDEX idx_training_records_type ON training_records(transaction_type);
CREATE INDEX idx_training_records_date ON training_records(transaction_date);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Execute multi-statement DDL directly on the pool.
export async function resetTestSchema(): Promise<void> {
  // drizzle's execute only supports a single statement, so split naively.
  const statements = TEST_DDL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt));
  }
}

export async function getSchema(): Promise<{ tablename: string }[]> {
  const res = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  );
  return res.rows as { tablename: string }[];
}
