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
} from "@/components/ui";
import PlotlyChart from "@/components/PlotlyChart";

const PALETTE = [
  "#14b8a6", "#6366f1", "#f59e0b", "#ef4444", "#10b981", "#3b82f6",
  "#ec4899", "#8b5cf6", "#f97316", "#22c55e", "#0ea5e9", "#eab308", "#a855f7",
];

export default function AnalyticsPage() {
  const fmt = useFormat();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [type, setType] = useState("");

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (startDate) qs.set("startDate", startDate);
    if (endDate) qs.set("endDate", endDate);
    if (type) qs.set("type", type);
    return apiGet<{ analytics: any }>(`/api/analytics?${qs}`);
  }, [startDate, endDate, type]);

  useEffect(() => {
    let ignore = false;
    load()
      .then((res) => {
        if (!ignore) {
          setData(res.analytics);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!ignore) {
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [load]);

  const handleApply = () => {
    setLoading(true);
    load()
      .then((res) => {
        setData(res.analytics);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  if (loading && !data) return <Spinner label="Computing analytics…" />;
  if (!data) return <EmptyState>No data.</EmptyState>;

  const a = data;
  const line = (xs: any[], ys: any[], name: string, color: string) => [
    {
      x: xs,
      y: ys,
      type: "scatter",
      mode: "lines+markers",
      name,
      line: { color, width: 2 },
    },
  ];
  const bar = (xs: any[], ys: any[], color: string, name = "") => [
    { x: xs, y: ys, type: "bar", name, marker: { color } },
  ];

  return (
    <div>
      <PageHeader
        title="Expense Analytics"
        subtitle="Time-series, category and payment-method breakdowns"
        action={
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label">From</label>
              <input type="date" className="input w-auto" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" className="input w-auto" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All</option>
              <option value="Expense">Expense</option>
              <option value="Income">Income</option>
            </select>
            <button className="btn-ghost" onClick={handleApply}>Apply</button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard title="Total Income" value={fmt.currency(a.totalIncome)} tone="green" />
        <KpiCard title="Total Expenses" value={fmt.currency(a.totalExpenses)} tone="rose" />
        <KpiCard title="Net Cash Flow" value={fmt.currency(a.netCashFlow)} tone="indigo" />
        <KpiCard title="Savings Rate" value={a.savingsRate === null ? "—" : fmt.pct(a.savingsRate)} tone="brand" />
        <KpiCard title="Avg / Month" value={fmt.currency(a.avgMonthly)} tone="slate" />
        <KpiCard title="Avg / Day" value={fmt.currency(a.avgDaily)} tone="slate" />
        <KpiCard
          title="MoM Change"
          value={a.momChange === null ? "—" : `${a.momChange >= 0 ? "+" : ""}${fmt.pct(a.momChange)}`}
          tone={a.momChange != null && a.momChange > 0 ? "rose" : "green"}
        />
        <KpiCard title="Top Category" value={a.highestCategory?.category ?? "—"} tone="amber" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Monthly Income vs Expense</h3>
          <PlotlyChart
            data={[
              ...bar(a.byMonth.map((m: any) => m.month), a.byMonth.map((m: any) => m.income), "#10b981", "Income"),
              ...bar(a.byMonth.map((m: any) => m.month), a.byMonth.map((m: any) => m.expense), "#f43f5e", "Expense"),
            ]}
            layout={{ barmode: "group" }}
          />
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Expense Category Totals</h3>
          <PlotlyChart
            data={[
              {
                labels: a.byCategory.map((c: any) => c.category),
                values: a.byCategory.map((c: any) => c.total),
                type: "pie",
                hole: 0.5,
                marker: { colors: PALETTE },
              },
            ]}
          />
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Daily Spending</h3>
          <PlotlyChart data={line(a.byDay.map((d: any) => d.date), a.byDay.map((d: any) => d.total), "Daily", "#6366f1")} />
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Weekly Spending</h3>
          <PlotlyChart data={bar(a.byWeek.map((w: any) => w.week), a.byWeek.map((w: any) => w.total), "#0ea5e9")} />
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Yearly Totals</h3>
          <PlotlyChart data={bar(a.byYear.map((y: any) => y.year), a.byYear.map((y: any) => y.total), "#14b8a6")} />
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Payment Method Split</h3>
          <PlotlyChart
            data={[
              {
                labels: a.byPaymentMethod.map((p: any) => p.method),
                values: a.byPaymentMethod.map((p: any) => p.total),
                type: "pie",
                hole: 0.5,
                marker: { colors: PALETTE },
              },
            ]}
          />
        </Card>
      </div>

      <Card className="mt-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Largest Transaction</h3>
        {a.largest ? (
          <p className="text-sm text-slate-600">
            {fmt.currency(a.largest.amount)} on {fmt.date(a.largest.transactionDate)} —{" "}
            {a.largest.category} ({a.largest.paymentMethod})
          </p>
        ) : (
          <EmptyState>No transactions.</EmptyState>
        )}
      </Card>
    </div>
  );
}
