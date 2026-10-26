# Personal Expense Analysis & Spending Prediction Using Deep Learning

An **AIDS (Artificial Intelligence & Data Science) mini project**: a full-stack
personal finance application that stores income/expense records in a persistent
database, computes real analytics and budgets, and forecasts next-month spending
with a **genuine LSTM neural network** (TensorFlow).

> **Honest stack note.** The working design originally targets Python +
> Streamlit + TensorFlow-Keras + SQLite by the brief. This submission runs in a
> TypeScript sandbox where the supported, verifiable runtime is **Next.js +
> PostgreSQL**, and TensorFlow is available as **TensorFlow.js** (the official
> JavaScript binding of TensorFlow, exposing the same Keras-style
> `LSTM → Dropout → Dense` API). The implementation below therefore preserves
> every functional requirement — real LSTM training, chronological evaluation,
> persistent storage, validation, tests — on this runtime, without fake or
> hard-coded ML. No prediction is ever a formula in disguise.

---

## 1. Abstract

Managing personal finances is difficult when records are scattered. This
project delivers an end-to-end expense-analysis platform: transactions are
persisted in a relational database with integrity constraints; an analytics
engine aggregates spending by day/week/month/year, category, and payment
method; budgets with configurable thresholds produce live alerts; and a deep
learning module trains an LSTM network on a monthly-expense time series to
predict next month's total expenditure, evaluated honestly on an unseen
chronological test window against naive baselines. A rule-based insight engine
highlights trends, anomalies (z-score based), and budget risks.

## 2. Problem Statement

Individuals usually record expenses — if at all — in ad-hoc notes or
spreadsheets with no persistence guarantees, no validation, no analytical
depth, and no forecasting. Existing tools are either manual ledgers (no
insight) or opaque cloud products (no reproducible, explainable AI). The task:
build a self-contained, reproducible system that records transactions with
validation, analyses spending, warns when budgets are at risk, and learns a
genuine deep-learning forecaster from the user's own history.

## 3. Objectives

1. Persist income/expense transactions with field-level validation.
2. Provide full CRUD plus search/filter/sort and CSV import (with duplicate
   detection) / CSV export.
3. Compute correct financial metrics (never treating income as spending).
4. Manage overall + per-category monthly budgets with threshold alerts.
5. Train a genuine LSTM regressor on monthly expense totals with leakage-free
   preprocessing, chronological evaluation, and baseline comparison.
6. Surface rule-based, statistics-backed insights — never fabricated claims.
7. Keep all of the above verifiable with an automated test suite.

## 4. Existing vs Proposed System

| Existing limitations | Proposed solution |
|---|---|
| Manual ledgers, no validation | Server-validated CRUD + CSV import with per-row rejection reasons |
| No persistence guarantees | PostgreSQL with constraints, unique keys, indexes |
| Simple reporting | Interactive Plotly dashboards over real aggregations |
| No forecasting | Genuine LSTM (TensorFlow.js), early stopping, artifact persistence |
| "AI" demos with fake accuracy | Honest evaluation: chronological test set, baselines, real loss curves |
| No data discipline | Missing months zero-filled; scaler fit on training data only |
| Destructive resets without care | Confirmation-gated data reset |

