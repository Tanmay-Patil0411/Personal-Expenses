import {
  pgEnum,
  pgTable,
  serial,
  text,
  numeric,
  date,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------
export const transactionTypeEnum = pgEnum("transaction_type", [
  "Income",
  "Expense",
]);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("idx_users_email").on(t.email),
  }),
);

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // 256-bit cryptographically random token
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdIdx: index("idx_sessions_user_id").on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// Password Reset Tokens
// ---------------------------------------------------------------------------
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex("idx_password_reset_tokens_token").on(t.token),
  }),
);

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    transactionDate: date("transaction_date", {
      mode: "string",
    }).notNull(),
    transactionType: transactionTypeEnum("transaction_type").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    category: text("category").notNull(),
    paymentMethod: text("payment_method").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    externalTransactionId: text("external_transaction_id"),
  },
  (t) => ({
    typeIdx: index("idx_transactions_type").on(t.transactionType),
    dateIdx: index("idx_transactions_date").on(t.transactionDate),
    categoryIdx: index("idx_transactions_category").on(t.category),
    userIdIdx: index("idx_transactions_user_id").on(t.userId),
    externalIdIdx: uniqueIndex("idx_transactions_external_id").on(
      t.externalTransactionId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------
export const budgets = pgTable(
  "budgets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    month: text("month").notNull(), // YYYY-MM
    category: text("category"), // null => overall budget
    budgetAmount: numeric("budget_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
    name: text("name"),
    notes: text("notes"),
    alertThreshold: integer("alert_threshold").default(80),
    status: text("status").default("active"), // "active" | "paused" | "archived"
    periodType: text("period_type").default("monthly"), // "monthly" | "weekly" | "custom"
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userMonthCatUniq: uniqueIndex("idx_budgets_user_month_category").on(
      t.userId,
      t.month,
      t.category,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Model runs (LSTM training history)
// ---------------------------------------------------------------------------
export const modelRuns = pgTable("model_runs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  modelVersion: text("model_version").notNull(),
  datasetMode: text("dataset_mode").notNull().default("real"),
  dataStartDate: text("data_start_date"),
  dataEndDate: text("data_end_date"),
  trainingStart: timestamp("training_start", { withTimezone: true }).notNull(),
  trainingEnd: timestamp("training_end", { withTimezone: true }),
  sequenceLength: integer("sequence_length").notNull(),
  trainingStatus: text("training_status").notNull(), // running|completed|failed
  errorMessage: text("error_message"),
  mae: numeric("mae", { precision: 18, scale: 6 }),
  rmse: numeric("rmse", { precision: 18, scale: 6 }),
  mape: numeric("mape", { precision: 18, scale: 6 }),
  trainSamples: integer("train_samples"),
  valSamples: integer("val_samples"),
  testSamples: integer("test_samples"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Predictions (saved next-month forecasts)
// ---------------------------------------------------------------------------
export const predictions = pgTable("predictions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  targetMonth: text("target_month").notNull(), // YYYY-MM
  predictedExpense: numeric("predicted_expense", {
    precision: 14,
    scale: 2,
  }).notNull(),
  modelVersion: text("model_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// App settings (key/value) - currency, thresholds, training config, mode
// ---------------------------------------------------------------------------
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON-encoded
});

// ---------------------------------------------------------------------------
// Training Datasets (External/Kaggle dataset metadata)
// ---------------------------------------------------------------------------
export const trainingDatasets = pgTable("training_datasets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  source: text("source").notNull().default("kaggle"), // "kaggle" | "user_data" | "demo"
  filename: text("filename"),
  rowCount: integer("row_count").notNull().default(0),
  expenseRowCount: integer("expense_row_count").notNull().default(0),
  monthsCount: integer("months_count").notNull().default(0),
  startDate: text("start_date"),
  endDate: text("end_date"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Training Records (Kaggle/External time-series records isolated from user transactions)
// ---------------------------------------------------------------------------
export const trainingRecords = pgTable(
  "training_records",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").references(() => trainingDatasets.id, {
      onDelete: "cascade",
    }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    transactionDate: date("transaction_date", {
      mode: "string",
    }).notNull(),
    transactionType: transactionTypeEnum("transaction_type").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    category: text("category").notNull(),
    paymentMethod: text("payment_method").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    datasetIdx: index("idx_training_records_dataset_id").on(t.datasetId),
    userIdIdx: index("idx_training_records_user_id").on(t.userId),
    typeIdx: index("idx_training_records_type").on(t.transactionType),
    dateIdx: index("idx_training_records_date").on(t.transactionDate),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type BudgetRow = typeof budgets.$inferSelect;
export type ModelRunRow = typeof modelRuns.$inferSelect;
export type PredictionRow = typeof predictions.$inferSelect;
export type AppSettingRow = typeof appSettings.$inferSelect;
export type TrainingDatasetRow = typeof trainingDatasets.$inferSelect;
export type TrainingRecordRow = typeof trainingRecords.$inferSelect;
