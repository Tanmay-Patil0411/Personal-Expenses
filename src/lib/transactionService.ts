import { db } from "@/db";
import { transactions, predictions, type TransactionRow } from "@/db/schema";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  type Transaction,
  type TransactionInput,
  type TransactionType,
} from "./types";
import { DEFAULT_SETTINGS, normalizeMonthKey } from "./config";

function toNumber(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" ? n : Number(n);
}

function rowToTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    userId: row.userId,
    transactionDate: row.transactionDate,
    transactionType: row.transactionType as TransactionType,
    amount: toNumber(row.amount),
    category: row.category,
    paymentMethod: row.paymentMethod,
    description: row.description,
    createdAt: row.createdAt ? String(row.createdAt) : undefined,
    externalTransactionId: row.externalTransactionId,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateTransactionInput(
  input: Partial<TransactionInput>,
): ValidationResult {
  const { transactionDate, transactionType, amount, category, paymentMethod } =
    input;

  if (!transactionDate || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
    return { ok: false, error: "Transaction date must be YYYY-MM-DD." };
  }
  const d = new Date(transactionDate);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: "Invalid transaction date." };
  }

  if (transactionType !== "Income" && transactionType !== "Expense") {
    return {
      ok: false,
      error: "Transaction type must be 'Income' or 'Expense'.",
    };
  }

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, error: "Amount must be a positive number." };
  }

  const allowed =
    transactionType === "Income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (!category || !allowed.includes(category as never)) {
    return {
      ok: false,
      error: `Category '${category ?? ""}' is not valid for ${transactionType}.`,
    };
  }

  if (!paymentMethod || !PAYMENT_METHODS.includes(paymentMethod as never)) {
    return {
      ok: false,
      error: `Payment method '${paymentMethod ?? ""}' is not valid.`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export async function createTransaction(
  input: TransactionInput,
  userId?: number,
): Promise<Transaction> {
  const v = validateTransactionInput(input);
  if (!v.ok) throw new Error(v.error);

  const effectiveUserId = userId ?? input.userId ?? null;
  const rawDesc = input.description ? String(input.description).trim() : null;
  const rawExtId = input.externalTransactionId
    ? String(input.externalTransactionId).trim()
    : null;

  const [row] = await db
    .insert(transactions)
    .values({
      userId: effectiveUserId,
      transactionDate: input.transactionDate,
      transactionType: input.transactionType,
      amount: String(input.amount),
      category: input.category,
      paymentMethod: input.paymentMethod,
      description: rawDesc && rawDesc.length > 0 ? rawDesc : null,
      externalTransactionId: rawExtId && rawExtId.length > 0 ? rawExtId : null,
    })
    .returning();

  if (effectiveUserId != null) {
    const curMo = normalizeMonthKey(new Date());
    await db
      .delete(predictions)
      .where(
        and(
          eq(predictions.userId, effectiveUserId),
          gte(predictions.targetMonth, curMo),
        ),
      );
  }

  return rowToTransaction(row);
}

export async function getTransactionById(
  id: number,
  userId?: number,
): Promise<Transaction | null> {
  const condition =
    userId != null
      ? and(eq(transactions.id, id), eq(transactions.userId, userId))
      : eq(transactions.id, id);

  const [row] = await db
    .select()
    .from(transactions)
    .where(condition)
    .limit(1);
  return row ? rowToTransaction(row) : null;
}

export interface TransactionFilters {
  userId?: number;
  startDate?: string;
  endDate?: string;
  type?: TransactionType;
  category?: string;
  paymentMethod?: string;
  search?: string;
  sortBy?: "date" | "amount";
  sortDir?: "asc" | "desc";
}

export async function getTransactions(
  filters: TransactionFilters = {},
): Promise<Transaction[]> {
  const conditions = [];
  if (filters.userId != null)
    conditions.push(eq(transactions.userId, filters.userId));
  if (filters.startDate)
    conditions.push(gte(transactions.transactionDate, filters.startDate));
  if (filters.endDate)
    conditions.push(lte(transactions.transactionDate, filters.endDate));
  if (filters.type)
    conditions.push(eq(transactions.transactionType, filters.type));
  if (filters.category)
    conditions.push(eq(transactions.category, filters.category));
  if (filters.paymentMethod)
    conditions.push(eq(transactions.paymentMethod, filters.paymentMethod));
  if (filters.search) {
    conditions.push(
      sql`lower(${transactions.description}) like ${`%${filters.search.toLowerCase()}%`}`,
    );
  }

  const sortCol =
    filters.sortBy === "amount"
      ? transactions.amount
      : transactions.transactionDate;
  const dir = filters.sortDir === "asc" ? sql`asc` : desc(sortCol);

  const rows = await db
    .select()
    .from(transactions)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(dir);

  // Secondary sort: date desc then id desc for stable ordering.
  const result = rows.map(rowToTransaction);
  if (filters.sortBy === "amount") {
    result.sort((a, b) => {
      const cmp = (a.amount - b.amount) * (filters.sortDir === "asc" ? 1 : -1);
      return cmp !== 0 ? cmp : b.id - a.id;
    });
  } else {
    result.sort((a, b) =>
      filters.sortDir === "asc"
        ? a.transactionDate.localeCompare(b.transactionDate) ||
          a.id - b.id
        : b.transactionDate.localeCompare(a.transactionDate) || b.id - a.id,
    );
  }
  return result;
}

export async function updateTransaction(
  id: number,
  input: Partial<TransactionInput>,
  userId?: number,
): Promise<Transaction> {
  const existing = await getTransactionById(id, userId);
  if (!existing) throw new Error("Transaction not found.");

  const rawDesc =
    input.description !== undefined
      ? input.description
        ? String(input.description).trim() || null
        : null
      : existing.description;
  const rawExtId =
    input.externalTransactionId !== undefined
      ? input.externalTransactionId
        ? String(input.externalTransactionId).trim() || null
        : null
      : existing.externalTransactionId;

  const merged: TransactionInput = {
    userId: existing.userId,
    transactionDate: input.transactionDate ?? existing.transactionDate,
    transactionType: input.transactionType ?? existing.transactionType,
    amount: input.amount ?? existing.amount,
    category: input.category ?? existing.category,
    paymentMethod: input.paymentMethod ?? existing.paymentMethod,
    description: rawDesc,
    externalTransactionId: rawExtId,
  };

  const v = validateTransactionInput(merged);
  if (!v.ok) throw new Error(v.error);

  const condition =
    userId != null
      ? and(eq(transactions.id, id), eq(transactions.userId, userId))
      : eq(transactions.id, id);

  const [row] = await db
    .update(transactions)
    .set({
      transactionDate: merged.transactionDate,
      transactionType: merged.transactionType,
      amount: String(merged.amount),
      category: merged.category,
      paymentMethod: merged.paymentMethod,
      description: rawDesc,
      externalTransactionId: rawExtId,
    })
    .where(condition)
    .returning();

  const effUserId = userId ?? existing.userId;
  if (effUserId != null) {
    const curMo = normalizeMonthKey(new Date());
    await db
      .delete(predictions)
      .where(
        and(
          eq(predictions.userId, effUserId),
          gte(predictions.targetMonth, curMo),
        ),
      );
  }

  return rowToTransaction(row);
}

export async function deleteTransaction(
  id: number,
  userId?: number,
): Promise<void> {
  const existing = await getTransactionById(id, userId);
  const condition =
    userId != null
      ? and(eq(transactions.id, id), eq(transactions.userId, userId))
      : eq(transactions.id, id);
  await db.delete(transactions).where(condition);

  const effUserId = userId ?? existing?.userId;
  if (effUserId != null) {
    const curMo = normalizeMonthKey(new Date());
    await db
      .delete(predictions)
      .where(
        and(
          eq(predictions.userId, effUserId),
          gte(predictions.targetMonth, curMo),
        ),
      );
  }
}

export async function countTransactions(userId?: number): Promise<number> {
  const q = db.select({ count: sql<number>`count(*)` }).from(transactions);
  const [row] =
    userId != null
      ? await q.where(eq(transactions.userId, userId))
      : await q;
  return Number(row?.count ?? 0);
}

export async function clearAllTransactions(userId?: number): Promise<number> {
  if (userId != null) {
    await db.delete(predictions).where(eq(predictions.userId, userId));
  } else {
    await db.delete(predictions);
  }
  const res =
    userId != null
      ? await db.delete(transactions).where(eq(transactions.userId, userId))
      : await db.delete(transactions);
  return (res as unknown as { rowCount: number }).rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Duplicate detection helper (used by CSV import)
// ---------------------------------------------------------------------------
export async function findExistingExternalIds(
  ids: string[],
  userId?: number,
): Promise<Set<string>> {
  const present = new Set<string>();
  const valid = ids.filter((x) => x && x.length > 0);
  if (valid.length === 0) return present;

  const conditions = [inArray(transactions.externalTransactionId, valid)];
  if (userId != null) {
    conditions.push(eq(transactions.userId, userId));
  }

  const rows = await db
    .select({ externalTransactionId: transactions.externalTransactionId })
    .from(transactions)
    .where(and(...conditions));

  for (const r of rows) {
    if (r.externalTransactionId) present.add(r.externalTransactionId);
  }
  return present;
}

export { DEFAULT_SETTINGS };
