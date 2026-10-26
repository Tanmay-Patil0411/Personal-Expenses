"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import {
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  Badge,
} from "@/components/ui";
import PlotlyChart from "@/components/PlotlyChart";
import type {
  IntelligentInsightsResult,
  SmartInsight,
  InsightCategory,
  InsightPriority,
} from "@/lib/insights";

const CATEGORY_TABS: { id: InsightCategory | "all"; label: string; icon: string }[] = [
  { id: "all", label: "All Insights", icon: "✨" },
  { id: "spending_behavior", label: "Spending Behavior", icon: "📊" },
  { id: "budget_intelligence", label: "Budget Intelligence", icon: "🎯" },
  { id: "anomaly", label: "Unusual Transactions", icon: "⚡" },
  { id: "saving_opportunity", label: "Saving Opportunities", icon: "💡" },
  { id: "cash_flow", label: "Cash Flow", icon: "💳" },
  { id: "prediction", label: "Predictions", icon: "🧠" },
];

export default function InsightsPage() {
  const fmt = useFormat();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<IntelligentInsightsResult | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(
    new Date().toISOString().slice(0, 7),
  );
  const [selectedTab, setSelectedTab] = useState<InsightCategory | "all">("all");
  const [selectedPriority, setSelectedPriority] = useState<InsightPriority | "all">("all");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("all");
  const [expandedInsightIds, setExpandedInsightIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);

  const fetchInsights = useCallback((monthStr: string) => {
    setLoading(true);
    apiGet<IntelligentInsightsResult>(`/api/insights?month=${encodeURIComponent(monthStr)}`)
      .then((res) => {
        setData(res);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchInsights(selectedMonth);
  }, [fetchInsights, selectedMonth]);

  const toggleExpand = (id: string) => {
    setExpandedInsightIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDismiss = (id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Distinct category names present in insights for the dropdown
  const availableCategories = useMemo(() => {
    if (!data?.insights) return [];
    const set = new Set<string>();
    for (const ins of data.insights) {
      if (ins.relatedCategory) set.add(ins.relatedCategory);
    }
    return Array.from(set).sort();
  }, [data]);

  // Filtered insights
  const filteredInsights = useMemo(() => {
    if (!data?.insights) return [];
    return data.insights.filter((ins) => {
      // Dismissed check
      const isDismissed = dismissedIds.has(ins.id);
      if (!showDismissed && isDismissed) return false;
      if (showDismissed && !isDismissed) return false;

      // Tab category filter
      if (selectedTab !== "all" && ins.category !== selectedTab) return false;

      // Priority filter
      if (selectedPriority !== "all" && ins.priority !== selectedPriority) return false;

      // Category filter
      if (
        selectedCategoryFilter !== "all" &&
        ins.relatedCategory !== selectedCategoryFilter
      ) {
        return false;
      }

      return true;
    });
  }, [
    data,
    dismissedIds,
    showDismissed,
    selectedTab,
    selectedPriority,
    selectedCategoryFilter,
  ]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    for (const tab of CATEGORY_TABS) counts[tab.id] = 0;
    if (!data?.insights) return counts;

    for (const ins of data.insights) {
      if (!dismissedIds.has(ins.id)) {
        counts.all += 1;
        if (counts[ins.category] !== undefined) {
          counts[ins.category] += 1;
        }
      }
    }
    return counts;
  }, [data, dismissedIds]);

  const metrics = data?.metrics;
  const chartData = data?.chartData;

  return (
    <div className="space-y-6 pb-12">
      {/* ------------------------------------------------------------------ */}
      {/* Header & Controls                                                  */}
      {/* ------------------------------------------------------------------ */}
      <PageHeader
        title="Intelligent Personal Finance Analyst"
        subtitle="Data-driven financial diagnosis, statistical anomaly detection, budget burn pacing & actionable savings"
        action={
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="month"
              className="input w-auto text-sm"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              aria-label="Analysis Month"
            />
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={() => fetchInsights(selectedMonth)}
              disabled={loading}
            >
              🔄 Refresh
            </button>
            <Link href="/reports" className="btn-primary text-sm shadow-xs">
              📄 Full Financial Report
            </Link>
          </div>
        }
      />

      {/* ------------------------------------------------------------------ */}
      {/* Executive Overview KPI Metrics Grid                                */}
      {/* ------------------------------------------------------------------ */}
      {metrics && (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Total Expenses
            </p>
            <p className="mt-1 text-2xl font-bold text-rose-600">
              {fmt.currency(metrics.totalExpenses)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {metrics.momExpenseChangePct !== null ? (
                <span
                  className={
                    metrics.momExpenseChangePct > 0
                      ? "text-rose-600 font-semibold"
                      : "text-emerald-600 font-semibold"
                  }
                >
                  {metrics.momExpenseChangePct > 0 ? "▲ +" : "▼ "}
                  {metrics.momExpenseChangePct.toFixed(1)}% vs prev month
                </span>
              ) : (
                `${metrics.elapsedDays} day(s) elapsed in month`
              )}
            </p>
          </div>

          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Net Cash Flow
            </p>
            <p
              className={`mt-1 text-2xl font-bold ${
                metrics.netCashFlow >= 0 ? "text-indigo-600" : "text-rose-600"
              }`}
            >
              {fmt.currency(metrics.netCashFlow)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Income: {fmt.currency(metrics.totalIncome)}
            </p>
          </div>

          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Savings Rate
            </p>
            <p className="mt-1 text-2xl font-bold text-brand-700">
              {metrics.savingsRate !== null ? `${metrics.savingsRate.toFixed(1)}%` : "N/A"}
            </p>
            <p className="mt-1 text-xs text-slate-500 truncate" title={metrics.savingsRateLabel}>
              {metrics.savingsRateLabel}
            </p>
          </div>

          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Budget Utilization
            </p>
            <p
              className={`mt-1 text-2xl font-bold ${
                metrics.overallBudget === null
                  ? "text-slate-700"
                  : (metrics.budgetUtilization ?? 0) > 100
                  ? "text-rose-600"
                  : (metrics.budgetUtilization ?? 0) >= 80
                  ? "text-amber-600"
                  : "text-emerald-600"
              }`}
            >
              {metrics.budgetUtilization !== null ? `${metrics.budgetUtilization.toFixed(1)}%` : "None"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {metrics.overallBudget !== null
                ? `Remaining: ${fmt.currency(metrics.budgetRemaining)}`
                : "No budget set"}
            </p>
          </div>

          <div className="card p-4 col-span-2 sm:col-span-2 md:col-span-4 lg:col-span-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Projected Month-End
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-800">
              {fmt.currency(metrics.projectedMonthEndExpense)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Burn rate: {fmt.currency(metrics.dailyBurnRate)}/day
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Status banner summary                                              */}
      {/* ------------------------------------------------------------------ */}
      {data && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-xl text-brand-600 border border-brand-100">
              💡
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {data.summaryText}
              </p>
              <p className="text-xs text-slate-500">
                Analysis period: <strong>{metrics?.currentMonthLabel}</strong> ({metrics?.elapsedDays} of {metrics?.daysInMonth} days analyzed)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {dismissedIds.size > 0 && (
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-slate-800 underline transition-colors"
                onClick={() => setShowDismissed((prev) => !prev)}
              >
                {showDismissed
                  ? "← Return to Active Insights"
                  : `View ${dismissedIds.size} Reviewed/Dismissed Alert(s)`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Category Tabs & Interactive Filters                                */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-3">
        <div className="flex overflow-x-auto border-b border-slate-200 pb-1 gap-1">
          {CATEGORY_TABS.map((tab) => {
            const count = tabCounts[tab.id] ?? 0;
            const active = selectedTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedTab(tab.id)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
                  active
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    active ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-500">Filter by:</span>

            {/* Priority filter */}
            <select
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 outline-none focus:border-brand-500"
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value as any)}
              aria-label="Filter by priority"
            >
              <option value="all">All Priorities</option>
              <option value="high">🔴 High Priority</option>
              <option value="medium">🟡 Medium Priority</option>
              <option value="low">🔵 Low Priority</option>
            </select>

            {/* Category filter */}
            {availableCategories.length > 0 && (
              <select
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 outline-none focus:border-brand-500"
                value={selectedCategoryFilter}
                onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                aria-label="Filter by category"
              >
                <option value="all">All Spending Categories</option>
                {availableCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="text-xs text-slate-400">
            Showing <strong>{filteredInsights.length}</strong> intelligent insight(s)
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Loading & Empty States                                             */}
      {/* ------------------------------------------------------------------ */}
      {loading && !data && (
        <div className="py-16 text-center">
          <Spinner label="Intelligent analyst analyzing your financial ledger..." />
        </div>
      )}

      {!loading && filteredInsights.length === 0 && (
        <EmptyState>
          <div className="space-y-2">
            <p className="font-semibold text-slate-700">No Insights Match Your Filter</p>
            <p className="text-xs text-slate-500">
              Try switching category tabs or clearing priority filters to view other observations.
            </p>
            <button
              type="button"
              className="btn-ghost mt-3 text-xs"
              onClick={() => {
                setSelectedTab("all");
                setSelectedPriority("all");
                setSelectedCategoryFilter("all");
                setShowDismissed(false);
              }}
            >
              Reset Filters
            </button>
          </div>
        </EmptyState>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Intelligent Insight Cards                                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-4">
        {filteredInsights.map((ins) => {
          const isExpanded = expandedInsightIds.has(ins.id);
          const isDismissed = dismissedIds.has(ins.id);

          const priorityBadgeTone =
            ins.priority === "high"
              ? "rose"
              : ins.priority === "medium"
              ? "amber"
              : "slate";

          const categoryBadgeColor =
            ins.category === "budget_intelligence"
              ? "bg-purple-100 text-purple-800"
              : ins.category === "anomaly"
              ? "bg-amber-100 text-amber-800"
              : ins.category === "saving_opportunity"
              ? "bg-emerald-100 text-emerald-800"
              : ins.category === "cash_flow"
              ? "bg-sky-100 text-sky-800"
              : ins.category === "prediction"
              ? "bg-indigo-100 text-indigo-800"
              : "bg-slate-100 text-slate-800";

          return (
            <div
              key={ins.id}
              className={`rounded-xl border bg-white shadow-xs transition-all ${
                ins.priority === "high"
                  ? "border-rose-200/90"
                  : ins.priority === "medium"
                  ? "border-amber-200/80"
                  : "border-slate-200"
              }`}
            >
              {/* Card Header & Summary Bar */}
              <div className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${categoryBadgeColor}`}
                    >
                      {ins.category.replace("_", " ")}
                    </span>
                    <Badge tone={priorityBadgeTone}>
                      {ins.priority.toUpperCase()} PRIORITY
                    </Badge>
                    {ins.relatedCategory && (
                      <span className="text-xs text-slate-500 font-medium">
                        📁 {ins.relatedCategory}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">{ins.coveredPeriod}</span>
                    <button
                      type="button"
                      className="text-slate-400 hover:text-slate-700 ml-2"
                      title={isDismissed ? "Restore alert" : "Dismiss alert"}
                      onClick={() => toggleDismiss(ins.id)}
                    >
                      {isDismissed ? "↩ Restore" : "✕ Dismiss"}
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <h3 className="text-base font-bold text-slate-900">{ins.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    {ins.summary}
                  </p>
                </div>

                {/* Supporting Financial Data Chips Grid */}
                {ins.financialData.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {ins.financialData.map((dp, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg bg-slate-50 p-2.5 text-xs border border-slate-200/70"
                      >
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                          {dp.label}
                        </p>
                        <p className="mt-0.5 font-bold text-slate-800">{dp.value}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Progressive Disclosure Toggle */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => toggleExpand(ins.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 transition-colors"
                  >
                    <span>{isExpanded ? "▲ Hide Detailed Diagnosis & Proof" : "▼ View Detailed Diagnosis & Proof"}</span>
                  </button>

                  {ins.actionLink && (
                    <Link
                      href={ins.actionLink.href}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      <span>{ins.actionLink.label}</span>
                      <span>→</span>
                    </Link>
                  )}
                </div>
              </div>

              {/* Progressive Disclosure Content Body */}
              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50/70 p-5 text-xs space-y-3.5">
                  <div>
                    <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[10px] text-slate-400">
                      1. What Happened
                    </h4>
                    <p className="mt-1 text-slate-700 leading-relaxed text-sm">
                      {ins.whatHappened}
                    </p>
                  </div>

                  <div>
                    <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[10px] text-slate-400">
                      2. Why It Matters
                    </h4>
                    <p className="mt-1 text-slate-700 leading-relaxed text-sm">
                      {ins.whyItMatters}
                    </p>
                  </div>

                  <div className="rounded-lg bg-white p-3.5 border border-slate-200 shadow-xs">
                    <h4 className="font-bold text-emerald-800 uppercase tracking-wide text-[10px]">
                      3. Recommended Action
                    </h4>
                    <p className="mt-1 text-slate-800 leading-relaxed text-sm">
                      {ins.suggestedAction}
                    </p>
                    {ins.potentialImpact && (
                      <p className="mt-2 text-xs font-semibold text-emerald-700">
                        📈 Potential Impact: {ins.potentialImpact}
                      </p>
                    )}
                  </div>

                  <div className="pt-1 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/60">
                    <span>
                      <strong>Calculation Method:</strong> {ins.calculationMethod}
                    </span>
                    <span>Deterministic formula · Verified against ledger</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Visual Analytics Charts Section                                    */}
      {/* ------------------------------------------------------------------ */}
      {chartData && (
        <div className="mt-8 space-y-6">
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-lg font-bold text-slate-900">
              Visual Financial Analytics
            </h2>
            <p className="text-xs text-slate-500">
              Comparative category shifts, budget pacing trajectory, and historical patterns
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Category Shift Comparison */}
            <Card>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Category Spending Shift (Current vs Previous Month)
                </h3>
                <span className="text-xs text-slate-400">Indian Rupee (₹)</span>
              </div>
              {chartData.categoryChanges.length > 0 ? (
                <PlotlyChart
                  data={[
                    {
                      x: chartData.categoryChanges.map((c) => c.category),
                      y: chartData.categoryChanges.map((c) => c.previous),
                      type: "bar",
                      name: "Previous Month",
                      marker: { color: "#94a3b8" },
                    },
                    {
                      x: chartData.categoryChanges.map((c) => c.category),
                      y: chartData.categoryChanges.map((c) => c.current),
                      type: "bar",
                      name: "Current Month",
                      marker: { color: "#0d9488" },
                    },
                  ]}
                  layout={{
                    barmode: "group",
                    margin: { t: 15, r: 15, b: 40, l: 45 },
                    yaxis: { tickprefix: "₹" },
                    legend: { orientation: "h", y: 1.15 },
                  }}
                />
              ) : (
                <EmptyState>Insufficient category history for comparison chart.</EmptyState>
              )}
            </Card>

            {/* Historical Inflow vs Outflow Trend */}
            <Card>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Historical Trajectory (Last 6 Months)
                </h3>
                <span className="text-xs text-slate-400">Income vs Outflow</span>
              </div>
              {chartData.historicalTrend.length > 0 ? (
                <PlotlyChart
                  data={[
                    {
                      x: chartData.historicalTrend.map((h) => h.month),
                      y: chartData.historicalTrend.map((h) => h.income),
                      type: "scatter",
                      mode: "lines+markers",
                      name: "Income",
                      line: { color: "#10b981", width: 2.5 },
                    },
                    {
                      x: chartData.historicalTrend.map((h) => h.month),
                      y: chartData.historicalTrend.map((h) => h.expense),
                      type: "scatter",
                      mode: "lines+markers",
                      name: "Expenses",
                      line: { color: "#f43f5e", width: 2.5 },
                    },
                  ]}
                  layout={{
                    margin: { t: 15, r: 15, b: 40, l: 45 },
                    yaxis: { tickprefix: "₹" },
                    legend: { orientation: "h", y: 1.15 },
                  }}
                />
              ) : (
                <EmptyState>Historical timeline unavailable.</EmptyState>
              )}
            </Card>

            {/* Potential Discretionary Savings by Category */}
            <Card>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Targeted Discretionary Savings Scenarios (15% Haircut)
                </h3>
                <span className="text-xs text-slate-400">Monthly vs Annual Benefit</span>
              </div>
              {chartData.savingsOpportunities.length > 0 ? (
                <PlotlyChart
                  data={[
                    {
                      x: chartData.savingsOpportunities.map((s) => s.category),
                      y: chartData.savingsOpportunities.map((s) => s.potentialMonthlySavings),
                      type: "bar",
                      name: "Monthly Savings (₹)",
                      marker: { color: "#14b8a6" },
                    },
                    {
                      x: chartData.savingsOpportunities.map((s) => s.category),
                      y: chartData.savingsOpportunities.map((s) => s.potentialAnnualSavings),
                      type: "bar",
                      name: "Annualized Savings (₹)",
                      marker: { color: "#6366f1" },
                    },
                  ]}
                  layout={{
                    barmode: "group",
                    margin: { t: 15, r: 15, b: 40, l: 45 },
                    yaxis: { tickprefix: "₹" },
                    legend: { orientation: "h", y: 1.15 },
                  }}
                />
              ) : (
                <EmptyState>No high-discretionary categories found to project savings.</EmptyState>
              )}
            </Card>

            {/* Budget vs Actual vs Projected Burn */}
            <Card>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Budget Burn Pacing & Month-End Projection
                </h3>
                <span className="text-xs text-slate-400">Comparison (₹)</span>
              </div>
              <PlotlyChart
                data={[
                  {
                    x: ["Actual Spent", "Projected Month-End", "Target Budget"],
                    y: [
                      chartData.budgetVsActual.actual,
                      chartData.budgetVsActual.projected,
                      chartData.budgetVsActual.budget ?? 0,
                    ],
                    type: "bar",
                    marker: {
                      color: [
                        "#0d9488",
                        (chartData.budgetVsActual.projected > (chartData.budgetVsActual.budget ?? Infinity))
                          ? "#f43f5e"
                          : "#6366f1",
                        "#e2e8f0",
                      ],
                    },
                  },
                ]}
                layout={{
                  margin: { t: 15, r: 15, b: 40, l: 45 },
                  yaxis: { tickprefix: "₹" },
                }}
              />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
