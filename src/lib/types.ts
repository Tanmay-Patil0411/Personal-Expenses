// Shared domain types and constant lists for the expense-analysis app.

export type TransactionType = "Income" | "Expense";

export const EXPENSE_CATEGORIES = [
  "Food",
  "Groceries",
  "Transport",
  "Shopping",
  "Education",
  "Healthcare",
  "Housing",
  "Utilities",
  "Entertainment",
  "Subscriptions",
  "Travel",
  "Personal Care",
  "Other",
] as const;

export const INCOME_CATEGORIES = [
  "Salary",
  "Allowance",
  "Freelance",
  "Business",
  "Investment Income",
  "Gift",
  "Other",
] as const;

export const PAYMENT_METHODS = [
  "Cash",
  "Credit Card",
  "Debit Card",
  "UPI",
  "Bank Transfer",
  "Wallet",
  "Other",
] as const;

export const VALID_CATEGORIES: Record<TransactionType, readonly string[]> = {
  Income: INCOME_CATEGORIES,
  Expense: EXPENSE_CATEGORIES,
};

export interface User {
  id: number;
  email: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserSession {
  id: string;
  userId: number;
  expiresAt: string;
  createdAt: string;
  user: User;
}

export interface Transaction {
  id: number;
  userId?: number | null;
  transactionDate: string; // YYYY-MM-DD
  transactionType: TransactionType;
  amount: number; // positive numeric
  category: string;
  paymentMethod: string;
  description: string | null;
  createdAt?: string;
  externalTransactionId?: string | null;
}

export interface TransactionInput {
  userId?: number | null;
  transactionDate: string;
  transactionType: TransactionType;
  amount: number;
  category: string;
  paymentMethod: string;
  description?: string | null;
  externalTransactionId?: string | null;
}

export interface Budget {
  id: number;
  userId?: number | null;
  month: string; // YYYY-MM
  category: string | null; // null => overall
  budgetAmount: number;
  name?: string | null;
  notes?: string | null;
  alertThreshold?: number | null;
  status?: "active" | "paused" | "archived" | string | null;
  periodType?: "monthly" | "weekly" | "custom" | string | null;
  startDate?: string | null;
  endDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BudgetInput {
  id?: number;
  userId?: number | null;
  month: string;
  category?: string | null;
  budgetAmount: number;
  name?: string | null;
  notes?: string | null;
  alertThreshold?: number | null;
  status?: "active" | "paused" | "archived" | string | null;
  periodType?: "monthly" | "weekly" | "custom" | string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface ModelRun {
  id: number;
  userId?: number | null;
  modelVersion: string;
  trainingStart: string;
  trainingEnd?: string | null;
  sequenceLength: number;
  trainingStatus: string;
  mae?: number | null;
  rmse?: number | null;
  mape?: number | null;
  trainSamples?: number | null;
  valSamples?: number | null;
  testSamples?: number | null;
  createdAt?: string;
}

export interface Prediction {
  id: number;
  userId?: number | null;
  targetMonth: string; // YYYY-MM
  predictedExpense: number;
  modelVersion: string;
  createdAt?: string;
}

export interface DateRange {
  startDate?: string; // YYYY-MM-DD (inclusive)
  endDate?: string; // YYYY-MM-DD (inclusive)
}

export interface TrainingDataset {
  id: number;
  userId?: number | null;
  name: string;
  source: string; // "kaggle" | "user_data" | "demo"
  filename?: string | null;
  rowCount: number;
  expenseRowCount: number;
  monthsCount: number;
  startDate?: string | null;
  endDate?: string | null;
  isActive: number;
  createdAt?: string;
}

export interface TrainingRecord {
  id: number;
  datasetId: number;
  userId?: number | null;
  transactionDate: string;
  transactionType: TransactionType;
  amount: number;
  category: string;
  paymentMethod: string;
  description?: string | null;
  createdAt?: string;
}
