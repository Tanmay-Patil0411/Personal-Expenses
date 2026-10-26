import { db } from "@/db";
import {
  trainingDatasets,
  trainingRecords,
  transactions,
  type TrainingDatasetRow,
  type TrainingRecordRow,
} from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import type { CsvTransactionInput } from "./csvService";
import type { Transaction, TransactionType } from "./types";

export interface SaveTrainingDatasetOptions {
  name: string;
  source?: string;
  filename?: string;
  validRows: CsvTransactionInput[];
  userId?: number;
}

export async function ensureTrainingTables(): Promise<void> {
  await db.execute(sql`
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
}

/**
 * Migrates any Kaggle records mistakenly imported into `transactions`
 * into `training_datasets` and `training_records`, and removes them from `transactions`.
 */
export async function migrateExistingKaggleTransactions(): Promise<{
  migrated: number;
}> {
  await ensureTrainingTables();

  // Check if training_records already has data
  const existingCountRes = await db.execute(
    sql`SELECT count(*)::int as count FROM training_records`,
  );
  const existingCount = Number(existingCountRes.rows[0]?.count ?? 0);

  // Find Kaggle transactions in transactions table (e.g. from Daily Household Transactions.csv)
  // Characterized by descriptions from the Kaggle dataset, or large batches before 2024
  const kaggleRowsRes = await db.execute(
    sql`SELECT id, user_id, transaction_date, transaction_type, amount, category, payment_method, description
        FROM transactions
        WHERE description LIKE '%Place %'
           OR description LIKE '%Tata Play%'
           OR description LIKE '%Idli%'
           OR description LIKE '%Ganesh%'
           OR description LIKE '%booster pack%'
           OR description LIKE '%subscription%'
           OR (transaction_date < '2023-01-01' AND (user_id IS NOT NULL OR user_id IS NULL))
        ORDER BY transaction_date ASC`,
  );

  const kaggleRows = kaggleRowsRes.rows as any[];
  if (kaggleRows.length === 0) {
    return { migrated: 0 };
  }

  // If training_records already has records and transactions has none of these, return
  const expenseRows = kaggleRows.filter((r) => r.transaction_type === "Expense");
  const uniqueMonths = new Set(expenseRows.map((r) => String(r.transaction_date).slice(0, 7)));
  const dates = kaggleRows.map((r) => String(r.transaction_date).slice(0, 10)).sort();
  const startDate = dates[0] ?? null;
  const endDate = dates[dates.length - 1] ?? null;
  const targetUserId = kaggleRows[0]?.user_id ?? null;

  // Insert dataset header
  let datasetId: number;
  const [createdDataset] = await db
    .insert(trainingDatasets)
    .values({
      userId: targetUserId,
      name: "Daily Household Transactions (Kaggle)",
      source: "kaggle",
      filename: "Daily Household Transactions.csv",
      rowCount: kaggleRows.length,
      expenseRowCount: expenseRows.length,
      monthsCount: uniqueMonths.size,
      startDate,
      endDate,
      isActive: 1,
    })
    .returning();
  datasetId = createdDataset.id;

  // Batch insert into training_records in chunks of 250
  const CHUNK_SIZE = 250;
  for (let i = 0; i < kaggleRows.length; i += CHUNK_SIZE) {
    const chunk = kaggleRows.slice(i, i + CHUNK_SIZE);
    await db.insert(trainingRecords).values(
      chunk.map((r) => ({
        datasetId,
        userId: r.user_id ?? targetUserId,
        transactionDate: String(r.transaction_date).slice(0, 10),
        transactionType: r.transaction_type as TransactionType,
        amount: String(r.amount),
        category: r.category,
        paymentMethod: r.payment_method,
        description: r.description,
      })),
    );
  }

  // Delete from transactions so personal dashboard only shows personal transactions!
  const idsToDelete = kaggleRows.map((r) => r.id);
  for (let i = 0; i < idsToDelete.length; i += CHUNK_SIZE) {
    const idChunk = idsToDelete.slice(i, i + CHUNK_SIZE);
    await db.execute(
      sql`DELETE FROM transactions WHERE id IN (${sql.raw(idChunk.join(","))})`,
    );
  }

  return { migrated: kaggleRows.length };
}

export async function saveTrainingDataset(
  options: SaveTrainingDatasetOptions,
): Promise<{ dataset: TrainingDatasetRow; count: number }> {
  await ensureTrainingTables();

  const { name, source = "kaggle", filename, validRows, userId } = options;
  const expenseRows = validRows.filter((r) => r.transactionType === "Expense");
  const uniqueMonths = new Set(
    expenseRows.map((r) => r.transactionDate.slice(0, 7)),
  );
  const dates = validRows.map((r) => r.transactionDate).sort();
  const startDate = dates[0] ?? null;
  const endDate = dates[dates.length - 1] ?? null;

  // Deactivate previous active datasets for this user (or global)
  if (userId != null) {
    await db
      .update(trainingDatasets)
      .set({ isActive: 0 })
      .where(eq(trainingDatasets.userId, userId));
  } else {
    await db.update(trainingDatasets).set({ isActive: 0 });
  }

  const [dataset] = await db
    .insert(trainingDatasets)
    .values({
      userId: userId ?? null,
      name,
      source,
      filename: filename ?? null,
      rowCount: validRows.length,
      expenseRowCount: expenseRows.length,
      monthsCount: uniqueMonths.size,
      startDate,
      endDate,
      isActive: 1,
    })
    .returning();

  // Batch insert training records
  const CHUNK_SIZE = 250;
  for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + CHUNK_SIZE);
    await db.insert(trainingRecords).values(
      chunk.map((r) => ({
        datasetId: dataset.id,
        userId: userId ?? null,
        transactionDate: r.transactionDate,
        transactionType: r.transactionType,
        amount: String(r.amount),
        category: r.category,
        paymentMethod: r.paymentMethod,
        description: r.description || null,
      })),
    );
  }

  return { dataset, count: validRows.length };
}

export async function getActiveTrainingDataset(
  userId?: number,
): Promise<TrainingDatasetRow | null> {
  await ensureTrainingTables();

  const condition =
    userId != null
      ? and(
          eq(trainingDatasets.isActive, 1),
          eq(trainingDatasets.userId, userId),
        )
      : eq(trainingDatasets.isActive, 1);

  const [row] = await db
    .select()
    .from(trainingDatasets)
    .where(condition)
    .orderBy(desc(trainingDatasets.createdAt))
    .limit(1);

  if (row) return row;

  // Fallback to latest dataset without user if available
  const [globalRow] = await db
    .select()
    .from(trainingDatasets)
    .where(eq(trainingDatasets.isActive, 1))
    .orderBy(desc(trainingDatasets.createdAt))
    .limit(1);

  return globalRow ?? null;
}

export async function getTrainingRecords(
  userId?: number,
  datasetId?: number,
): Promise<Transaction[]> {
  await ensureTrainingTables();

  let targetDatasetId = datasetId;
  if (!targetDatasetId) {
    const active = await getActiveTrainingDataset(userId);
    if (!active) return [];
    targetDatasetId = active.id;
  }

  const rows = await db
    .select()
    .from(trainingRecords)
    .where(eq(trainingRecords.datasetId, targetDatasetId))
    .orderBy(trainingRecords.transactionDate);

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    transactionDate: r.transactionDate,
    transactionType: r.transactionType as TransactionType,
    amount: Number(r.amount),
    category: r.category,
    paymentMethod: r.paymentMethod,
    description: r.description,
    createdAt: r.createdAt ? String(r.createdAt) : undefined,
  }));
}
