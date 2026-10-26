"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import {
  Card,
  KpiCard,
  PageHeader,
  Spinner,
  Alert,
  EmptyState,
  Badge,
} from "@/components/ui";
import PlotlyChart from "@/components/PlotlyChart";

const PALETTE = [
  "#14b8a6", "#6366f1", "#f59e0b", "#ef4444", "#10b981", "#3b82f6",
  "#ec4899", "#8b5cf6", "#f97316", "#22c55e", "#0ea5e9", "#eab308", "#a855f7",
];

export default function DashboardClient({ user }: { user?: { id: number; name: string; email: string } }) {
  const fmt = useFormat();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [type, setType] = useState("");
  const [category, setCategory] = useState("");
  const [cats, setCats] = useState<any>(null);

  useEffect(() => {
    let active = true;
    apiGet("/api/categories")
      .then((c) => {
        if (active) setCats(c);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const loadData = useCallback(() => {
    const qs = new URLSearchParams();
    if (startDate) qs.set("startDate", startDate);
    if (endDate) qs.set("endDate", endDate);
    if (type) qs.set("type", type);
    if (category) qs.set("category", category);
    return apiGet(`/api/dashboard?${qs.toString()}`);
  }, [startDate, endDate, type, category]);

  useEffect(() => {
    let ignore = false;
    loadData()
      .then((d) => {
        if (!ignore) {
          setData(d);
          setError(null);
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (!ignore) {
          setError(e.message || "Failed to load dashboard data");
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [loadData]);

  const handleApply = () => {
    setLoading(true);
    loadData()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: any) => {
        setError(e.message || "Failed to load dashboard data");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const handleReset = () => {
    setStartDate("");
    setEndDate("");
    setType("");
    setCategory("");
    setLoading(true);
  };

  if (loading && !data) return <Spinner label="Loading dashboard…" />;
  if (error && !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard" subtitle="Personal expense analytics & spending prediction" />
        <Alert kind="error">{error}</Alert>
        <button className="btn-primary" onClick={handleApply}>
          Retry
        </button>
      </div>
    );
  }
  if (!data) return <EmptyState>No data available.</EmptyState>;

  const { kpis, charts, forecast, recent } = data;

  // Chart 1: Monthly spending trends
  const expenseTrend = [
    {
      x: charts.monthlyExpense.map((m: any) => m.month),
      y: charts.monthlyExpense.map((m: any) => m.total),
      type: "scatter",
      mode: "lines+markers",
      line: { color: "#14b8a6", width: 3 },
      marker: { size: 6, color: "#0d9488" },
      name: "Expenses",
    },
  ];

  // Chart 2: Monthly income vs expenses
  const incomeVsExpense = [
    {
      x: charts.incomeVsExpense.map((m: any) => m.month),
      y: charts.incomeVsExpense.map((m: any) => m.income),
      type: "bar",
      name: "Income",
      marker: { color: "#10b981" },
    },
    {
      x: charts.incomeVsExpense.map((m: any) => m.month),
      y: charts.incomeVsExpense.map((m: any) => m.expense),
      type: "bar",
      name: "Expense",
      marker: { color: "#f43f5e" },
    },
  ];

  // Chart 3: Expenses by category (donut chart)
  const donut = [
    {
      labels: charts.categoryDonut.map((c: any) => c.category),
      values: charts.categoryDonut.map((c: any) => c.total),
      type: "pie",
      hole: 0.55,
      marker: { colors: PALETTE },
      textinfo: "label+percent",
    },
  ];

  // Chart 4: Payment method breakdown
  const payment = [
    {
      x: charts.paymentMethod.map((p: any) => p.method),
      y: charts.paymentMethod.map((p: any) => p.total),
      type: "bar",
      name: "Total",
      marker: { color: "#6366f1" },
    },
  ];

  // Chart 5: Monthly category comparison
  const categories = Array.from(
    new Set(charts.monthlyCategory.map((m: any) => m.category)),
  );
  const months = Array.from(
    new Set(charts.monthlyCategory.map((m: any) => m.month)),
  ).sort();
  const monthlyCatTraces = categories.map((cat, i) => ({
    x: months,
    y: months.map((mo) => {
      const found = charts.monthlyCategory.find(
        (m: any) => m.month === mo && m.category === cat,
      );
      return found ? found.total : 0;
    }),
    type: "bar",
    name: cat as string,
    marker: { color: PALETTE[i % PALETTE.length] },
  }));

  const categoryOptions =
    type === "Income"
      ? cats?.incomeCategories ?? []
      : type === "Expense"
        ? cats?.expenseCategories ?? []
        : [...(cats?.expenseCategories ?? []), ...(cats?.incomeCategories ?? [])];

  const hasFilter = Boolean(startDate || endDate || type || category);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Personal expense analytics with LSTM-based spending forecast"
        action={
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label">From</label>
              <input
                type="date"
                className="input w-auto text-xs"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">To</label>
              <input
                type="date"
                className="input w-auto text-xs"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Type</label>
              <select
                className="input w-auto text-xs"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="">All Types</option>
                <option value="Expense">Expense</option>
                <option value="Income">Income</option>
              </select>
            </div>
            <div>
              <label className="label">Category</label>
              <select
                className="input w-auto text-xs"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All Categories</option>
                {categoryOptions.map((c: string) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn-primary text-xs" onClick={handleApply}>
              Apply
            </button>
            {hasFilter && (
              <button className="btn-ghost text-xs" onClick={handleReset}>
                Reset
              </button>
            )}
          </div>
        }
      />

      {error && <Alert kind="error">{error}</Alert>}

      {/* Primary KPI Cards Required by Specification */}
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Key Performance Indicators
        </h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard
            title="Total Income"
            value={fmt.currency(kpis.totalIncome)}
            tone="green"
            subtitle="All selected income"
          />
          <KpiCard
            title="Total Expenses"
            value={fmt.currency(kpis.totalExpenses)}
            tone="rose"
            subtitle="All selected spending"
          />
          <KpiCard
            title="Current Month Expenses"
            value={fmt.currency(kpis.currentMonthExpenses)}
            tone="rose"
            subtitle={`Spent in ${data.currentMonth}`}
          />
          <KpiCard
            title="Current Month Savings"
            value={fmt.currency(kpis.currentMonthSavings)}
            tone={kpis.currentMonthSavings >= 0 ? "green" : "rose"}
            subtitle={`Net balance in ${data.currentMonth}`}
          />
        </div>
      </div>

      {/* Secondary KPI Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          title="Net Cash Flow *"
          value={fmt.currency(kpis.netCashFlow)}
          subtitle="Income − Expenses"
          tone="indigo"
        />
        <KpiCard
          title="Savings Rate"
          value={kpis.savingsRate === null ? "—" : fmt.pct(kpis.savingsRate)}
          tone="brand"
          subtitle={kpis.savingsRate !== null ? "Overall savings ratio" : "No income recorded"}
        />
        <KpiCard
          title="Monthly Budget"
          value={kpis.monthlyBudget === null ? "—" : fmt.currency(kpis.monthlyBudget)}
          subtitle={
            kpis.budgetRemaining === null
              ? "No budget set"
              : `Remaining: ${fmt.currency(kpis.budgetRemaining)}`
          }
          tone={
            kpis.budgetUtilization != null && kpis.budgetUtilization >= 100
              ? "rose"
              : "amber"
          }
        />
        <KpiCard
          title="Predicted Next Month"
          value={kpis.predictedNextMonth === null ? "—" : fmt.currency(kpis.predictedNextMonth)}
          subtitle={
            kpis.predictedNextMonth === null
              ? "No expense history recorded"
              : forecast?.personalized?.status === "run_rate"
              ? `Forecast for ${forecast.targetMonth} (Run-rate estimate)`
              : forecast?.personalized?.status === "baseline"
              ? `Forecast for ${forecast.targetMonth} (Historical baseline)`
              : forecast?.personalized?.status === "ready"
              ? `Forecast for ${forecast.targetMonth} (LSTM forecast)`
              : forecast?.targetMonth
              ? `Forecast for ${forecast.targetMonth}`
              : "Awaiting expense data"
          }
          tone="brand"
        />
      </div>

      <p className="text-[11px] text-slate-400">
        * Net cash flow is a calculated metric from recorded income and expense transactions.
      </p>

      {/* Interactive Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            Monthly Spending Trends
          </h3>
          {charts.monthlyExpense.length === 0 ? (
            <EmptyState>No monthly expense data to display.</EmptyState>
          ) : (
            <PlotlyChart data={expenseTrend} />
          )}
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            Monthly Income vs. Expenses
          </h3>
          {charts.incomeVsExpense.length === 0 ? (
            <EmptyState>No income or expense data to display.</EmptyState>
          ) : (
            <PlotlyChart data={incomeVsExpense} layout={{ barmode: "group" }} />
          )}
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            Expenses by Category
          </h3>
          {charts.categoryDonut.length === 0 ? (
            <EmptyState>No expense categories recorded.</EmptyState>
          ) : (
            <PlotlyChart data={donut} />
          )}
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            Payment Method Breakdown
          </h3>
          {charts.paymentMethod.length === 0 ? (
            <EmptyState>No payment method records found.</EmptyState>
          ) : (
            <PlotlyChart data={payment} />
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            Monthly Category Comparison
          </h3>
          {charts.monthlyCategory.length === 0 ? (
            <EmptyState>No monthly category data available.</EmptyState>
          ) : (
            <PlotlyChart data={monthlyCatTraces} layout={{ barmode: "stack" }} />
          )}
        </Card>
      </div>

      {/* Recent Transactions Section */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">
              Recent Transactions
            </h3>
            <p className="text-xs text-slate-400">
              Showing the latest {recent.length} recorded transactions
            </p>
          </div>
          <Link
            href="/transactions"
            className="btn-ghost text-xs hover:border-brand-500 hover:text-brand-600"
          >
            View all transactions →
          </Link>
        </div>

        {recent.length === 0 ? (
          <EmptyState>
            No transactions found.{" "}
            <Link
              href="/transactions"
              className="font-medium text-brand-600 hover:underline"
            >
              Add an expense or income
            </Link>{" "}
            or generate demonstration data in Settings.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2.5">Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Payment Method</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t: any) => (
                  <tr
                    key={t.id}
                    className="border-b border-slate-100 transition-colors hover:bg-slate-50"
                  >
                    <td className="py-2.5 font-mono text-xs text-slate-600">
                      {fmt.date(t.transactionDate)}
                    </td>
                    <td className="max-w-[200px] truncate text-slate-700">
                      {t.description || "—"}
                    </td>
                    <td className="text-slate-600">{t.category}</td>
                    <td>
                      <Badge tone={t.transactionType === "Income" ? "green" : "rose"}>
                        {t.transactionType}
                      </Badge>
                    </td>
                    <td className="text-xs text-slate-500">{t.paymentMethod}</td>
                    <td
                      className={`text-right font-medium ${
                        t.transactionType === "Income"
                          ? "text-emerald-600"
                          : "text-rose-600"
                      }`}
                    >
                      {t.transactionType === "Income" ? "+" : "-"}
                      {fmt.currency(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