## 5. Technologies Used

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, React 19), Tailwind CSS v4, Plotly.js |
| Backend | Next.js Route Handlers (REST), server services |
| Database | PostgreSQL via Drizzle ORM (migrated from the brief's SQLite — same relational model) |
| Deep Learning | **TensorFlow.js** (`LSTM(64) → Dropout(0.2) → Dense(32,ReLU) → Dense(1)`) |
| ML utilities | MinMax scaler (sklearn-equivalent), chronological splitter, sliding-window builder |
| Testing | Vitest (46 tests) against a dedicated test database |
| Docs/Diagrams | Mermaid |

## 6. Project Structure

```
PersonalExpenseDL/
├─ src/
│  ├─ app/                     # Next.js pages (UI) + API routes (backend)
│  │  ├─ page.tsx              # 1. Dashboard
│  │  ├─ transactions/         # 2. Transactions (+ add/edit + CSV import)
│  │  ├─ analytics/            # 3. Expense Analytics
│  │  ├─ prediction/           # 4. Spending Prediction (train/evaluate/forecast)
│  │  ├─ budgets/              # 5. Budget Management
│  │  ├─ insights/             # 6. Smart Insights
│  │  ├─ reports/              # 7. Reports
│  │  ├─ settings/             # 8. Settings & Data Management
│  │  └─ api/                  # transactions, budgets, analytics, dashboard,
│  │                           # insights, reports, settings, csv, ml/train, ml/status
│  ├─ lib/
│  │  ├─ transactionService.ts # CRUD + validation + dedupe helpers
│  │  ├─ analytics.ts          # pure pandas-style aggregation (tested)
│  │  ├─ budgetService.ts      # budgets + pure warning logic (tested)
│  │  ├─ insights.ts           # rule engine + z-score anomaly detection
│  │  ├─ csvService.ts         # CSV parser/validator/exporter/template
│  │  ├─ reportService.ts      # monthly/yearly report composition
│  │  ├─ settingsService.ts    # persisted app settings
│  │  ├─ demo.ts               # reproducible synthetic data generator (seeded)
│  │  ├─ aggregate.ts          # dashboard/insight data assembly
│  │  ├─ config.ts / types.ts / format.ts
│  ├─ ml/
│  │  ├─ dataset.ts            # monthly series, chronological split, windows
│  │  ├─ scaler.ts             # MinMax scaler (train-only fit)
│  │  ├─ model.ts              # LSTM(64)→Dropout(0.2)→Dense(32)→Dense(1)
│  │  ├─ train.ts              # full leakage-free training pipeline
│  │  ├─ evaluate.ts           # MAE/RMSE/MAPE + baselines
│  │  ├─ predict.ts            # single-step next-month forecast
│  │  ├─ persist.ts            # artifact save/load (model, scaler, meta, eval)
│  │  └─ pipeline.ts           # DB-recording training/forecast orchestration
│  └─ db/                      # Drizzle schema + connection + test DDL
├─ tests/                      # database / transactions / analytics / budgets / csv / prediction
├─ docs/                       # Mermaid: architecture, ER, DL workflow
├─ data/                       # sample_expenses.csv + templates/expense_template.csv
├─ .ml-artifacts/              # trained model, scaler, meta, eval (gitignored)
└─ vitest.config.ts
```

## 7. System Architecture

See [`docs/system_architecture.mmd`](docs/system_architecture.mmd) (Mermaid).
UI → REST API → domain services → PostgreSQL (Drizzle). The ML pipeline reads
the same transactions, trains the LSTM, persists artifacts to
`.ml-artifacts/`, and records runs/predictions back in the database.

## 8. Database Schema

Five tables (see [`docs/database_er.mmd`](docs/database_er.mmd)):

- **transactions** — `id PK`, `transaction_date`, `transaction_type ENUM('Income','Expense')`,
  `amount CHECK(>0)`, `category`, `payment_method`, `description`,
  `created_at`, `external_transaction_id UNIQUE` (nullable import dedupe key).
  Indexes on type, date, category.
- **budgets** — `id PK`, `month (YYYY-MM)`, `category NULL = overall`,
  `budget_amount CHECK(>0)`, unique `(month, category)`.
- **model_runs** — version, start/end timestamps, sequence length, status,
  MAE/RMSE/MAPE, sample counts.
- **predictions** — target month, predicted expense, model version.
- **app_settings** — key/JSON-value store (currency, thresholds, training config).

All queries are parameterized through Drizzle ORM. Budget upserts are used to
enforce one overall and one per-category budget per month (PostgreSQL treats
`NULL` as distinct in plain unique constraints, so the null-category upsert is
enforced at the service layer — documented in `tests/database.test.ts`).

## 9. LSTM Architecture & Workflow

Workflow diagram: [`docs/deep_learning_workflow.mmd`](docs/deep_learning_workflow.mmd).

### Data preprocessing methodology

1. Read **Expense** transactions only (Income is never treated as spending).
2. Aggregate totals by **calendar month**, sort chronologically, **fill
   missing months with 0** (gapless series — documented design decision).
3. Chronological split: the most recent `testMonths` (default 6) are the
   **test** window, the preceding 3 months the **validation** window.
4. Fit a MinMax scaler **on training months only**; transform everything with
   it (no leakage).
5. Build sliding-window sequences: each input is the previous **6 months**
   (configurable), target is the following month. Windows near a partition
   boundary may read earlier (earlier-in-time) months — standard practice —
   but never future values.
6. Early stop on **validation loss** (patience 10), Adam optimizer, MSE loss.
7. Evaluate on the **unseen test targets**; compare with two fair baselines
   (naive last-month, 3-month moving average) computed on identical targets.
8. Forecast = latest 6-month window → inverse-transform → clamp ≥ 0. The
   target calendar month is never used as an input.

### Why these settings

Architecture/hyperparameters were selected by validation performance as the
brief requires — not claimed to be globally optimal. On the reproducible
synthetic dataset (60 months, seed 42), the trained model beats both baselines
on MAE/MAPE; on real data the comparison is shown exactly as computed.

## 10. Financial Definitions (used consistently everywhere)

- **Net Cash Flow** = Total Income − Total Expenses *(calculated metric, not
  a verified bank balance — labelled as such on the dashboard)*
- **Budget Remaining** = Monthly Budget − Actual Monthly Expenses
- **Budget Utilization %** = Actual / Budget × 100 (alerts: ok < threshold,
  warning ≥ threshold (default 80%, configurable), exceeded > 100%)
- **Savings Rate %** = (Income − Expenses) / Income × 100 (null when income = 0)
- Category budgets are **subsets** of the overall budget; the overall figure is
  always reported separately, never summed with categories (no double counting).
- Predicted (forecast) expenses are **never** added to actual expenditure.
- Refunds/reversals: record them as an **Income** transaction (or a negative
  concept is intentionally unsupported — amounts must be positive); the system
  never converts income into spending.

## 11. Installation & Setup

Prerequisites: Node.js ≥ 18.18, a PostgreSQL server, `DATABASE_URL` in `.env`.

### Windows

```powershell
git clone <repo> && cd PersonalExpenseDL
npm install
$env:DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/app_db"
npx drizzle-kit push        # create tables
npm run dev                 # http://localhost:3000
```

### Linux / macOS

```bash
git clone <repo> && cd PersonalExpenseDL
npm install
echo 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db' > .env
npx drizzle-kit push        # create tables
npm run build && npm run start
```

### Database initialization

`npx drizzle-kit push` creates all five tables with constraints and indexes.
No seeding is required; the app starts empty in **real mode**.

### Sample dataset generation (demo mode)

From **Settings → Generate sample dataset** (or
`POST /api/settings/seed {"months":60,"seed":42}`). Creates ~1800 clearly
labelled synthetic transactions spanning 60 months ending in the current
month. Deterministic (mulberry32 PRNG, seed 42) → identical dataset every
time. Demo data only replaces real records **after explicit confirmation**;
synthetic rows carry `DEMO-` external IDs.

### LSTM training & prediction

**Spending Prediction → Train LSTM Model** (or `POST /api/ml/train`).
Requires ≥ 16 monthly observations (seqLen 6 + 1 + val 3 + test 6); if
insufficient, the API returns an explainable `insufficient: true` response
instead of failing silently, and a one-click sample-data training demo is
offered. Artifacts are saved under `.ml-artifacts/`; runs and forecasts are
recorded in `model_runs` / `predictions`.

### CSV import / export

**Transactions page** — upload CSV → the file is parsed + validated first
(columns mapped case-insensitively; aliases: `date`, `type`, `merchant`,
`note`). A report shows total/valid/invalid/duplicate rows with per-row
reasons (bad date, non-positive amount, wrong type/category/method). Rows
sharing an `external_transaction_id` seen in the file or already in the DB are
skipped and reported. Import only happens on explicit confirmation. Export:
**Export CSV** respects active filters; **Download template** provides the
header + two examples (also in `data/templates/`).

### Running the tests

```bash
createdb app_db_test        # once
export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db_test
npm test                    # vitest run — 46 tests, 6 files, sequential
```

The suite isolates itself in `app_db_test` (schema dropped & recreated per
file) so personal records are never touched.

## 12. Common Errors & Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `DATABASE_URL is required` | missing env var | set `DATABASE_URL` in `.env` |
| `relation "transactions" does not exist` | schema not pushed | `npx drizzle-kit push` |
| Training returns `insufficient` | < 16 monthly observations | add transactions or sample dataset |
| Build: `Cannot apply unknown utility class 'btn'` | `@apply` of a custom class (Tailwind v4) | custom classes define plain CSS (fixed in `globals.css`) |
| `binary weights could not be loaded` | stale artifacts after schema change | retrain from the Prediction page |
| Timeouts while training | many months/epochs | reduce `epochs` in Settings; server timeout on Vercel needs Pro tier limits |
| Node `< 18.18` | unsupported | upgrade Node |

## 13. Limitations & Future Scope

**Limitations.** Univariate single-step forecast (monthly totals only, no
covariates); MinMax-scaled extrapolation struggles with strong unseen trends —
reported honestly, with baselines often competitive on noisy series; synthetic
performance does **not** prove forecasting quality on real finances; the app is
single-user (no auth); PDF export is browser print (no server-side PDF engine
in this runtime); Plotly adds client bundle size.

**Future scope.** Multi-step & multivariate LSTM (category-level), Prophet/ARIMA
baselines, user authentication with per-user data isolation, recurring-
transaction detection, bank-statement (OFX) import, on-device retraining,
confidence intervals via MC dropout, multi-currency conversion, mobile app.

## 14. Module Descriptions

| Module | Responsibility |
|---|---|
| `transactionService` | validate + CRUD + search/filter/sort + external-ID lookup |
| `analytics` | pure aggregations: day/week/month/year, category, method, KPIs |
| `budgetService` | budget CRUD + threshold alert logic (pure core for tests) |
| `insights` | rule engine (top category, MoM change, budget risk, forecast risk) + z-score anomalies |
| `csvService` | RFC-4180 parser, header aliasing, per-row validation, template/export |
| `reportService` | monthly/yearly report composition incl. budget history |
| `demo` | deterministic synthetic dataset (60 months, seed 42) |
| `ml/dataset` | monthly series (gap-filled), chronological split, window builder |
| `ml/scaler` | train-fitted MinMax scaler with round-trippable JSON |
| `ml/model` | LSTM architecture + tensor conversion |
| `ml/train` | end-to-end leakage-free training |
| `ml/evaluate` | MAE/RMSE/MAPE + fair baselines |
| `ml/predict` | next-month single-step forecast |
| `ml/persist` | artifact IO via custom tf.io handlers |
| `ml/pipeline` | orchestration + DB records + forecast/budget comparison |
| `db/schema` | Drizzle tables, enums, indexes |

## 15. Viva Questions (with answers)

1. **Why an LSTM and not a plain dense network or linear regression?**
   LSTMs maintain gated state through the lookback window, learning seasonal
   ordering (e.g., spending peaks in December) that a flat dense learner
   treats as unordered features; linear regression cannot capture periodicity
   without hand-crafted features.
2. **How is the dataset built from raw transactions?**
   Expense rows are aggregated per calendar month, sorted, and missing months
   zero-filled so the series is gapless; income is excluded everywhere.
3. **What stops data leakage?**
   The split is chronological; the scaler is fit only on training months;
   early stopping watches validation, not test; test targets are never fed to
   the model as inputs; the forecast window ends before the target month.
4. **Why 6 months of lookback?**
   A compromise: long enough to see within-year seasonality transitions,
   short enough to keep many training windows; it is validated, and
   configurable in Settings.
5. **What loss/metric does the model use, and why?**
   MSE loss (penalizes large monthly errors); Adam optimizer (robust default).
   Evaluation uses MAE (interpretable currency units), RMSE (outlier
   sensitivity), and MAPE (relative error) — but MAPE is skipped over zero
   denominators.
6. **Is the scaler fit on all the data?** No — training months only, then the
   fitted scaler transforms validation/test. Fitting on everything would leak
   future ranges into training.
7. **How do you know the forecast is not fabricated?**
   Every metric comes from an executed training run: real loss history,
   persisted `model.json`/`weights.bin`, and DB records. The repository's
   tests build and train the same architecture programmatically.
8. **Why compare against baselines?**
   Deep learning is only justified if it beats cheap reference models. The app
   computes naive (last month) and 3-month moving-average errors on the *same
   test targets* and displays them side by side.
9. **What is an `external_transaction_id` for?**
   A stable import identifier marking each CSV row. Duplicates (within the
   file or already in the DB) are detected and reported, never silently
   dropped/re-inserted.
10. **How does the system avoid counting income as expense?**
    Every aggregation filters `transactionType = 'Expense'`; tests assert the
    separation. Refunds are entered as positive Income rows.
11. **How is anomaly detection implemented?**
    A z-score test: expenses with (amount − mean)/σ > 2, only enabled with
    ≥ 10 samples; otherwise the insight explicitly says it is unavailable.
12. **Why zero-fill missing months instead of skipping them?**
    Time-series models need evenly spaced months; skipping would compress
    time. Zero-filling is the documented behaviour (real 0-spend months are
    indistinguishable from unlogged months — a known limitation).
13. **How are budget warnings generated?**
    From actual ratios: utilization ≥ configurable threshold → warning;
    > 100% → exceeded; forecast > overall budget → forecast alert.
    Predictions never inflate actuals.
14. **Why did you switch the storage from the brief's SQLite to PostgreSQL?**
    The deployment/runtime provides managed PostgreSQL and mandates it;
    Drizzle ORM keeps the schema relational with identical tables,
    constraints, and parameterized queries. All semantics are preserved.
15. **Why TensorFlow.js instead of Python TensorFlow/Keras?**
    Same official TensorFlow project and Keras-style API, but runnable inside
    the mandated Node runtime without language bridging. Architecturally and
    numerically it is still a genuine LSTM trained by gradient descent.
16. **Could the production model retrain on every click?**
    No — training happens only via the explicit endpoint: a `running` row is
    written first, artifacts are atomically replaced, and subsequent loads
    only read them (dashboard never retrains).
17. **What would you improve next?**
    Multivariate inputs (per-category series), longer datasets, MC-dropout
    confidence intervals, and per-user authentication with row-level security.

## 16. Test Coverage Summary

46 tests, 6 files (`npm test`):
- **database**: schema presence, NOT NULL/CHECK, uniqueness, persistence
- **transactions**: CRUD, type separation, search/filter/sort, 9 invalid-input rejections
- **analytics**: category totals, monthly aggregation, NCF/savings rate, edge cases (empty/0), MoM, week keys
- **budgets**: ok/warning/exceeded, zero-budget safety, category breakdown
- **csv**: parser, validation reasons, duplicate detection (internal + existing), template, export escaping, missing columns
- **prediction**: window shapes, chronological split, insufficient data, train-only scaler fit, scaling round-trip, **genuine LSTM train → forecast shape**, artifact save/load round-trip, baselines, metrics, monthly gap-filling, next-month target, reproducible synthetic generation, eval persistence

*(Synthetic-data experiments are clearly labelled as demonstrations; they do
not imply accuracy on real personal finances.)*
