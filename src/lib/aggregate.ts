import { getTransactions, type TransactionFilters } from "./transactionService";
import { computeAnalytics } from "./analytics";
import { getSettings } from "./settingsService";
import { computeBudgetStatus } from "./budgetService";
import { buildInsights, detectAnomalies, generateIntelligentInsights } from "./insights";
import { getForecastStatus, forecastVsBudget } from "@/ml/pipeline";
import { normalizeMonthKey, addMonths } from "./config";

export interface DashboardData {
  kpis: {
    totalIncome: number;
    totalExpenses: number;
    currentMonthExpenses: number;
    currentMonthIncome: number;
    currentMonthSavings: number;
    netCashFlow: number;
    savingsRate: number | null;
    monthlyBudget: number | null;
    budgetRemaining: number | null;
    budgetUtilization: number | null;
    predictedNextMonth: number | null;
    predictedVsBudget: number | null;
    highestCategory: string | null;
    momChange: number | null;
  };
  charts: {
    monthlyExpense: { month: string; total: number }[];
    incomeVsExpense: { month: string; income: number; expense: number }[];
    categoryDonut: { category: string; total: number }[];
    paymentMethod: { method: string; total: number }[];
    monthlyCategory: { month: string; category: string; total: number }[];
  };
  forecast: Awaited<ReturnType<typeof getForecastStatus>>;
  recent: Awaited<ReturnType<typeof getTransactions>>;
  currentMonth: string;
  settings: Awaited<ReturnType<typeof getSettings>>;
}

export async function gatherDashboard(
  filters: TransactionFilters = {},
  userId?: number,
): Promise<DashboardData> {
  const effectiveUserId = filters.userId ?? userId;
  const settings = await getSettings(effectiveUserId);
  const txns = await getTransactions({ ...filters, userId: effectiveUserId });
  const analytics = computeAnalytics(txns);

  const currentMonth = normalizeMonthKey(new Date());
  const thisMonthTxns = txns.filter(
    (t) => normalizeMonthKey(t.transactionDate) === currentMonth,
  );
  const thisMonthExpenses = thisMonthTxns
    .filter((t) => t.transactionType === "Expense")
    .reduce((a, t) => a + Number(t.amount), 0);
  const thisMonthIncome = thisMonthTxns
    .filter((t) => t.transactionType === "Income")
    .reduce((a, t) => a + Number(t.amount), 0);
  const thisMonthSavings = thisMonthIncome - thisMonthExpenses;

  const thisMonthByCat: Record<string, number> = {};
  for (const t of thisMonthTxns) {
    if (t.transactionType === "Expense")
      thisMonthByCat[t.category] = (thisMonthByCat[t.category] ?? 0) + Number(t.amount);
  }
  const budget = await computeBudgetStatus(
    currentMonth,
    thisMonthByCat,
    thisMonthExpenses,
    settings,
    effectiveUserId,
  );
  const forecast = await getForecastStatus(effectiveUserId);

  let predictedVsBudget: number | null = null;
  if (forecast.predictedExpense != null && forecast.targetMonth) {
    const fvb = await forecastVsBudget(
      forecast.targetMonth,
      forecast.predictedExpense,
      effectiveUserId,
    );
    predictedVsBudget = fvb.difference;
  }

  // Monthly category matrix for grouped chart.
  const monthlyCategoryMap = new Map<string, { month: string; category: string; total: number }>();
  for (const t of txns) {
    if (t.transactionType !== "Expense") continue;
    const month = normalizeMonthKey(t.transactionDate);
    const key = `${month}|${t.category}`;
    const cur = monthlyCategoryMap.get(key) ?? { month, category: t.category, total: 0 };
    cur.total += Number(t.amount);
    monthlyCategoryMap.set(key, cur);
  }
  const monthlyCategory = [...monthlyCategoryMap.values()].sort((a, b) =>
    a.month.localeCompare(b.month) || b.total - a.total,
  );

  const recent = [...txns]
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.id - a.id)
    .slice(0, 8);

  return {
    kpis: {
      totalIncome: analytics.totalIncome,
      totalExpenses: analytics.totalExpenses,
      currentMonthExpenses: thisMonthExpenses,
      currentMonthIncome: thisMonthIncome,
      currentMonthSavings: thisMonthSavings,
      netCashFlow: analytics.netCashFlow,
      savingsRate: analytics.savingsRate,
      monthlyBudget: budget.overallBudget,
      budgetRemaining: budget.remaining,
      budgetUtilization: budget.utilization,
      predictedNextMonth: forecast.predictedExpense,
      predictedVsBudget,
      highestCategory: analytics.highestCategory?.category ?? null,
      momChange: analytics.momChange,
    },
    charts: {
      monthlyExpense: analytics.byMonth.map((m) => ({ month: m.month, total: m.expense })),
      incomeVsExpense: analytics.byMonth,
      categoryDonut: analytics.byCategory,
      paymentMethod: analytics.byPaymentMethod,
      monthlyCategory,
    },
    forecast,
    recent,
    currentMonth,
    settings,
  };
}

export async function gatherInsights(userId?: number, requestedMonth?: string) {
  const settings = await getSettings(userId);
  const txns = await getTransactions({ userId });
  const currentMonth = requestedMonth || normalizeMonthKey(new Date());
  const monthTxns = txns.filter(
    (t) => normalizeMonthKey(t.transactionDate) === currentMonth,
  );
  const thisMonthExpenses = monthTxns
    .filter((t) => t.transactionType === "Expense")
    .reduce((a, t) => a + Number(t.amount), 0);

  const prevMonth = addMonths(currentMonth, -1);
  const prevExpenses = txns
    .filter(
      (t) =>
        t.transactionType === "Expense" &&
        normalizeMonthKey(t.transactionDate) === prevMonth,
    )
    .reduce((a, t) => a + Number(t.amount), 0);

  const budget = await computeBudgetStatus(
    currentMonth,
    Object.fromEntries(
      monthTxns
        .filter((t) => t.transactionType === "Expense")
        .map((t) => [t.category, Number(t.amount)]),
    ),
    thisMonthExpenses,
    settings,
    userId,
  );
  const forecast = await getForecastStatus(userId);
  const forecastData =
    forecast.predictedExpense != null && forecast.targetMonth
      ? {
          targetMonth: forecast.targetMonth,
          predictedExpense: forecast.predictedExpense,
          status: forecast.predictionStatus ?? forecast.modelStatus,
          method: forecast.forecastingMethod ?? (forecast.hasModel ? "LSTM Deep Learning" : "Baseline"),
          mae: forecast.latestRun?.mae ?? null,
          rmse: forecast.latestRun?.rmse ?? null,
        }
      : null;

  const intelligent = generateIntelligentInsights({
    userId,
    selectedMonth: currentMonth,
    transactions: txns,
    budgetStatus: budget,
    forecast: forecastData,
    warningThreshold: settings.warningThreshold,
  });

  return {
    ...intelligent,
    // Preserve legacy fields for backward compatibility
    insights: intelligent.insights,
    summary: {
      currentMonth,
      expensesThisMonth: thisMonthExpenses,
      previousMonthExpenses: prevExpenses,
      budget,
      forecast: forecastData,
      anomalies: detectAnomalies(
        txns.filter((t) => t.transactionType === "Expense"),
      ),
    },
  };
}
