"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import {
  Card,
  EmptyState,
  KpiCard,
  PageHeader,
  Spinner,
  Alert,
  Badge,
} from "@/components/ui";
import PlotlyChart from "@/components/PlotlyChart";
import type { ReportResult } from "@/lib/reportService";
import { lastDayOfMonth } from "@/lib/config";

const PALETTE = [
  "#0d9488", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899",
  "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#14b8a6",
  "#a855f7", "#eab308", "#64748b",
];

export default function ReportsPage() {
  const fmt = useFormat();
  const [mode, setMode] = useState<"monthly" | "yearly">("monthly");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [year, setYear] = useState(new Date().getUTCFullYear().toString());
  const [data, setData] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [txPage, setTxPage] = useState(1);
  const txPageSize = 20;

  const load = useCallback(() => {
    setError(null);
    const qs = new URLSearchParams({ mode });
    if (mode === "monthly") qs.set("month", month);
    else qs.set("year", year);

    return apiGet<ReportResult>(`/api/reports?${qs.toString()}`);
  }, [mode, month, year]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setTxPage(1);

    load()
      .then((res) => {
        if (!ignore) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to generate report.");
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [load]);

  const handleGenerate = () => {
    setLoading(true);
    setTxPage(1);
    load()
      .then((res) => {
        setData(res);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to generate report.");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const exportHref = data?.meta?.startDate && data?.meta?.endDate
    ? `/api/csv/export?startDate=${data.meta.startDate}&endDate=${data.meta.endDate}`
    : (mode === "monthly"
        ? `/api/csv/export?startDate=${month}-01&endDate=${lastDayOfMonth(month)}`
        : `/api/csv/export?startDate=${year}-01-01&endDate=${year}-12-31`);

  const txTotal = data?.transactions?.length ?? 0;
  const totalTxPages = Math.max(1, Math.ceil(txTotal / txPageSize));
  const displayedTxns = (data?.transactions ?? []).slice(
    (txPage - 1) * txPageSize,
    txPage * txPageSize,
  );

  return (
    <div id="report-area" className="space-y-6 pb-12">
      {/* ------------------------------------------------------------------ */}
      {/* Section 1: Report Header & Reporting Period                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="no-print">
        <PageHeader
          title="Personal Expense Analysis Report"
          subtitle="Comprehensive Financial Performance, Category Analysis & Deep Learning Forecast"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input w-auto text-sm"
                value={mode}
                onChange={(e) => setMode(e.target.value as "monthly" | "yearly")}
                aria-label="Reporting Mode"
              >
                <option value="monthly">Monthly Report</option>
                <option value="yearly">Yearly Report</option>
              </select>

              {mode === "monthly" ? (
                <input
                  type="month"
                  className="input w-auto text-sm"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  aria-label="Select Month"
                />
              ) : (
                <input
                  type="number"
                  min="2000"
                  max="2099"
                  className="input w-28 text-sm"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  aria-label="Select Year"
                />
              )}

              <button
                type="button"
                className="btn-primary text-sm shadow-xs"
                onClick={handleGenerate}
                disabled={loading}
              >
                {loading ? "Generating..." : "Generate Report"}
              </button>

              <a
                className="btn-ghost text-sm"
                href={exportHref}
                download="expense_report.csv"
              >
                📥 Export CSV
              </a>

              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => window.print()}
              >
                🖨️ Print / PDF
              </button>
            </div>
          }
        />
      </div>

      {error && (
        <Alert kind="error">
          <div className="font-semibold">Error Generating Report</div>
          <div>{error}</div>
        </Alert>
      )}

      {loading && !data && (
        <div className="py-16">
          <Spinner label="Generating comprehensive financial report…" />
        </div>
      )}

      {!loading && !data && !error && (
        <EmptyState>No financial report data available for the selected period.</EmptyState>
      )}

      {data && (
        <>
          {/* Formal Document Header for Screen & Print */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-bold tracking-wider text-white uppercase">
                    Official Statement
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    Indian Rupee (₹) · en-IN
                  </span>
                </div>
                <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                  {data.meta.reportTitle}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Prepared for: <strong className="text-slate-800">{data.meta.userName}</strong>
                  {data.meta.userEmail ? ` (${data.meta.userEmail})` : ""}
                </p>
              </div>

              <div className="rounded-lg bg-slate-50 p-3.5 text-xs text-slate-600 border border-slate-200/80 md:text-right">
                <div>
                  <span className="font-medium text-slate-500">Reporting Period:</span>{" "}
                  <strong className="text-slate-800">{data.meta.periodLabel}</strong>
                </div>
                <div className="mt-1">
                  <span className="font-medium text-slate-500">Date Range:</span>{" "}
                  <span className="text-slate-700">{data.meta.dateRangeFormatted}</span> (
                  {data.meta.calendarDays} days)
                </div>
                <div className="mt-1 text-slate-400">
                  Generated on {data.meta.generatedAtFormatted}
                </div>
              </div>
            </div>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Section 2: Executive Financial Summary                             */}
          {/* ------------------------------------------------------------------ */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">
                1. Executive Financial Summary
              </h3>
              {data.kpis.previousPeriod?.hasData && (
                <span className="text-xs text-slate-500">
                  Compared against {data.kpis.previousPeriod.periodLabel}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-4">
              <KpiCard
                title="Total Income"
                value={fmt.currency(data.kpis.totalIncome)}
                subtitle={
                  data.kpis.previousPeriod?.hasData ? (
                    <span
                      className={
                        data.kpis.previousPeriod.incomeDiff >= 0
                          ? "text-emerald-600 font-medium"
                          : "text-rose-600 font-medium"
                      }
                    >
                      {data.kpis.previousPeriod.incomeDiff >= 0 ? "+" : ""}
                      {fmt.currency(data.kpis.previousPeriod.incomeDiff)}{" "}
                      {data.kpis.previousPeriod.incomeDiffPct !== null
                        ? `(${data.kpis.previousPeriod.incomeDiffPct >= 0 ? "+" : ""}${data.kpis.previousPeriod.incomeDiffPct.toFixed(1)}%)`
                        : ""}
                    </span>
                  ) : (
                    `${data.kpis.incomeTransactionsCount} deposit transaction(s)`
                  )
                }
                tone="green"
              />

              <KpiCard
                title="Total Expenses"
                value={fmt.currency(data.kpis.totalExpenses)}
                subtitle={
                  data.kpis.previousPeriod?.hasData ? (
                    <span
                      className={
                        data.kpis.previousPeriod.expenseDiff <= 0
                          ? "text-emerald-600 font-medium"
                          : "text-rose-600 font-medium"
                      }
                    >
                      {data.kpis.previousPeriod.expenseDiff >= 0 ? "+" : ""}
                      {fmt.currency(data.kpis.previousPeriod.expenseDiff)}{" "}
                      {data.kpis.previousPeriod.expenseDiffPct !== null
                        ? `(${data.kpis.previousPeriod.expenseDiffPct >= 0 ? "+" : ""}${data.kpis.previousPeriod.expenseDiffPct.toFixed(1)}%)`
                        : ""}
                    </span>
                  ) : (
                    `${data.kpis.expenseTransactionsCount} expense transaction(s)`
                  )
                }
                tone="rose"
              />

              <KpiCard
                title="Net Savings / Cash Flow"
                value={fmt.currency(data.kpis.netSavings)}
                subtitle={
                  <span
                    className={
                      data.kpis.netSavings >= 0 ? "text-emerald-600" : "text-rose-600 font-semibold"
                    }
                  >
                    {data.kpis.netSavings >= 0 ? "Positive Net Inflow" : "Deficit (Expenses > Income)"}
                  </span>
                }
                tone={data.kpis.netSavings >= 0 ? "indigo" : "rose"}
              />

              <KpiCard
                title="Savings Rate"
                value={
                  data.kpis.savingsRateStatus === "no_income" ? (
                    <span className="text-sm font-medium text-slate-500">
                      Not available — no income recorded
                    </span>
                  ) : (
                    data.kpis.savingsRateLabel
                  )
                }
                subtitle="Calculated on recorded income"
                tone="brand"
              />
            </div>

            {/* Additional Core Operational Financial Metrics */}
            <div className="mt-3.5 grid grid-cols-2 gap-3.5 sm:grid-cols-2 md:grid-cols-4">
              <div className="card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Avg Daily Spending
                </p>
                <p className="mt-1 text-xl font-bold text-slate-800">
                  {fmt.currency(data.kpis.avgDailySpend)}
                  <span className="text-xs font-normal text-slate-500"> / day</span>
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Active days avg: {fmt.currency(data.kpis.avgDailyActiveSpend)} ({data.kpis.activeSpendingDays} active days)
                </p>
              </div>

              <div className="card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Avg Expense / Txn
                </p>
                <p className="mt-1 text-xl font-bold text-slate-800">
                  {fmt.currency(data.kpis.avgExpensePerTransaction)}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Across {data.kpis.expenseTransactionsCount} actual expense transactions
                </p>
              </div>

              <div className="card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Highest Single Expense
                </p>
                <p className="mt-1 text-xl font-bold text-rose-600">
                  {data.kpis.highestExpense ? fmt.currency(data.kpis.highestExpense.amount) : "—"}
                </p>
                <p className="mt-1 truncate text-xs text-slate-400">
                  {data.kpis.highestExpense
                    ? `${data.kpis.highestExpense.category} · ${data.kpis.highestExpense.date}`
                    : "No expenses recorded"}
                </p>
              </div>

              <div className="card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Prior Period Comparison
                </p>
                <p className="mt-1 text-xl font-bold text-slate-800">
                  {data.kpis.previousPeriod?.hasData ? (
                    data.kpis.previousPeriod.expenseDiff <= 0 ? (
                      <span className="text-emerald-600">
                        {fmt.currency(Math.abs(data.kpis.previousPeriod.expenseDiff))} Saved
                      </span>
                    ) : (
                      <span className="text-rose-600">
                        +{fmt.currency(data.kpis.previousPeriod.expenseDiff)} More
                      </span>
                    )
                  ) : (
                    <span className="text-xs text-slate-400">No prior period data</span>
                  )}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {data.kpis.previousPeriod?.hasData
                    ? `vs ${data.kpis.previousPeriod.periodLabel}`
                    : "Accumulate history for comparisons"}
                </p>
              </div>
            </div>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Section 3: Income, Expenses & Net Cash Flow                        */}
          {/* ------------------------------------------------------------------ */}
          <div>
            <h3 className="mb-3 text-base font-bold text-slate-800">
              2. Income, Expenses & Net Cash Flow Analysis
            </h3>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                  <h4 className="text-sm font-semibold text-slate-800">
                    Monthly Inflow vs Outflow Overview
                  </h4>
                  <span className="text-xs text-slate-400">Actual financial flows (₹)</span>
                </div>
                <PlotlyChart
                  data={[
                    {
                      x: data.monthly.map((m) => m.month),
                      y: data.monthly.map((m) => m.income),
                      type: "bar",
                      name: "Income",
                      marker: { color: "#10b981" },
                    },
                    {
                      x: data.monthly.map((m) => m.month),
                      y: data.monthly.map((m) => m.expense),
                      type: "bar",
                      name: "Expenses",
                      marker: { color: "#f43f5e" },
                    },
                  ]}
                  layout={{
                    barmode: "group",
                    margin: { t: 20, r: 10, b: 35, l: 45 },
                    legend: { orientation: "h", y: 1.15, x: 0 },
                    yaxis: { tickprefix: "₹" },
                  }}
                />
              </Card>

              <Card className="flex flex-col justify-between">
                <div>
                  <h4 className="border-b border-slate-100 pb-2 mb-3 text-sm font-semibold text-slate-800">
                    Cash Flow Reconciliation
                  </h4>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between border-b border-slate-100 pb-2">
                      <span className="text-slate-600">Total Income:</span>
                      <strong className="text-emerald-700">{fmt.currency(data.kpis.totalIncome)}</strong>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-2">
                      <span className="text-slate-600">Total Expenses:</span>
                      <strong className="text-rose-700">−{fmt.currency(data.kpis.totalExpenses)}</strong>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 pb-2 bg-slate-50/70 p-2 rounded">
                      <span className="font-semibold text-slate-800">Net Cash Flow:</span>
                      <strong
                        className={`text-base ${
                          data.kpis.netCashFlow >= 0 ? "text-indigo-700" : "text-rose-700"
                        }`}
                      >
                        {fmt.currency(data.kpis.netCashFlow)}
                      </strong>
                    </div>
                    <div className="flex justify-between pt-1">
                      <span className="text-slate-600">Net Period Savings:</span>
                      <span className="font-semibold text-slate-800">{fmt.currency(data.kpis.netSavings)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Savings Rate:</span>
                      <span className="font-semibold text-slate-800">{data.kpis.savingsRateLabel}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 border border-slate-200">
                  💡 <strong>Rule verification:</strong> Net cash flow strictly equals Total Income minus Total Expenses. Income transactions are excluded from expense analytics.
                </div>
              </Card>
            </div>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Section 4: Detailed Expense Breakdown (Category Analysis)          */}
          {/* ------------------------------------------------------------------ */}
          <div>
            <h3 className="mb-3 text-base font-bold text-slate-800">
              3. Category-wise Expense Analysis
            </h3>

            {/* Dynamic data-driven explanation callout */}
            <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50/80 p-4 text-sm text-brand-950">
              <div className="flex items-start gap-2">
                <span className="text-base">📌</span>
                <p className="leading-relaxed">
                  <strong>Category Insight:</strong> {data.categoryExplanation}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <h4 className="mb-2 text-sm font-semibold text-slate-800">
                  Spending by Category (Highest to Lowest)
                </h4>
                <PlotlyChart
                  data={[
                    {
                      type: "bar",
                      orientation: "h",
                      y: data.byCategory.map((c) => c.category).reverse(),
                      x: data.byCategory.map((c) => c.total).reverse(),
                      marker: { color: "#0d9488" },
                    },
                  ]}
                  layout={{
                    margin: { t: 15, r: 20, b: 35, l: 110 },
                    xaxis: { tickprefix: "₹" },
                  }}
                />
              </Card>

              <Card>
                <h4 className="mb-2 text-sm font-semibold text-slate-800">
                  Category Share of Total Expenses
                </h4>
                <PlotlyChart
                  data={[
                    {
                      type: "pie",
                      hole: 0.5,
                      labels: data.byCategory.map((c) => c.category),
                      values: data.byCategory.map((c) => c.total),
                      marker: { colors: PALETTE },
                      textinfo: "percent",
                      hoverinfo: "label+value+percent",
                    },
                  ]}
                  layout={{
                    margin: { t: 15, r: 15, b: 20, l: 15 },
                    legend: { orientation: "h", y: -0.1 },
                  }}
                />
              </Card>
            </div>

            {/* Comprehensive Category Table */}
            <Card className="mt-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-3">
                <h4 className="text-sm font-semibold text-slate-800">
                  Category Expenditure Breakdown Table
                </h4>
                <span className="text-xs text-slate-500">
                  Sorted by expenditure descending · Indian Rupee (₹)
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3 text-right">Total Spent</th>
                      <th className="py-2.5 px-3 text-right">% of Expenses</th>
                      <th className="py-2.5 px-3 text-right">Txn Count</th>
                      <th className="py-2.5 px-3 text-right">Avg / Txn</th>
                      <th className="py-2.5 px-3 text-right">Highest Txn</th>
                      <th className="py-2.5 px-3 text-right">vs Prior Period</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.byCategory.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-400">
                          No expense transactions recorded in this period.
                        </td>
                      </tr>
                    ) : (
                      data.byCategory.map((c) => (
                        <tr key={c.category} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-3 font-medium text-slate-900">
                            {c.category}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                            {fmt.currency(c.total)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-600">
                            {c.percentage.toFixed(1)}%
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-600">
                            {c.transactionCount}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-600">
                            {fmt.currency(c.avgTransactionAmount)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-700">
                            {c.highestTransaction ? fmt.currency(c.highestTransaction.amount) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-xs">
                            {c.previousPeriodTotal === null ? (
                              <span className="text-slate-400">—</span>
                            ) : c.isNew ? (
                              <span className="text-indigo-600 font-medium">New</span>
                            ) : (
                              <span
                                className={
                                  (c.diffAmount ?? 0) > 0
                                    ? "text-rose-600 font-medium"
                                    : (c.diffAmount ?? 0) < 0
                                    ? "text-emerald-600 font-medium"
                                    : "text-slate-500"
                                }
                              >
                                {(c.diffAmount ?? 0) > 0 ? "+" : ""}
                                {fmt.currency(c.diffAmount)}
                                {c.diffPct !== null && ` (${c.diffPct > 0 ? "+" : ""}${c.diffPct.toFixed(1)}%)`}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {data.byCategory.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-bold text-slate-900">
                        <td className="py-2.5 px-3">Total Reconciled</td>
                        <td className="py-2.5 px-3 text-right">{fmt.currency(data.kpis.totalExpenses)}</td>
                        <td className="py-2.5 px-3 text-right">100.0%</td>
                        <td className="py-2.5 px-3 text-right">{data.kpis.expenseTransactionsCount}</td>
                        <td className="py-2.5 px-3 text-right">{fmt.currency(data.kpis.avgExpensePerTransaction)}</td>
                        <td className="py-2.5 px-3 text-right">—</td>
                        <td className="py-2.5 px-3 text-right">—</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </Card>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Section 5: Daily and Weekly Spending Trends                        */}
          {/* ------------------------------------------------------------------ */}
          <div>
            <h3 className="mb-3 text-base font-bold text-slate-800">
              4. Daily & Weekly Spending Trends
            </h3>

            {/* Pattern summary chips */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-5">
              <div className="card p-3">
                <p className="text-[11px] font-semibold uppercase text-slate-400">Peak Day</p>
                <p className="mt-1 font-bold text-slate-800">
                  {data.patterns.highestSpendingDay
                    ? fmt.currency(data.patterns.highestSpendingDay.amount)
                    : "—"}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {data.patterns.highestSpendingDay?.date ?? "No expenses"}
                </p>
              </div>

              <div className="card p-3">
                <p className="text-[11px] font-semibold uppercase text-slate-400">Lowest Active Day</p>
                <p className="mt-1 font-bold text-slate-800">
                  {data.patterns.lowestSpendingDayActive
                    ? fmt.currency(data.patterns.lowestSpendingDayActive.amount)
                    : "—"}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {data.patterns.lowestSpendingDayActive?.date ?? "No expenses"}
                </p>
              </div>

              <div className="card p-3">
                <p className="text-[11px] font-semibold uppercase text-slate-400">Zero-Spend Days</p>
                <p className="mt-1 font-bold text-emerald-600">
                  {data.patterns.zeroSpendingDaysCount} Days
                </p>
                <p className="text-[11px] text-slate-500">
                  of {data.meta.calendarDays} calendar days
                </p>
              </div>

              <div className="card p-3">
                <p className="text-[11px] font-semibold uppercase text-slate-400">Frequent Category</p>
                <p className="mt-1 truncate font-bold text-slate-800">
                  {data.patterns.mostFrequentCategory?.category ?? "—"}
                </p>
                <p className="text-[11px] text-slate-500">
                  {data.patterns.mostFrequentCategory
                    ? `${data.patterns.mostFrequentCategory.count} txns (${data.patterns.mostFrequentCategory.percentageOfTransactions.toFixed(0)}%)`
                    : "None"}
                </p>
              </div>

              <div className="card p-3">
                <p className="text-[11px] font-semibold uppercase text-slate-400">Top 3 Concentration</p>
                <p className="mt-1 font-bold text-indigo-600">
                  {data.patterns.spendingConcentration.top3Percentage.toFixed(1)}%
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {data.patterns.spendingConcentration.top3Categories.join(", ") || "None"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <h4 className="mb-2 text-sm font-semibold text-slate-800">
                  Daily Spending Timeline
                </h4>
                <PlotlyChart
                  data={[
                    {
                      x: data.dailySpending.map((d) => d.date),
                      y: data.dailySpending.map((d) => d.amount),
                      type: "bar",
                      marker: { color: "#0d9488" },
                      name: "Daily Spend",
                    },
                  ]}
                  layout={{
                    margin: { t: 15, r: 15, b: 40, l: 45 },
                    yaxis: { tickprefix: "₹" },
                  }}
                />
              </Card>

              <Card>
                <h4 className="mb-2 text-sm font-semibold text-slate-800">
                  Weekly Spending Aggregation
                </h4>
                <PlotlyChart
                  data={[
                    {
                      x: data.weeklySpending.map((w) => w.weekLabel),
                      y: data.weeklySpending.map((w) => w.amount),
                      type: "bar",
                      marker: { color: "#6366f1" },
                      name: "Weekly Total",
                    },
                  ]}
                  layout={{
                    margin: { t: 15, r: 15, b: 40, l: 45 },
                    yaxis: { tickprefix: "₹" },
                  }}
                />
              </Card>
            </div>

            {/* Statistical Anomaly Callout */}
            {data.patterns.anomalies.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-950">
                <div className="flex items-center gap-2 font-semibold">
                  <span>⚠️</span>
                  <span>Unusual Expenditures Deserving Review (Z-Score &gt; 2.0)</span>
                </div>
                <p className="mt-1 text-xs text-amber-900">
                  The following transactions were unusually large relative to your historical spending baseline. These are flagged for your financial review and do not indicate fraud.
                </p>
                <ul className="mt-2 space-y-1.5 text-xs text-amber-900">
                  {data.patterns.anomalies.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold text-amber-950">
                        {a.date}: {fmt.currency(a.amount)} ({a.category})
                      </span>
                      {a.description && <span>— &ldquo;{a.description}&rdquo;</span>}
                      <span className="text-amber-800">[{a.deviationReason}]</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Section 6: Payment Method Analysis                                 */}
          {/* ------------------------------------------------------------------ */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">
                5. Payment Method Analysis
              </h3>
              {data.paymentMethodReconciled && (
                <Badge tone="green">
                  ✓ Reconciled: 100% of expenses accounted for
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <h4 className="mb-2 text-sm font-semibold text-slate-800">
                  Share by Payment Method
                </h4>
                <PlotlyChart
                  data={[
                    {
                      type: "pie",
                      hole: 0.5,
                      labels: data.byPaymentMethod.map((p) => p.method),
                      values: data.byPaymentMethod.map((p) => p.total),
                      marker: { colors: PALETTE.slice(2) },
                      textinfo: "percent+label",
                    },
                  ]}
                  layout={{
                    margin: { t: 15, r: 15, b: 20, l: 15 },
                    legend: { orientation: "h", y: -0.1 },
                  }}
                />
              </Card>

              <Card>
                <h4 className="mb-3 text-sm font-semibold text-slate-800">
                  Payment Method Distribution Table
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 uppercase">
                        <th className="py-2 px-3">Payment Method</th>
                        <th className="py-2 px-3 text-right">Total Spent</th>
                        <th className="py-2 px-3 text-right">% of Total</th>
                        <th className="py-2 px-3 text-right">Transactions</th>
                        <th className="py-2 px-3 text-right">Avg / Txn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.byPaymentMethod.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-slate-400">
                            No payment transactions recorded.
                          </td>
                        </tr>
                      ) : (
                        data.byPaymentMethod.map((p) => (
                          <tr key={p.method} className="hover:bg-slate-50/50">
                            <td className="py-2 px-3 font-medium text-slate-900">{p.method}</td>
                            <td className="py-2 px-3 text-right font-semibold text-slate-900">
                              {fmt.currency(p.total)}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-600">
                              {p.percentage.toFixed(1)}%
                            </td>
                            <td className="py-2 px-3 text-right text-slate-600">
                              {p.transactionCount}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-600">
                              {fmt.currency(p.avgTransactionAmount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {data.byPaymentMethod.length > 0 && (
                      <tfoot>
                        <tr className="border-t border-slate-200 font-bold text-slate-900 bg-slate-50/70">
                          <td className="py-2 px-3">Total</td>
                          <td className="py-2 px-3 text-right">{fmt.currency(data.kpis.totalExpenses)}</td>
                          <td className="py-2 px-3 text-right">100.0%</td>
                          <td className="py-2 px-3 text-right">{data.kpis.expenseTransactionsCount}</td>
                          <td className="py-2 px-3 text-right">{fmt.currency(data.kpis.avgExpensePerTransaction)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </Card>
            </div>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Section 7: Budget Performance                                      */}
          {/* ------------------------------------------------------------------ */}
          <div>
            <h3 className="mb-3 text-base font-bold text-slate-800">
              6. Budget Performance & Target Tracking
            </h3>

            <Card>
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-bold text-slate-900">
                      Monthly Overall Budget Evaluation
                    </h4>
                    <Badge
                      tone={
                        data.budgetPerformance.status === "within_budget"
                          ? "green"
                          : data.budgetPerformance.status === "near_limit"
                          ? "amber"
                          : data.budgetPerformance.status === "over_budget"
                          ? "rose"
                          : "slate"
                      }
                    >
                      {data.budgetPerformance.statusLabel}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {data.budgetPerformance.explanation}
                  </p>
                </div>

                {data.budgetPerformance.hasBudget && (
                  <div className="flex gap-4 text-xs md:text-right">
                    <div>
                      <p className="text-slate-400">Budgeted</p>
                      <p className="text-sm font-bold text-slate-800">
                        {fmt.currency(data.budgetPerformance.overallBudget)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Actual Outlay</p>
                      <p className="text-sm font-bold text-rose-600">
                        {fmt.currency(data.budgetPerformance.actualExpenses)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Remaining</p>
                      <p
                        className={`text-sm font-bold ${
                          (data.budgetPerformance.remaining ?? 0) < 0
                            ? "text-rose-600"
                            : "text-emerald-600"
                        }`}
                      >
                        {fmt.currency(data.budgetPerformance.remaining)}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {!data.budgetPerformance.hasBudget ? (
                <div className="py-6 text-center text-sm text-slate-500">
                  <p className="font-medium text-slate-700">
                    No budget configured for this period.
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Configure a monthly budget in the Budget Management module to compare your actual spending against planned financial limits.
                  </p>
                </div>
              ) : (
                <div className="mt-4">
                  <div className="mb-2 flex justify-between text-xs font-semibold text-slate-600">
                    <span>Budget Utilization</span>
                    <span>{data.budgetPerformance.utilization?.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${
                        (data.budgetPerformance.utilization ?? 0) > 100
                          ? "bg-rose-500"
                          : (data.budgetPerformance.utilization ?? 0) >= 80
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                      style={{
                        width: `${Math.min(100, data.budgetPerformance.utilization ?? 0)}%`,
                      }}
                    />
                  </div>

                  {data.budgetPerformance.categoryBreakdown.length > 0 && (
                    <div className="mt-5">
                      <h5 className="mb-2 text-xs font-semibold uppercase text-slate-500">
                        Category Budget Tracking
                      </h5>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 uppercase">
                              <th className="py-2 px-3">Category</th>
                              <th className="py-2 px-3 text-right">Budget</th>
                              <th className="py-2 px-3 text-right">Actual</th>
                              <th className="py-2 px-3 text-right">Remaining</th>
                              <th className="py-2 px-3 text-right">Utilization</th>
                              <th className="py-2 px-3 text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {data.budgetPerformance.categoryBreakdown.map((cb) => (
                              <tr key={cb.category}>
                                <td className="py-2 px-3 font-medium text-slate-800">{cb.category}</td>
                                <td className="py-2 px-3 text-right">{fmt.currency(cb.budget)}</td>
                                <td className="py-2 px-3 text-right font-semibold text-slate-800">
                                  {fmt.currency(cb.actual)}
                                </td>
                                <td
                                  className={`py-2 px-3 text-right font-medium ${
                                    cb.remaining < 0 ? "text-rose-600" : "text-emerald-600"
                                  }`}
                                >
                                  {fmt.currency(cb.remaining)}
                                </td>
                                <td className="py-2 px-3 text-right">{cb.utilization.toFixed(1)}%</td>
                                <td className="py-2 px-3 text-right">
                                  <Badge
                                    tone={
                                      cb.status === "within_budget"
                                        ? "green"
                                        : cb.status === "near_limit"
                                        ? "amber"
                                        : "rose"
                                    }
                                  >
                                    {cb.statusLabel}
                                  </Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Section 8: Understandable LSTM Forecast Section                    */}
          {/* ------------------------------------------------------------------ */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">
                7. Deep Learning Expenditure Forecast (LSTM)
              </h3>
              <Badge tone={data.forecast.predictedExpense !== null ? "brand" : "slate"}>
                {data.forecast.method}
              </Badge>
            </div>

            <Card>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-1 border-r border-slate-100 pr-4">
                  <div className="rounded-lg bg-brand-50/70 p-4 border border-brand-100">
                    <p className="text-xs font-semibold uppercase tracking-wider text-brand-800">
                      Next-Month Forecast Target
                    </p>
                    <p className="mt-1 text-2xl font-bold text-brand-900">
                      {data.forecast.predictedExpense !== null
                        ? fmt.currency(data.forecast.predictedExpense)
                        : "—"}
                    </p>
                    <p className="mt-1 text-xs font-medium text-brand-700">
                      Target: {data.forecast.targetMonthLabel}
                    </p>
                  </div>

                  <p className="text-xs leading-relaxed text-slate-600">
                    {data.forecast.plainEnglishSummary}
                  </p>

                  {/* Educational Explanations of MAE and RMSE */}
                  <div className="space-y-2.5 rounded-lg bg-slate-50 p-3 text-xs border border-slate-200/80">
                    <div>
                      <p className="font-semibold text-slate-800">
                        Mean Absolute Error (MAE):{" "}
                        {data.forecast.modelDetails?.mae != null
                          ? fmt.currency(data.forecast.modelDetails.mae)
                          : "Not evaluated"}
                      </p>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        The average absolute difference between the model&apos;s predictions and actual historical expenses, expressed in Indian Rupees (₹).
                      </p>
                    </div>

                    <div className="border-t border-slate-200/60 pt-2">
                      <p className="font-semibold text-slate-800">
                        Root Mean Squared Error (RMSE):{" "}
                        {data.forecast.modelDetails?.rmse != null
                          ? fmt.currency(data.forecast.modelDetails.rmse)
                          : "Not evaluated"}
                      </p>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        A prediction error metric in Indian Rupees (₹) giving greater weight to larger deviations.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800 mb-2">
                      Monthly Spending Trajectory & Forecast Point
                    </h4>
                    {data.forecast.historicalSeries.length > 0 ? (
                      <PlotlyChart
                        data={[
                          {
                            x: data.forecast.historicalSeries.map((h) => h.month),
                            y: data.forecast.historicalSeries.map((h) => h.amount),
                            type: "scatter",
                            mode: "lines+markers",
                            name: "Actual Historical Spend",
                            line: { color: "#0d9488", width: 2.5 },
                            marker: { size: 6 },
                          },
                          ...(data.forecast.predictedExpense !== null
                            ? [
                                {
                                  x: [
                                    data.forecast.historicalSeries[
                                      data.forecast.historicalSeries.length - 1
                                    ]?.month,
                                    data.forecast.targetMonth,
                                  ],
                                  y: [
                                    data.forecast.historicalSeries[
                                      data.forecast.historicalSeries.length - 1
                                    ]?.amount,
                                    data.forecast.predictedExpense,
                                  ],
                                  type: "scatter",
                                  mode: "lines+markers",
                                  name: "Projected Forecast",
                                  line: { color: "#6366f1", dash: "dash", width: 2 },
                                  marker: { size: 8, symbol: "diamond", color: "#6366f1" },
                                },
                              ]
                            : []),
                        ]}
                        layout={{
                          margin: { t: 20, r: 15, b: 35, l: 45 },
                          yaxis: { tickprefix: "₹" },
                          legend: { orientation: "h", y: 1.12 },
                        }}
                      />
                    ) : (
                      <div className="py-12 text-center text-xs text-slate-400">
                        Historical series unavailable for time-series projection.
                      </div>
                    )}
                  </div>

                  {data.forecast.baselineComparison && (
                    <div className="rounded-lg bg-slate-50 p-3 text-xs border border-slate-200">
                      <p className="font-semibold text-slate-700 mb-1.5">
                        Baseline Comparison on Identical Evaluation Horizon:
                      </p>
                      <div className="flex flex-wrap gap-4 text-slate-600">
                        {data.forecast.baselineComparison.map((b) => (
                          <div key={b.name}>
                            <span className="font-medium text-slate-800">{b.name}:</span>{" "}
                            MAE {fmt.currency(b.mae)} · RMSE {fmt.currency(b.rmse)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-slate-400 leading-normal">
                    ⚠️ <strong>Validation & Transparency Notice:</strong> Expenditure forecasts are statistical deep learning projections derived from historical monthly time series. They do not constitute financial guarantees or promises of future expenditures.
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Section 9: Smart Insights and Actionable Recommendations           */}
          {/* ------------------------------------------------------------------ */}
          <div>
            <h3 className="mb-3 text-base font-bold text-slate-800">
              8. Smart Insights & Actionable Recommendations
            </h3>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.insights.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-xl border p-4 text-sm shadow-xs ${
                    item.type === "alert"
                      ? "border-rose-200 bg-rose-50/60 text-rose-950"
                      : item.type === "warning"
                      ? "border-amber-200 bg-amber-50/60 text-amber-950"
                      : item.type === "positive"
                      ? "border-emerald-200 bg-emerald-50/60 text-emerald-950"
                      : "border-slate-200 bg-white text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">
                      {item.type === "alert"
                        ? "🚨"
                        : item.type === "warning"
                        ? "⚠️"
                        : item.type === "positive"
                        ? "✅"
                        : "💡"}
                    </span>
                    <h4 className="font-semibold">{item.title}</h4>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-700">{item.detail}</p>
                  {item.recommendation && (
                    <div className="mt-3 rounded-md bg-white/80 p-2.5 text-xs text-slate-800 border border-slate-200/60">
                      <strong>Recommendation:</strong> {item.recommendation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Section 10: Transaction Details Appendix                           */}
          {/* ------------------------------------------------------------------ */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">
                9. Transaction Details Appendix
              </h3>
              <div className="text-xs text-slate-500">
                Showing {Math.min(txTotal, (txPage - 1) * txPageSize + 1)} to{" "}
                {Math.min(txTotal, txPage * txPageSize)} of {txTotal} transactions
              </div>
            </div>

            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 uppercase">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Payment Method</th>
                      <th className="py-2.5 px-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedTxns.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400">
                          No transactions found for the selected reporting period.
                        </td>
                      </tr>
                    ) : (
                      displayedTxns.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3 text-xs text-slate-600 whitespace-nowrap">
                            {t.date}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-800">
                            {t.description || "—"}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{t.category}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                t.type === "Income"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {t.type}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{t.paymentMethod}</td>
                          <td
                            className={`py-2.5 px-3 text-right font-semibold ${
                              t.type === "Income" ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {fmt.currency(t.amount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Client-side Pagination Controls (Hidden on Print) */}
              {totalTxPages > 1 && (
                <div className="no-print mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                  <span className="text-slate-500">
                    Page {txPage} of {totalTxPages}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className="btn-ghost py-1 px-2.5 text-xs"
                      disabled={txPage <= 1}
                      onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                    >
                      ← Previous
                    </button>
                    <button
                      type="button"
                      className="btn-ghost py-1 px-2.5 text-xs"
                      disabled={txPage >= totalTxPages}
                      onClick={() => setTxPage((p) => Math.min(totalTxPages, p + 1))}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Section 11: Calculation Notes, Data Limitations & Report Footer   */}
          {/* ------------------------------------------------------------------ */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5 text-xs text-slate-500 space-y-2">
            <h4 className="font-semibold text-slate-700 uppercase tracking-wider text-[11px]">
              Calculation Notes & Financial Methodology
            </h4>
            <ul className="list-disc pl-4 space-y-1 text-slate-600 leading-relaxed">
              <li>
                <strong>Net Cash Flow:</strong> Calculated as Total Income − Total Expenses for the period.
              </li>
              <li>
                <strong>Savings Rate:</strong> Computed as (Net Savings ÷ Total Income) × 100 when income is recorded. If income is zero, displayed as not available to prevent misleading rates.
              </li>
              <li>
                <strong>Daily Spend:</strong> Standard daily spending divides total expenses by total calendar days in the period ({data.meta.calendarDays} days). Active daily spending divides total expenses by active spending days ({data.kpis.activeSpendingDays} days).
              </li>
              <li>
                <strong>Data Separation:</strong> Personal financial transactions are strictly isolated to the authenticated user. Model training records from external sources (e.g. Kaggle datasets) are strictly segregated from user financial records.
              </li>
              <li>
                <strong>LSTM Forecasting:</strong> Projections use TensorFlow.js recurrent neural networks trained chronologically on monthly time series.
              </li>
            </ul>
            <div className="border-t border-slate-200/80 pt-2 text-[11px] text-slate-400 flex flex-wrap justify-between">
              <span>Personal Expense Analysis & Spending Prediction Using Deep Learning</span>
              <span>Report Generated: {data.meta.generatedAtFormatted}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
