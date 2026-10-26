"use client";

import { useEffect, useState, useMemo } from "react";
import { apiGet, apiPost, apiDelete, apiPatch } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import PlotlyChart from "@/components/PlotlyChart";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  KpiCard,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { Budget, Transaction } from "@/lib/types";
import type {
  BudgetStatus,
  CategoryBudgetRow,
  BudgetWarning,
  BudgetRecommendation,
  MonthBudgetHistory,
  BudgetHistorySummary,
  PlanningWizardSuggestion,
} from "@/lib/budgetService";

const EXPENSE_CATEGORIES = [
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

const CATEGORY_ICONS: Record<string, string> = {
  Food: "🍔",
  Groceries: "🛒",
  Transport: "🚗",
  Shopping: "🛍️",
  Education: "📚",
  Healthcare: "🏥",
  Housing: "🏠",
  Utilities: "💡",
  Entertainment: "🎬",
  Subscriptions: "📱",
  Travel: "✈️",
  "Personal Care": "🧴",
  Other: "🏷️",
};

export default function BudgetsPage() {
  const fmt = useFormat();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [activeTab, setActiveTab] = useState<
    "overview" | "categories" | "forecast" | "alerts" | "wizard" | "history"
  >("overview");

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{
    kind: "success" | "error" | "info" | "warning";
    text: string;
  } | null>(null);

  // Modal & Form States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [budgetForm, setBudgetForm] = useState({
    scope: "overall",
    category: "",
    amount: "",
    name: "",
    alertThreshold: "80",
    notes: "",
    status: "active",
  });

  // Category Transactions Drawer
  const [drawer, setDrawer] = useState<{
    open: boolean;
    category: string;
    transactions: Transaction[];
    loading: boolean;
  }>({
    open: false,
    category: "",
    transactions: [],
    loading: false,
  });

  // History & Wizard States
  const [historyData, setHistoryData] = useState<BudgetHistorySummary | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [wizardTargetMonth, setWizardTargetMonth] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 7);
  });
  const [wizardData, setWizardData] = useState<PlanningWizardSuggestion | null>(null);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [wizardAllocations, setWizardAllocations] = useState<Record<string, number>>({});
  const [wizardOverallLimit, setWizardOverallLimit] = useState<number>(30000);

  // Duplicate prompt
  const [duplicating, setDuplicating] = useState(false);

  // Load Main Budget & Status Data
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await apiGet<{ budgets: Budget[]; status?: BudgetStatus }>(
          `/api/budgets?month=${month}&status=1`,
        );
        if (active) {
          setBudgets(res.budgets || []);
          setStatus(res.status ?? null);
        }
      } catch (e: any) {
        if (active) setMsg({ kind: "error", text: e.message });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [month]);

  // Load History Data when history tab is selected
  useEffect(() => {
    if (activeTab === "history" && !historyData) {
      setHistoryLoading(true);
      apiGet<BudgetHistorySummary>("/api/budgets?history=1")
        .then((data) => setHistoryData(data))
        .catch((e) => setMsg({ kind: "error", text: e.message }))
        .finally(() => setHistoryLoading(false));
    }
  }, [activeTab, historyData]);

  // Load Wizard Data when wizard tab is selected or target month changes
  useEffect(() => {
    if (activeTab === "wizard") {
      setWizardLoading(true);
      apiGet<PlanningWizardSuggestion>(`/api/budgets?wizard=1&month=${wizardTargetMonth}`)
        .then((data) => {
          setWizardData(data);
          setWizardOverallLimit(data.suggestedOverallBudget);
          const initialAlloc: Record<string, number> = {};
          data.suggestedCategoryAllocations.forEach((c) => {
            initialAlloc[c.category] = c.suggestedAmount;
          });
          setWizardAllocations(initialAlloc);
        })
        .catch((e) => setMsg({ kind: "error", text: e.message }))
        .finally(() => setWizardLoading(false));
    }
  }, [activeTab, wizardTargetMonth]);

  // Navigation: Previous / Next Month
  function changeMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const date = new Date(y, m - 1 + delta, 1);
    setMonth(date.toISOString().slice(0, 7));
  }

  // Open Modal for New Budget
  function handleOpenCreate(preselectedCategory?: string) {
    setEditingBudget(null);
    setBudgetForm({
      scope: preselectedCategory ? "category" : "overall",
      category: preselectedCategory || "",
      amount: "",
      name: preselectedCategory ? `${preselectedCategory} Budget` : "Monthly Overall Budget",
      alertThreshold: "80",
      notes: "",
      status: "active",
    });
    setIsModalOpen(true);
  }

  // Open Modal for Edit Budget
  function handleOpenEdit(b: Budget) {
    setEditingBudget(b);
    setBudgetForm({
      scope: b.category ? "category" : "overall",
      category: b.category || "",
      amount: String(b.budgetAmount),
      name: b.name || (b.category ? `${b.category} Budget` : "Overall Budget"),
      alertThreshold: String(b.alertThreshold ?? 80),
      notes: b.notes || "",
      status: b.status || "active",
    });
    setIsModalOpen(true);
  }

  // Save (Create or Update) Budget
  async function handleSaveBudget(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const amt = parseFloat(budgetForm.amount);
    if (isNaN(amt) || amt <= 0) {
      setMsg({ kind: "error", text: "Please enter a valid positive budget amount." });
      return;
    }

    try {
      if (editingBudget) {
        await apiPatch(`/api/budgets/${editingBudget.id}`, {
          budgetAmount: amt,
          name: budgetForm.name,
          notes: budgetForm.notes,
          alertThreshold: parseInt(budgetForm.alertThreshold, 10) || 80,
          status: budgetForm.status,
        });
        setMsg({ kind: "success", text: "Budget successfully updated." });
      } else {
        await apiPost("/api/budgets", {
          month,
          category: budgetForm.scope === "category" ? budgetForm.category : null,
          budgetAmount: amt,
          name: budgetForm.name,
          notes: budgetForm.notes,
          alertThreshold: parseInt(budgetForm.alertThreshold, 10) || 80,
          status: budgetForm.status,
        });
        setMsg({ kind: "success", text: "New budget successfully created." });
      }

      setIsModalOpen(false);
      // Refresh active month data
      const res = await apiGet<{ budgets: Budget[]; status?: BudgetStatus }>(
        `/api/budgets?month=${month}&status=1`,
      );
      setBudgets(res.budgets || []);
      setStatus(res.status ?? null);
    } catch (err: any) {
      setMsg({ kind: "error", text: err.message });
    }
  }

  // Toggle Budget Status (Active / Paused)
  async function handleToggleStatus(b: Budget) {
    const newStatus = b.status === "paused" ? "active" : "paused";
    try {
      await apiPatch(`/api/budgets/${b.id}`, { status: newStatus });
      setBudgets((prev) =>
        prev.map((item) => (item.id === b.id ? { ...item, status: newStatus } : item)),
      );
      setMsg({
        kind: "info",
        text: `Budget for ${b.category || "Overall"} marked as ${newStatus}.`,
      });
      const res = await apiGet<{ budgets: Budget[]; status?: BudgetStatus }>(
        `/api/budgets?month=${month}&status=1`,
      );
      setStatus(res.status ?? null);
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message });
    }
  }

  // Delete Budget
  async function handleDeleteBudget(id: number, name: string) {
    if (!confirm(`Are you sure you want to delete the budget for "${name}"?`)) return;
    try {
      await apiDelete(`/api/budgets/${id}`);
      setMsg({ kind: "success", text: `Budget "${name}" deleted.` });
      setBudgets((prev) => prev.filter((b) => b.id !== id));
      const res = await apiGet<{ budgets: Budget[]; status?: BudgetStatus }>(
        `/api/budgets?month=${month}&status=1`,
      );
      setStatus(res.status ?? null);
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message });
    }
  }

  // Duplicate Budgets from Previous Month
  async function handleDuplicateFromPrevious() {
    const [y, m] = month.split("-").map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevMonthStr = prevDate.toISOString().slice(0, 7);

    if (
      !confirm(
        `Duplicate all active budgets from ${fmt.month(prevMonthStr)} into ${fmt.month(
          month,
        )}? Existing budgets with the same category will be updated.`,
      )
    ) {
      return;
    }

    setDuplicating(true);
    try {
      const res = await apiPost<{ ok: boolean; budgets: Budget[] }>("/api/budgets", {
        action: "duplicate",
        fromMonth: prevMonthStr,
        toMonth: month,
      });
      setMsg({
        kind: "success",
        text: `Successfully duplicated ${res.budgets?.length || 0} budget(s) from ${fmt.month(
          prevMonthStr,
        )}.`,
      });
      const refresh = await apiGet<{ budgets: Budget[]; status?: BudgetStatus }>(
        `/api/budgets?month=${month}&status=1`,
      );
      setBudgets(refresh.budgets || []);
      setStatus(refresh.status ?? null);
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message });
    } finally {
      setDuplicating(false);
    }
  }

  // Open Drawer to view category transactions
  async function handleOpenCategoryTransactions(catName: string) {
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const startDate = `${month}-01`;
    const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

    setDrawer({ open: true, category: catName, transactions: [], loading: true });
    try {
      const res = await apiGet<{ count: number; transactions: Transaction[] }>(
        `/api/transactions?category=${encodeURIComponent(
          catName,
        )}&startDate=${startDate}&endDate=${endDate}&type=Expense`,
      );
      setDrawer({
        open: true,
        category: catName,
        transactions: res.transactions || [],
        loading: false,
      });
    } catch (e: any) {
      setDrawer((prev) => ({ ...prev, loading: false }));
      setMsg({ kind: "error", text: `Failed to load transactions: ${e.message}` });
    }
  }

  // Wizard: Save Bulk Plan
  async function handleSaveWizardPlan() {
    if (wizardOverallLimit <= 0) {
      setMsg({ kind: "error", text: "Overall budget limit must be positive." });
      return;
    }
    const bulkList = [
      {
        month: wizardTargetMonth,
        category: null,
        budgetAmount: wizardOverallLimit,
        name: `Overall Budget (${wizardTargetMonth})`,
      },
      ...Object.entries(wizardAllocations)
        .filter(([_, amt]) => amt > 0)
        .map(([cat, amt]) => ({
          month: wizardTargetMonth,
          category: cat,
          budgetAmount: amt,
          name: `${cat} Allocation`,
        })),
    ];

    try {
      await apiPost("/api/budgets", { action: "bulk", budgets: bulkList });
      setMsg({
        kind: "success",
        text: `Budget plan successfully established for ${fmt.month(wizardTargetMonth)}!`,
      });
      setMonth(wizardTargetMonth);
      setActiveTab("overview");
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message });
    }
  }

  // Helper Tone Formatter
  const getTone = (level: string) => {
    switch (level) {
      case "exceeded":
      case "Over Budget":
        return "rose";
      case "warning":
      case "Near Limit":
        return "amber";
      case "Caution":
      case "forecast":
        return "brand";
      case "ok":
      case "On Track":
        return "green";
      default:
        return "slate";
    }
  };

  // Plotly Data: Actual vs. Budget by Category
  const actualVsBudgetChart = useMemo(() => {
    if (!status || !status.categoryBreakdown.length) return null;
    const items = status.categoryBreakdown.filter((c) => c.budget !== null || c.actual > 0);
    const categories = items.map((c) => c.category);
    const budgetsData = items.map((c) => c.budget ?? 0);
    const actualsData = items.map((c) => c.actual);

    return {
      data: [
        {
          x: categories,
          y: budgetsData,
          name: "Allocated Budget",
          type: "bar",
          marker: { color: "#94a3b8" },
        },
        {
          x: categories,
          y: actualsData,
          name: "Actual Spend",
          type: "bar",
          marker: {
            color: actualsData.map((val, idx) =>
              budgetsData[idx] > 0 && val > budgetsData[idx] ? "#e11d48" : "#0d9488",
            ),
          },
        },
      ],
      layout: {
        barmode: "group",
        title: { text: "Category Allocations vs. Actual Expenditure", font: { size: 14 } },
        xaxis: { title: "Category", tickangle: -25 },
        yaxis: { title: "Amount (₹)" },
        height: 320,
        margin: { t: 40, b: 60, l: 60, r: 20 },
      },
    };
  }, [status]);

  // Plotly Data: Multi-month history chart
  const historyChart = useMemo(() => {
    if (!historyData || !historyData.history.length) return null;
    const months = historyData.history.map((h) => h.month);
    const budgetsArr = historyData.history.map((h) => h.overallBudget ?? 0);
    const actualsArr = historyData.history.map((h) => h.actualExpenses);

    return {
      data: [
        {
          x: months,
          y: budgetsArr,
          name: "Budget Cap",
          type: "scatter",
          mode: "lines+markers",
          line: { color: "#64748b", dash: "dash", width: 2 },
        },
        {
          x: months,
          y: actualsArr,
          name: "Actual Expenses",
          type: "bar",
          marker: {
            color: actualsArr.map((act, i) =>
              budgetsArr[i] > 0 && act > budgetsArr[i] ? "#f43f5e" : "#14b8a6",
            ),
          },
        },
      ],
      layout: {
        title: { text: "Historical Monthly Budget vs. Realized Spending", font: { size: 14 } },
        xaxis: { title: "Month" },
        yaxis: { title: "Total (₹)" },
        height: 320,
        margin: { t: 40, b: 50, l: 60, r: 20 },
      },
    };
  }, [historyData]);

  return (
    <div className="space-y-6">
      {/* Page Header with Action Controls */}
      <PageHeader
        title="Intelligent Budget Management"
        subtitle="Active expenditure tracking, daily burn-rate forecasting, and autonomous limit enforcement"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Month Navigator */}
            <div className="flex items-center rounded-lg border border-slate-300 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => changeMonth(-1)}
                className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-100"
                title="Previous Month"
              >
                ◀
              </button>
              <input
                type="month"
                className="border-none bg-transparent px-2 py-1 text-sm font-semibold text-slate-700 outline-none"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
              <button
                type="button"
                onClick={() => changeMonth(1)}
                className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-100"
                title="Next Month"
              >
                ▶
              </button>
            </div>

            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={handleDuplicateFromPrevious}
              disabled={duplicating}
              title="Duplicate budgets from previous month"
            >
              📋 Duplicate Last Month
            </button>

            <button
              type="button"
              className="btn-ghost text-xs text-brand-700"
              onClick={() => setActiveTab("wizard")}
            >
              🧙 Planning Wizard
            </button>

            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => handleOpenCreate()}
            >
              + Set Budget
            </button>
          </div>
        }
      />

      {/* Notification / Feedback Banner */}
      {msg && (
        <Alert kind={msg.kind}>
          <div className="flex items-center justify-between">
            <span>{msg.text}</span>
            <button
              type="button"
              onClick={() => setMsg(null)}
              className="text-xs font-bold opacity-75 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </Alert>
      )}

      {/* Top Level Financial Health KPI Summary Bar */}
      {status && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <KpiCard
            title="Total Budget"
            value={status.overallBudget ? fmt.currency(status.overallBudget) : "Unset"}
            subtitle={
              status.unallocatedReserve !== null && status.unallocatedReserve > 0
                ? `Reserve: ${fmt.currency(status.unallocatedReserve)}`
                : "Active period limit"
            }
            tone="slate"
          />
          <KpiCard
            title="Actual Spent"
            value={fmt.currency(status.actualExpenses)}
            subtitle={`${status.daysElapsed} days elapsed`}
            tone="rose"
          />
          <KpiCard
            title="Remaining"
            value={status.remaining !== null ? fmt.currency(status.remaining) : "—"}
            subtitle={
              status.remaining !== null && status.remaining < 0
                ? "Over limit!"
                : "Spend headroom"
            }
            tone={status.remaining !== null && status.remaining < 0 ? "rose" : "green"}
          />
          <KpiCard
            title="Utilization"
            value={status.utilization !== null ? fmt.pct(status.utilization) : "—"}
            subtitle={
              status.utilization !== null && status.utilization >= 100
                ? "Exceeded"
                : status.utilization !== null && status.utilization >= 80
                ? "Near Limit"
                : "Healthy Pace"
            }
            tone={
              status.utilization !== null && status.utilization >= 100
                ? "rose"
                : status.utilization !== null && status.utilization >= 80
                ? "amber"
                : "green"
            }
          />
          <KpiCard
            title="Projected End"
            value={fmt.currency(status.projectedPeriodEnd)}
            subtitle={
              status.projectedOverspend > 0
                ? `+${fmt.currency(status.projectedOverspend)} overspend`
                : "Within target"
            }
            tone={status.projectedOverspend > 0 ? "rose" : "brand"}
          />
          <KpiCard
            title="Daily Burn Rate"
            value={`${fmt.currency(status.dailyBurnRate)}/d`}
            subtitle={
              status.allowableDailyRemaining > 0
                ? `Target: ≤${fmt.currency(status.allowableDailyRemaining)}/d`
                : "Pace limit"
            }
            tone="slate"
          />
          <KpiCard
            title="At Risk"
            value={`${status.categoriesOverBudget} Over / ${status.categoriesNearLimit} Near`}
            subtitle="Category thresholds"
            tone={status.categoriesOverBudget > 0 ? "rose" : "green"}
          />
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {[
          { key: "overview", label: "📊 Overview & Tracking" },
          {
            key: "categories",
            label: `🎯 Category Budgets (${status?.categoryBreakdown.length || 0})`,
          },
          { key: "forecast", label: "🔮 Forecast & Intelligence" },
          {
            key: "alerts",
            label: `⚡ Alerts & Actions (${
              (status?.warnings.length || 0) + (status?.recommendations.length || 0)
            })`,
          },
          { key: "wizard", label: "🧙 Planning Wizard" },
          { key: "history", label: "📜 Performance History" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as any)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
              activeTab === tab.key
                ? "bg-brand-600 text-white shadow-sm"
                : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && !status ? (
        <div className="flex justify-center py-16">
          <Spinner label="Evaluating real-time budget balances & run rates…" />
        </div>
      ) : (
        <>
          {/* ============================================================== */}
          {/* TAB 1: OVERVIEW & TRACKING */}
          {/* ============================================================== */}
          {activeTab === "overview" && status && (
            <div className="space-y-6">
              {/* Overall Budget Progress Card */}
              {status.overallBudget !== null && (
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-slate-800">
                        Monthly Spending Progress — {fmt.month(month)}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {fmt.currency(status.actualExpenses)} spent of{" "}
                        {fmt.currency(status.overallBudget)} planned cap (
                        {fmt.pct(status.utilization ?? 0)} consumed)
                      </p>
                    </div>
                    <Badge tone={getTone(status.utilization && status.utilization >= 100 ? "exceeded" : status.utilization && status.utilization >= 80 ? "warning" : "ok") as any}>
                      {status.utilization && status.utilization >= 100
                        ? "🚨 Over Budget"
                        : status.utilization && status.utilization >= 80
                        ? "⚠️ Approaching Cap"
                        : "✅ On Track"}
                    </Badge>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-4">
                    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full transition-all duration-500 ${
                          status.utilization && status.utilization >= 100
                            ? "bg-rose-500"
                            : status.utilization && status.utilization >= 80
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                        }`}
                        style={{
                          width: `${Math.min(100, status.utilization ?? 0)}%`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-slate-400">
                      <span>₹0</span>
                      <span>Safe Buffer (80%)</span>
                      <span>Cap: {fmt.currency(status.overallBudget)}</span>
                    </div>
                  </div>

                  {/* Burn rate projection callout */}
                  {status.projectedExhaustionDate && (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <strong>⏳ Velocity Warning:</strong> At your current burn rate of{" "}
                      <strong>{fmt.currency(status.dailyBurnRate)}/day</strong>, your overall budget
                      is projected to run out on{" "}
                      <strong className="underline">{status.projectedExhaustionDate}</strong>.
                      To stay within budget, limit spending to{" "}
                      <strong>{fmt.currency(status.allowableDailyRemaining)}/day</strong> for the
                      remaining days.
                    </div>
                  )}
                </Card>
              )}

              {/* Visual Analytics Chart */}
              {actualVsBudgetChart && (
                <Card>
                  <PlotlyChart
                    data={actualVsBudgetChart.data}
                    layout={actualVsBudgetChart.layout}
                  />
                </Card>
              )}

              {/* Budgets Table */}
              <Card>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">
                      Configured Budgets ({month})
                    </h3>
                    <p className="text-xs text-slate-500">
                      Active overall and category allocations for this calendar period
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={() => handleOpenCreate()}
                  >
                    + Add Allocation
                  </button>
                </div>

                {budgets.length === 0 ? (
                  <EmptyState>
                    No budgets configured for {fmt.month(month)} yet. Click "+ Add Allocation" or
                    use the Budget Planning Wizard to configure limits.
                  </EmptyState>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                          <th className="py-2.5">Scope / Name</th>
                          <th>Category</th>
                          <th>Allocated Limit</th>
                          <th>Alert Threshold</th>
                          <th>Status</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {budgets.map((b) => (
                          <tr key={b.id} className="hover:bg-slate-50">
                            <td className="py-2.5 font-medium text-slate-800">
                              {b.name || (b.category ? `${b.category} Budget` : "Overall Budget")}
                              {b.notes && (
                                <p className="text-xs text-slate-400 font-normal">{b.notes}</p>
                              )}
                            </td>
                            <td>
                              <Badge tone={b.category ? "brand" : "slate"}>
                                {b.category ? `${CATEGORY_ICONS[b.category] || "🏷️"} ${b.category}` : "🌐 Overall"}
                              </Badge>
                            </td>
                            <td className="font-semibold text-slate-700">
                              {fmt.currency(b.budgetAmount)}
                            </td>
                            <td>
                              <span className="text-xs text-slate-600">
                                {b.alertThreshold ?? 80}%
                              </span>
                            </td>
                            <td>
                              <Badge tone={b.status === "paused" ? "slate" : "green"}>
                                {b.status === "paused" ? "⏸️ Paused" : "🟢 Active"}
                              </Badge>
                            </td>
                            <td className="text-right space-x-2">
                              <button
                                type="button"
                                className="text-xs text-slate-600 hover:text-brand-600 font-medium"
                                onClick={() => handleOpenEdit(b)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="text-xs text-slate-500 hover:text-slate-800"
                                onClick={() => handleToggleStatus(b)}
                              >
                                {b.status === "paused" ? "Resume" : "Pause"}
                              </button>
                              <button
                                type="button"
                                className="text-xs text-rose-600 hover:underline"
                                onClick={() =>
                                  handleDeleteBudget(
                                    b.id,
                                    b.name || b.category || "Overall Budget",
                                  )
                                }
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: CATEGORY BUDGETS */}
          {/* ============================================================== */}
          {activeTab === "categories" && status && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600">
                  Real-time spending vs. allocated limits across all active expense categories.
                </p>
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={() => handleOpenCreate("Food")}
                >
                  + Add Category Budget
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {status.categoryBreakdown.map((c) => {
                  const icon = CATEGORY_ICONS[c.category] || "🏷️";
                  const pctVal = c.utilization ?? 0;
                  return (
                    <Card key={c.category} className="flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">{icon}</span>
                            <div>
                              <h4 className="font-semibold text-slate-800">{c.category}</h4>
                              <p className="text-xs text-slate-400">
                                {c.dailyAvg ? `~${fmt.currency(c.dailyAvg)}/day avg` : "No daily avg"}
                              </p>
                            </div>
                          </div>
                          <Badge tone={getTone(c.status) as any}>{c.status}</Badge>
                        </div>

                        {/* Amounts */}
                        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-xs text-slate-400 uppercase">Spent</span>
                            <p className="font-bold text-slate-800">{fmt.currency(c.actual)}</p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400 uppercase">Budget</span>
                            <p className="font-semibold text-slate-600">
                              {c.budget !== null ? fmt.currency(c.budget) : "Unbudgeted"}
                            </p>
                          </div>
                        </div>

                        {/* Progress */}
                        {c.budget !== null && (
                          <div className="mt-3">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full ${
                                  pctVal >= 100
                                    ? "bg-rose-500"
                                    : pctVal >= 80
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                                }`}
                                style={{ width: `${Math.min(100, pctVal)}%` }}
                              />
                            </div>
                            <div className="mt-1 flex justify-between text-xs text-slate-500">
                              <span>{fmt.pct(pctVal)} consumed</span>
                              <span
                                className={
                                  c.remaining !== null && c.remaining < 0
                                    ? "text-rose-600 font-bold"
                                    : ""
                                }
                              >
                                {c.remaining !== null
                                  ? c.remaining >= 0
                                    ? `${fmt.currency(c.remaining)} left`
                                    : `Over by ${fmt.currency(Math.abs(c.remaining))}`
                                  : ""}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Projected spend */}
                        {c.projected != null && c.projected > 0 && (
                          <p className="mt-2 text-xs text-slate-500">
                            Projected month-end: <strong>{fmt.currency(c.projected)}</strong>
                          </p>
                        )}
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                        <button
                          type="button"
                          className="text-xs font-semibold text-brand-700 hover:underline"
                          onClick={() => handleOpenCategoryTransactions(c.category)}
                        >
                          View Transactions ➔
                        </button>
                        {c.budget === null ? (
                          <button
                            type="button"
                            className="text-xs text-slate-500 hover:text-slate-800"
                            onClick={() => handleOpenCreate(c.category)}
                          >
                            + Set Limit
                          </button>
                        ) : null}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: FORECAST & INTELLIGENCE */}
          {/* ============================================================== */}
          {activeTab === "forecast" && status && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* LSTM Deep Learning Forecast Card */}
                <Card>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-slate-800">
                      🤖 Deep Learning Spending Forecast
                    </h3>
                    <Badge tone="brand">LSTM Neural Model</Badge>
                  </div>
                  <div className="mt-4">
                    {status.lstmForecast && status.lstmForecast.predictedExpense !== null ? (
                      <div className="space-y-3">
                        <div className="rounded-lg bg-teal-50 border border-teal-200 p-4">
                          <span className="text-xs text-teal-700 uppercase font-semibold">
                            Target Month Projected Outlay
                          </span>
                          <p className="text-3xl font-extrabold text-teal-900 mt-1">
                            {fmt.currency(status.lstmForecast.predictedExpense)}
                          </p>
                          <p className="mt-2 text-xs text-teal-800">
                            {status.lstmForecast.explanation}
                          </p>
                        </div>
                        {status.overallBudget !== null && (
                          <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-600">
                            <strong>Budget Comparison:</strong> Planned cap is{" "}
                            {fmt.currency(status.overallBudget)}. The LSTM model predicts{" "}
                            {status.lstmForecast.varianceVsBudget != null &&
                            status.lstmForecast.varianceVsBudget > 0 ? (
                              <span className="text-rose-600 font-bold">
                                an overrun of {fmt.currency(status.lstmForecast.varianceVsBudget)}
                              </span>
                            ) : (
                              <span className="text-emerald-600 font-bold">
                                spending will remain comfortably within limit
                              </span>
                            )}
                            .
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
                        <p>
                          LSTM Model is either untrained or currently evaluating historical records.
                        </p>
                        <p className="mt-1">
                          Visit <strong>Model Training</strong> to calibrate the neural network with
                          your personal expenditure dataset.
                        </p>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Real-time Burn Rate Run-Rate Card */}
                <Card>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-slate-800">
                      📈 Burn Rate Run-Rate Projection
                    </h3>
                    <Badge tone="slate">Linear Baseline</Badge>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="text-xs text-slate-400 uppercase font-semibold">
                            Daily Spending Velocity
                          </span>
                          <p className="text-2xl font-bold text-slate-800 mt-1">
                            {fmt.currency(status.dailyBurnRate)}/day
                          </p>
                          <span className="text-xs text-slate-500">
                            Across {status.daysElapsed} days
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400 uppercase font-semibold">
                            Projected Month-End Outlay
                          </span>
                          <p className="text-2xl font-bold text-brand-700 mt-1">
                            {fmt.currency(status.projectedPeriodEnd)}
                          </p>
                          <span className="text-xs text-slate-500">
                            {status.totalDaysInMonth} total calendar days
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 p-4 space-y-2 text-xs text-slate-600">
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span>Planned Budget Cap:</span>
                        <strong className="text-slate-800">
                          {status.overallBudget ? fmt.currency(status.overallBudget) : "Unset"}
                        </strong>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span>Projected Month-End Variance:</span>
                        <strong
                          className={
                            status.projectedOverspend > 0 ? "text-rose-600" : "text-emerald-600"
                          }
                        >
                          {status.projectedOverspend > 0
                            ? `+${fmt.currency(status.projectedOverspend)} Overspend`
                            : "Within Budget"}
                        </strong>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span>Estimated Budget Exhaustion Date:</span>
                        <strong>{status.projectedExhaustionDate || "Will not exhaust early"}</strong>
                      </div>
                      <div className="flex justify-between pt-1">
                        <span>Allowable Daily Spend (Remaining Days):</span>
                        <strong className="text-brand-700">
                          {status.allowableDailyRemaining > 0
                            ? `${fmt.currency(status.allowableDailyRemaining)}/day`
                            : "₹0/day"}
                        </strong>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: ALERTS & RECOMMENDATIONS */}
          {/* ============================================================== */}
          {activeTab === "alerts" && status && (
            <div className="space-y-6">
              {/* Threshold Warnings */}
              <div>
                <h3 className="text-base font-semibold text-slate-800 mb-3">
                  🔔 Active Budget Alerts & Threshold Notifications
                </h3>
                {status.warnings.length === 0 ? (
                  <EmptyState>No budget alerts triggered for {fmt.month(month)}.</EmptyState>
                ) : (
                  <div className="space-y-3">
                    {status.warnings.map((w, idx) => (
                      <div
                        key={idx}
                        className={`rounded-xl border p-4 text-sm ${
                          w.level === "exceeded"
                            ? "border-rose-200 bg-rose-50 text-rose-900"
                            : w.level === "warning"
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : w.level === "forecast"
                            ? "border-indigo-200 bg-indigo-50 text-indigo-900"
                            : "border-emerald-200 bg-emerald-50 text-emerald-900"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <span className="text-xs font-bold uppercase tracking-wider">
                              {w.level.toUpperCase()} • {w.category || "Overall"}
                            </span>
                            <p className="font-semibold">{w.message}</p>
                            {w.recommendedAction && (
                              <p className="text-xs opacity-90">
                                <strong>Recommended Action:</strong> {w.recommendedAction}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Data-Driven Financial Recommendations */}
              <div>
                <h3 className="text-base font-semibold text-slate-800 mb-3">
                  💡 Intelligent Financial Optimization Recommendations
                </h3>
                {status.recommendations.length === 0 ? (
                  <EmptyState>
                    All spending patterns are within normal parameters. No corrective
                    recommendations needed at this time.
                  </EmptyState>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {status.recommendations.map((rec) => (
                      <Card key={rec.id} className="flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <Badge tone="brand">
                              {rec.type.replace(/_/g, " ").toUpperCase()}
                            </Badge>
                            {rec.relevantCategory && (
                              <span className="text-xs font-semibold text-slate-500">
                                {rec.relevantCategory}
                              </span>
                            )}
                          </div>
                          <h4 className="mt-2 font-bold text-slate-800 text-sm">{rec.title}</h4>
                          <p className="mt-1 text-xs text-slate-600">{rec.reason}</p>

                          <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs">
                            <strong className="text-slate-700">Financial Evidence:</strong>{" "}
                            <span className="text-slate-600">{rec.supportingData}</span>
                          </div>

                          <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-900">
                            <strong>Target Action:</strong> {rec.suggestedAction}
                          </div>
                        </div>

                        <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400">
                          {rec.estimatedImpact}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 5: BUDGET PLANNING WIZARD */}
          {/* ============================================================== */}
          {activeTab === "wizard" && (
            <div className="space-y-6">
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-800">
                      🧙 Guided Budget Planning Wizard
                    </h3>
                    <p className="text-xs text-slate-500">
                      Build data-driven budgets tailored to historical spending patterns
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-600 uppercase">
                      Planning For:
                    </label>
                    <input
                      type="month"
                      className="input w-auto text-xs py-1"
                      value={wizardTargetMonth}
                      onChange={(e) => setWizardTargetMonth(e.target.value)}
                    />
                  </div>
                </div>

                {wizardLoading ? (
                  <div className="py-12 flex justify-center">
                    <Spinner label="Analyzing historical consumption & generating recommendations…" />
                  </div>
                ) : wizardData ? (
                  <div className="mt-6 space-y-6">
                    {/* Overall Limit Suggestion */}
                    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <span className="text-xs font-bold uppercase text-brand-700">
                            Suggested Overall Limit
                          </span>
                          <p className="text-xs text-brand-900 mt-0.5">
                            Calculated from {wizardData.historicalMonthsCount} recent completed
                            month(s) with a 5% safety contingency buffer.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-700">₹</span>
                          <input
                            type="number"
                            step="500"
                            className="input w-36 font-bold text-base"
                            value={wizardOverallLimit}
                            onChange={(e) => setWizardOverallLimit(parseFloat(e.target.value) || 0)}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Category Allocations Builder */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-slate-800">
                          Category Allocations ({wizardData.suggestedCategoryAllocations.length})
                        </h4>
                        <div className="text-xs text-slate-500">
                          Total Allocated:{" "}
                          <strong className="text-slate-800">
                            {fmt.currency(
                              Object.values(wizardAllocations).reduce((a, b) => a + b, 0),
                            )}
                          </strong>{" "}
                          / {fmt.currency(wizardOverallLimit)}
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                            <tr>
                              <th className="py-2.5 px-3">Category</th>
                              <th>Historical Avg</th>
                              <th>Last Month</th>
                              <th>Planned Allocation (₹)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {wizardData.suggestedCategoryAllocations.map((cat) => (
                              <tr key={cat.category} className="hover:bg-slate-50">
                                <td className="py-2 px-3 font-medium">
                                  {CATEGORY_ICONS[cat.category] || "🏷️"} {cat.category}
                                </td>
                                <td className="text-xs text-slate-500">
                                  {fmt.currency(cat.historicalAverage)}
                                </td>
                                <td className="text-xs text-slate-500">
                                  {fmt.currency(cat.lastMonthSpend)}
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    step="100"
                                    className="input w-32 py-1 text-xs"
                                    value={wizardAllocations[cat.category] ?? 0}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value) || 0;
                                      setWizardAllocations((prev) => ({
                                        ...prev,
                                        [cat.category]: val,
                                      }));
                                    }}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Summary & Save */}
                    <div className="flex flex-wrap items-center justify-between border-t border-slate-200 pt-4 gap-4">
                      <div className="text-xs text-slate-500">
                        Unallocated Reserve:{" "}
                        <strong className="text-emerald-600">
                          {fmt.currency(
                            Math.max(
                              0,
                              wizardOverallLimit -
                                Object.values(wizardAllocations).reduce((a, b) => a + b, 0),
                            ),
                          )}
                        </strong>
                      </div>

                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleSaveWizardPlan}
                      >
                        💾 Save & Apply {fmt.month(wizardTargetMonth)} Budget Plan
                      </button>
                    </div>
                  </div>
                ) : null}
              </Card>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 6: PERFORMANCE HISTORY */}
          {/* ============================================================== */}
          {activeTab === "history" && (
            <div className="space-y-6">
              {historyLoading ? (
                <div className="py-16 flex justify-center">
                  <Spinner label="Loading historical performance telemetry…" />
                </div>
              ) : historyData ? (
                <>
                  {/* Historical Chart */}
                  {historyChart && (
                    <Card>
                      <PlotlyChart
                        data={historyChart.data}
                        layout={historyChart.layout}
                      />
                    </Card>
                  )}

                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <Card>
                      <h4 className="text-xs font-bold uppercase text-slate-400">
                        Budget Adherence Rate
                      </h4>
                      <p className="text-3xl font-extrabold text-emerald-600 mt-1">
                        {historyData.overallAdherenceRate}%
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Percentage of months completed within set limits
                      </p>
                    </Card>

                    <Card>
                      <h4 className="text-xs font-bold uppercase text-slate-400">
                        Repeated Overspending Categories
                      </h4>
                      {historyData.repeatedOverspendingCategories.length === 0 ? (
                        <p className="text-xs text-emerald-700 mt-2 font-medium">
                          ✅ None. No category has exceeded budget repeatedly.
                        </p>
                      ) : (
                        <div className="mt-2 space-y-1">
                          {historyData.repeatedOverspendingCategories.map((c) => (
                            <div
                              key={c.category}
                              className="flex justify-between text-xs font-medium text-rose-700"
                            >
                              <span>
                                {CATEGORY_ICONS[c.category] || "🏷️"} {c.category}
                              </span>
                              <span>{c.occurrences} overspends</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>

                    <Card>
                      <h4 className="text-xs font-bold uppercase text-slate-400">
                        Consistently Unused Allocations
                      </h4>
                      {historyData.consistentlyUnusedCategories.length === 0 ? (
                        <p className="text-xs text-slate-500 mt-2">
                          All allocations are utilized efficiently (&gt;60%).
                        </p>
                      ) : (
                        <div className="mt-2 space-y-1">
                          {historyData.consistentlyUnusedCategories.map((c) => (
                            <div
                              key={c.category}
                              className="flex justify-between text-xs text-slate-600"
                            >
                              <span>
                                {CATEGORY_ICONS[c.category] || "🏷️"} {c.category}
                              </span>
                              <span>{c.averageUtilization}% avg used</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>

                  {/* History Table */}
                  <Card>
                    <h3 className="text-sm font-semibold text-slate-800 mb-3">
                      Chronological Budget Records
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                          <tr>
                            <th className="py-2">Month</th>
                            <th>Budget Cap</th>
                            <th>Realized Spend</th>
                            <th>Utilization</th>
                            <th>Status</th>
                            <th>Over-Budget Categories</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {historyData.history.map((h) => (
                            <tr key={h.month} className="hover:bg-slate-50">
                              <td className="py-2.5 font-medium">{fmt.month(h.month)}</td>
                              <td>
                                {h.overallBudget ? fmt.currency(h.overallBudget) : "—"}
                              </td>
                              <td className="font-semibold text-slate-800">
                                {fmt.currency(h.actualExpenses)}
                              </td>
                              <td>{h.utilization !== null ? fmt.pct(h.utilization) : "—"}</td>
                              <td>
                                <Badge tone={getTone(h.status) as any}>
                                  {h.status.toUpperCase()}
                                </Badge>
                              </td>
                              <td>
                                {h.categoriesOverBudgetCount > 0 ? (
                                  <span className="text-rose-600 font-bold text-xs">
                                    {h.categoriesOverBudgetCount} category
                                    {h.categoriesOverBudgetCount === 1 ? "" : "ies"} over
                                  </span>
                                ) : (
                                  <span className="text-emerald-600 text-xs">All within limit</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </>
              ) : null}
            </div>
          )}
        </>
      )}

      {/* ============================================================== */}
      {/* MODAL: CREATE / EDIT BUDGET */}
      {/* ============================================================== */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-800">
                {editingBudget ? "Edit Budget Limit" : `Set New Budget (${month})`}
              </h3>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setIsModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBudget} className="mt-4 space-y-4">
              {!editingBudget && (
                <div>
                  <label className="label">Budget Scope</label>
                  <select
                    className="input"
                    value={budgetForm.scope}
                    onChange={(e) =>
                      setBudgetForm({
                        ...budgetForm,
                        scope: e.target.value,
                        name:
                          e.target.value === "overall"
                            ? "Overall Monthly Budget"
                            : `${budgetForm.category || "Category"} Budget`,
                      })
                    }
                  >
                    <option value="overall">🌐 Overall Monthly Limit</option>
                    <option value="category">🎯 Category-Specific Allocation</option>
                  </select>
                </div>
              )}

              {budgetForm.scope === "category" && !editingBudget && (
                <div>
                  <label className="label">Expense Category</label>
                  <select
                    className="input"
                    required
                    value={budgetForm.category}
                    onChange={(e) =>
                      setBudgetForm({
                        ...budgetForm,
                        category: e.target.value,
                        name: `${e.target.value} Budget`,
                      })
                    }
                  >
                    <option value="">Select a category…</option>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_ICONS[c] || "🏷️"} {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="label">Budget Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  className="input font-semibold text-slate-800"
                  placeholder="e.g. 15000"
                  value={budgetForm.amount}
                  onChange={(e) => setBudgetForm({ ...budgetForm, amount: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Budget Label / Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Food & Dining Cap"
                  value={budgetForm.name}
                  onChange={(e) => setBudgetForm({ ...budgetForm, name: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Alert Threshold (%)</label>
                <select
                  className="input"
                  value={budgetForm.alertThreshold}
                  onChange={(e) =>
                    setBudgetForm({ ...budgetForm, alertThreshold: e.target.value })
                  }
                >
                  <option value="50">50% (Early warning)</option>
                  <option value="75">75% (Standard buffer)</option>
                  <option value="80">80% (Recommended default)</option>
                  <option value="90">90% (Urgent notice)</option>
                  <option value="100">100% (Strict limit)</option>
                </select>
              </div>

              <div>
                <label className="label">Notes / Instructions (Optional)</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="e.g. Keep dining out under ₹3,000 this month"
                  value={budgetForm.notes}
                  onChange={(e) => setBudgetForm({ ...budgetForm, notes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingBudget ? "Update Budget" : "Save Budget"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* DRAWER: CATEGORY TRANSACTIONS LIST */}
      {/* ============================================================== */}
      {drawer.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 p-4 bg-slate-50">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{CATEGORY_ICONS[drawer.category] || "🏷️"}</span>
                <div>
                  <h3 className="font-bold text-slate-800 text-base">
                    {drawer.category} Transactions — {fmt.month(month)}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {drawer.transactions.length} record(s) found
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600 font-bold"
                onClick={() => setDrawer((prev) => ({ ...prev, open: false }))}
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {drawer.loading ? (
                <div className="py-12 flex justify-center">
                  <Spinner label="Loading category records…" />
                </div>
              ) : drawer.transactions.length === 0 ? (
                <EmptyState>No expense transactions recorded in {drawer.category} for {fmt.month(month)}.</EmptyState>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="py-2">Date</th>
                      <th>Description</th>
                      <th>Payment Method</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {drawer.transactions.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="py-2.5 text-xs text-slate-600 font-mono">
                          {t.transactionDate}
                        </td>
                        <td className="font-medium text-slate-800">
                          {t.description || "Expense"}
                        </td>
                        <td className="text-xs text-slate-500">{t.paymentMethod}</td>
                        <td className="text-right font-bold text-rose-600">
                          {fmt.currency(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border-t border-slate-100 p-3 bg-slate-50 flex justify-between items-center text-xs text-slate-500">
              <span>
                Total Spent:{" "}
                <strong className="text-slate-800">
                  {fmt.currency(drawer.transactions.reduce((acc, t) => acc + Number(t.amount), 0))}
                </strong>
              </span>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setDrawer((prev) => ({ ...prev, open: false }))}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
