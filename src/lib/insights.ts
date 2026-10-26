import type { Transaction } from "./types";
import {
  expensesOnly,
  highestSpendingCategory,
  netCashFlow,
  savingsRate,
} from "./analytics";
import type { BudgetStatus } from "./budgetService";
import { formatCurrency, formatPercent } from "./format";
import { getDaysInMonth, getMonthName, normalizeMonthKey, addMonths } from "./config";

// ---------------------------------------------------------------------------
// Category Definitions (Essential vs Discretionary)
// ---------------------------------------------------------------------------

export const ESSENTIAL_CATEGORIES = new Set([
  "Housing",
  "Utilities",
  "Groceries",
  "Healthcare",
  "Education",
  "Transport",
]);

export const DISCRETIONARY_CATEGORIES = new Set([
  "Food",
  "Shopping",
  "Entertainment",
  "Subscriptions",
  "Travel",
  "Personal Care",
  "Other",
]);

export function isEssential(category: string): boolean {
  return ESSENTIAL_CATEGORIES.has(category);
}

export function isDiscretionary(category: string): boolean {
  return DISCRETIONARY_CATEGORIES.has(category);
}

// ---------------------------------------------------------------------------
// Intelligent Insight Data Contracts
// ---------------------------------------------------------------------------

export type InsightCategory =
  | "spending_behavior"
  | "budget_intelligence"
  | "anomaly"
  | "saving_opportunity"
  | "cash_flow"
  | "prediction";

export type InsightPriority = "high" | "medium" | "low";

export interface SupportingDataPoint {
  label: string;
  value: string;
  rawValue?: number;
}

export interface SmartInsight {
  id: string;
  category: InsightCategory;
  priority: InsightPriority;
  title: string;
  summary: string;
  whatHappened: string;
  financialData: SupportingDataPoint[];
  whyItMatters: string;
  suggestedAction: string;
  potentialImpact?: string;
  calculationMethod: string;
  coveredPeriod: string;
  relatedCategory?: string;
  relatedTransactionId?: number;
  actionLink?: { label: string; href: string };
  dismissible?: boolean;
}

export interface OverviewMetrics {
  currentMonth: string;
  currentMonthLabel: string;
  totalExpenses: number;
  totalIncome: number;
  netCashFlow: number;
  savingsRate: number | null;
  savingsRateLabel: string;
  previousMonthExpenses: number | null;
  momExpenseChange: number | null;
  momExpenseChangePct: number | null;
  overallBudget: number | null;
  budgetUtilization: number | null;
  budgetRemaining: number | null;
  projectedMonthEndExpense: number | null;
  projectedOverBudgetAmount: number | null;
  estimatedBudgetExhaustionDate: string | null;
  dailyBurnRate: number;
  daysInMonth: number;
  elapsedDays: number;
  discretionaryExpenses: number;
  essentialExpenses: number;
  discretionarySharePct: number;
}

export interface CategoryComparisonItem {
  category: string;
  currentAmount: number;
  previousAmount: number;
  diffAmount: number;
  diffPct: number | null;
  isEssential: boolean;
}

export interface InsightsChartData {
  categoryChanges: {
    category: string;
    current: number;
    previous: number;
  }[];
  budgetVsActual: {
    budget: number | null;
    actual: number;
    projected: number;
  };
  historicalTrend: {
    month: string;
    expense: number;
    income: number;
  }[];
  savingsOpportunities: {
    category: string;
    currentSpend: number;
    potentialMonthlySavings: number;
    potentialAnnualSavings: number;
  }[];
}

export interface IntelligentInsightsResult {
  metrics: OverviewMetrics;
  insights: SmartInsight[];
  chartData: InsightsChartData;
  summaryText: string;
}

// Legacy interfaces preserved for backward compatibility
export type InsightSeverity = "info" | "success" | "warning" | "danger";

export interface Insight {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
}

export interface InsightContext {
  selectedMonth?: string;
  transactions: Transaction[];
  allTransactions: Transaction[];
  totalExpensesMonth: number;
  previousMonthExpenses: number | null;
  budgetStatus?: Partial<BudgetStatus> | null;
  forecast?: { targetMonth: string; predictedExpense: number } | null;
  warningThreshold: number;
}

// ---------------------------------------------------------------------------
// Statistical Outlier Detection (Z-Score & IQR)
// ---------------------------------------------------------------------------

export interface AnomalyResult {
  anomalies: Transaction[];
  mean: number;
  std: number;
  iqr?: { q1: number; q3: number; iqrValue: number; threshold: number };
}

/**
 * Standard Z-Score outlier detection (preserved for backward compatibility with reports)
 */
export function detectAnomalies(
  allExpenses: Transaction[],
  zThreshold = 2,
  minSamples = 10,
): AnomalyResult {
  if (allExpenses.length < minSamples) {
    return { anomalies: [], mean: 0, std: 0 };
  }
  const amounts = allExpenses.map((t) => Number(t.amount) || 0);
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance =
    amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length;
  const std = Math.sqrt(variance);
  if (std === 0) return { anomalies: [], mean, std };
  const anomalies = allExpenses.filter(
    (t) => (Number(t.amount) - mean) / std > zThreshold,
  );
  return { anomalies, mean, std };
}

/**
 * Robust Interquartile Range (IQR) & Deviation Outlier Detection
 */
export function detectOutliersIQR(
  expenses: Transaction[],
  multiplier = 1.5,
  minSamples = 6,
): {
  outliers: {
    transaction: Transaction;
    zScore: number;
    iqrExcess: number;
    reason: string;
  }[];
  q1: number;
  q3: number;
  iqr: number;
  median: number;
  upperThreshold: number;
} {
  if (expenses.length < minSamples) {
    return { outliers: [], q1: 0, q3: 0, iqr: 0, median: 0, upperThreshold: 0 };
  }

  const sorted = [...expenses].sort((a, b) => Number(a.amount) - Number(b.amount));
  const amounts = sorted.map((t) => Number(t.amount) || 0);
  const n = amounts.length;

  const median =
    n % 2 === 0
      ? (amounts[n / 2 - 1] + amounts[n / 2]) / 2
      : amounts[Math.floor(n / 2)];

  const q1Index = Math.floor(n * 0.25);
  const q3Index = Math.floor(n * 0.75);
  const q1 = amounts[q1Index];
  const q3 = amounts[q3Index];
  const iqr = Math.max(0, q3 - q1);
  const upperThreshold = q3 + multiplier * iqr;

  // Also calculate mean and std for complementary Z-Score verification
  const mean = amounts.reduce((a, b) => a + b, 0) / n;
  const variance = amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);

  const outliers: {
    transaction: Transaction;
    zScore: number;
    iqrExcess: number;
    reason: string;
  }[] = [];

  for (const t of sorted) {
    const amt = Number(t.amount) || 0;
    const isIqrOutlier = amt > upperThreshold && amt > median * 1.5;
    const zScore = std > 0 ? (amt - mean) / std : 0;

    if (isIqrOutlier || zScore >= 2.0) {
      outliers.push({
        transaction: t,
        zScore: Math.round(zScore * 10) / 10,
        iqrExcess: Math.round((amt - upperThreshold) * 100) / 100,
        reason: `Transaction amount (${formatCurrency(amt)}) significantly exceeded the statistical spending bound (${formatCurrency(upperThreshold)}, Q3: ${formatCurrency(q3)}) by ${formatCurrency(amt - upperThreshold)} (Z-score: ${zScore.toFixed(1)}).`,
      });
    }
  }

  return { outliers, q1, q3, iqr, median, upperThreshold };
}

// ---------------------------------------------------------------------------
// Intelligent Personal Finance Analyst Engine
// ---------------------------------------------------------------------------

export interface AnalystInput {
  userId?: number;
  selectedMonth: string; // YYYY-MM
  referenceDate?: Date;
  transactions: Transaction[]; // all user personal transactions
  budgetStatus?: Partial<BudgetStatus> | null;
  forecast?: {
    targetMonth: string;
    predictedExpense: number;
    status?: string;
    method?: string;
    mae?: number | null;
    rmse?: number | null;
  } | null;
  warningThreshold?: number;
}

export function generateIntelligentInsights(
  input: AnalystInput,
): IntelligentInsightsResult {
  const {
    selectedMonth,
    referenceDate = new Date(),
    transactions,
    budgetStatus,
    forecast,
    warningThreshold = 80,
  } = input;

  const [selYear, selMonthNum] = selectedMonth.split("-").map(Number);
  const daysInMonth = getDaysInMonth(selYear, selMonthNum);

  // Determine elapsed days in the period:
  // If analyzing a past month, elapsedDays = daysInMonth.
  // If analyzing current month, elapsedDays = day of month (capped at daysInMonth).
  const currentCalendarMonth = normalizeMonthKey(referenceDate);
  const isCurrentMonth = selectedMonth === currentCalendarMonth;
  const isPastMonth = selectedMonth < currentCalendarMonth;

  let elapsedDays = daysInMonth;
  if (isCurrentMonth) {
    elapsedDays = Math.max(1, Math.min(daysInMonth, referenceDate.getDate()));
  } else if (!isPastMonth) {
    elapsedDays = 1;
  }

  const prevMonthKey = addMonths(selectedMonth, -1);
  const prevMonthLabel = `${getMonthName(Number(prevMonthKey.split("-")[1]))} ${prevMonthKey.split("-")[0]}`;
  const currentMonthLabel = `${getMonthName(selMonthNum)} ${selYear}`;

  // 1. Partition transactions for current and previous period
  const currentMonthTxns = transactions.filter(
    (t) => normalizeMonthKey(t.transactionDate) === selectedMonth,
  );
  const prevMonthTxns = transactions.filter(
    (t) => normalizeMonthKey(t.transactionDate) === prevMonthKey,
  );

  const curExpenses = expensesOnly(currentMonthTxns);
  const curIncomes = currentMonthTxns.filter((t) => t.transactionType === "Income");
  const prevExpenses = expensesOnly(prevMonthTxns);
  const prevIncomes = prevMonthTxns.filter((t) => t.transactionType === "Income");

  const totalExpenses = curExpenses.reduce((a, t) => a + Number(t.amount || 0), 0);
  const totalIncome = curIncomes.reduce((a, t) => a + Number(t.amount || 0), 0);
  const prevTotalExpenses = prevExpenses.reduce((a, t) => a + Number(t.amount || 0), 0);
  const prevTotalIncome = prevIncomes.reduce((a, t) => a + Number(t.amount || 0), 0);

  const netCash = totalIncome - totalExpenses;
  const rawSavingsRate = totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : null;
  const savingsRateVal = rawSavingsRate !== null ? Math.round(rawSavingsRate * 10) / 10 : null;
  const savingsRateLabel =
    savingsRateVal !== null
      ? `${savingsRateVal.toFixed(1)}%`
      : "Not available — no income recorded";

  const momExpenseChange =
    prevTotalExpenses > 0 ? Math.round((totalExpenses - prevTotalExpenses) * 100) / 100 : null;
  const momExpenseChangePct =
    prevTotalExpenses > 0
      ? Math.round(((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 1000) / 10
      : null;

  // Essential vs Discretionary
  let discretionaryExpenses = 0;
  let essentialExpenses = 0;
  for (const t of curExpenses) {
    const amt = Number(t.amount || 0);
    if (isEssential(t.category)) {
      essentialExpenses += amt;
    } else {
      discretionaryExpenses += amt;
    }
  }
  const discretionarySharePct =
    totalExpenses > 0
      ? Math.round((discretionaryExpenses / totalExpenses) * 1000) / 10
      : 0;

  // Daily Burn Rate and Projected Month-End Spending
  const dailyBurnRate =
    elapsedDays > 0 ? Math.round((totalExpenses / elapsedDays) * 100) / 100 : 0;
  const projectedMonthEndExpense = isCurrentMonth
    ? Math.round(dailyBurnRate * daysInMonth * 100) / 100
    : totalExpenses;

  // Budget Metrics & Exhaustion Calculation
  const overallBudget = budgetStatus?.overallBudget ?? null;
  let budgetUtilization: number | null = null;
  let budgetRemaining: number | null = null;
  let projectedOverBudgetAmount: number | null = null;
  let estimatedBudgetExhaustionDate: string | null = null;

  if (overallBudget !== null && overallBudget > 0) {
    budgetUtilization = Math.round((totalExpenses / overallBudget) * 1000) / 10;
    budgetRemaining = Math.round((overallBudget - totalExpenses) * 100) / 100;
    if (projectedMonthEndExpense > overallBudget) {
      projectedOverBudgetAmount = Math.round((projectedMonthEndExpense - overallBudget) * 100) / 100;
    }

    if (dailyBurnRate > 0 && budgetRemaining > 0 && isCurrentMonth) {
      const daysUntilExhaust = budgetRemaining / dailyBurnRate;
      const exhaustionDay = Math.floor(elapsedDays + daysUntilExhaust);
      if (exhaustionDay <= daysInMonth) {
        estimatedBudgetExhaustionDate = `${selectedMonth}-${String(exhaustionDay).padStart(2, "0")}`;
      }
    }
  }

  const metrics: OverviewMetrics = {
    currentMonth: selectedMonth,
    currentMonthLabel,
    totalExpenses,
    totalIncome,
    netCashFlow: netCash,
    savingsRate: savingsRateVal,
    savingsRateLabel,
    previousMonthExpenses: prevTotalExpenses > 0 ? prevTotalExpenses : null,
    momExpenseChange,
    momExpenseChangePct,
    overallBudget,
    budgetUtilization,
    budgetRemaining,
    projectedMonthEndExpense,
    projectedOverBudgetAmount,
    estimatedBudgetExhaustionDate,
    dailyBurnRate,
    daysInMonth,
    elapsedDays,
    discretionaryExpenses,
    essentialExpenses,
    discretionarySharePct,
  };

  const insights: SmartInsight[] = [];

  // =========================================================================
  // CATEGORY A: Spending Behavior Analysis
  // =========================================================================

  // 1. Highest spending category & concentration
  const catMap = new Map<string, number>();
  for (const t of curExpenses) {
    catMap.set(t.category, (catMap.get(t.category) ?? 0) + Number(t.amount || 0));
  }
  const prevCatMap = new Map<string, number>();
  for (const t of prevExpenses) {
    prevCatMap.set(t.category, (prevCatMap.get(t.category) ?? 0) + Number(t.amount || 0));
  }

  const sortedCats = [...catMap.entries()].sort((a, b) => b[1] - a[1]);

  if (sortedCats.length > 0 && totalExpenses > 0) {
    const [topCat, topAmt] = sortedCats[0];
    const topPct = Math.round((topAmt / totalExpenses) * 1000) / 10;
    const prevAmt = prevCatMap.get(topCat) ?? 0;
    const catDiff = topAmt - prevAmt;
    const catDiffPct = prevAmt > 0 ? Math.round((catDiff / prevAmt) * 1000) / 10 : null;

    const isHighConcentration = topPct >= 40;

    insights.push({
      id: "behavior-top-category",
      category: "spending_behavior",
      priority: isHighConcentration ? "high" : "medium",
      title: isHighConcentration
        ? `Heavy Spending Concentration in ${topCat} (${topPct.toFixed(1)}%)`
        : `Highest Spending Category: ${topCat} (${topPct.toFixed(1)}%)`,
      summary: `${topCat} is your single largest expenditure this month, consuming ${formatCurrency(topAmt)} (${topPct.toFixed(1)}% of your total spending).`,
      whatHappened: `You spent ${formatCurrency(topAmt)} across ${topCat} during ${currentMonthLabel}, which represents ${topPct.toFixed(1)}% of all expenditures. ${
        prevAmt > 0
          ? `Compared to ${prevMonthLabel} (${formatCurrency(prevAmt)}), spending ${catDiff >= 0 ? "increased" : "decreased"} by ${formatCurrency(Math.abs(catDiff))}${catDiffPct !== null ? ` (${catDiffPct >= 0 ? "+" : ""}${catDiffPct.toFixed(1)}%)` : ""}.`
          : "No expenses were recorded for this category in the prior month."
      }`,
      financialData: [
        { label: "Category Spent", value: formatCurrency(topAmt), rawValue: topAmt },
        { label: "Share of Expenses", value: `${topPct.toFixed(1)}%` },
        { label: "Prior Month", value: prevAmt > 0 ? formatCurrency(prevAmt) : "₹0" },
        { label: "Period Shift", value: prevAmt > 0 ? `${catDiff >= 0 ? "+" : ""}${formatCurrency(catDiff)}` : "New" },
      ],
      whyItMatters: isHighConcentration
        ? `Allocating over 40% of your total outlay to a single category creates severe financial concentration risk and limits your flexibility to handle emergencies.`
        : `Monitoring your primary expenditure category is essential because even modest optimizations here generate the largest absolute rupee savings.`,
      suggestedAction: `Review recent ${topCat} purchases to distinguish essential requirements from discretionary upgrades, and consider setting a category cap.`,
      potentialImpact: `A 10% reduction in ${topCat} spending would free up ${formatCurrency(topAmt * 0.1)} per month for personal savings or debt reduction.`,
      calculationMethod: `Category total (${formatCurrency(topAmt)}) ÷ Total month expenses (${formatCurrency(totalExpenses)}) × 100.`,
      coveredPeriod: currentMonthLabel,
      relatedCategory: topCat,
      actionLink: { label: "View Category Transactions", href: `/transactions?category=${encodeURIComponent(topCat)}` },
    });
  }

  // 2. Rapid Category Increases or Decreases (Surge & Drop detection)
  for (const [cat, curAmt] of sortedCats) {
    const prevAmt = prevCatMap.get(cat) ?? 0;
    if (prevAmt > 0) {
      const diff = curAmt - prevAmt;
      const diffPct = Math.round((diff / prevAmt) * 1000) / 10;

      // Significant Surge: > 25% increase and >= ₹750 absolute rise
      if (diffPct >= 25 && diff >= 750) {
        insights.push({
          id: `behavior-surge-${cat}`,
          category: "spending_behavior",
          priority: diff >= 2500 ? "high" : "medium",
          title: `Spending Surge in ${cat}: +${diffPct.toFixed(1)}%`,
          summary: `Expenditures in ${cat} rose rapidly by ${formatCurrency(diff)} (+${diffPct.toFixed(1)}%) compared to ${prevMonthLabel}.`,
          whatHappened: `Spending climbed from ${formatCurrency(prevAmt)} in ${prevMonthLabel} to ${formatCurrency(curAmt)} in ${currentMonthLabel}, marking an increase of ${formatCurrency(diff)}.`,
          financialData: [
            { label: "Current Spend", value: formatCurrency(curAmt), rawValue: curAmt },
            { label: "Previous Spend", value: formatCurrency(prevAmt), rawValue: prevAmt },
            { label: "Absolute Increase", value: `+${formatCurrency(diff)}` },
            { label: "Growth Rate", value: `+${diffPct.toFixed(1)}%` },
          ],
          whyItMatters: `Rapid spending increases often indicate lifestyle inflation or unplanned outlays that can destabilize monthly cash flows.`,
          suggestedAction: `Audit recent ${cat} receipts to determine whether this spike represents a temporary one-off expense or a permanent cost increase.`,
          potentialImpact: `Returning spending to the ${prevMonthLabel} baseline would yield ${formatCurrency(diff)} in monthly savings.`,
          calculationMethod: `(Current ${formatCurrency(curAmt)} − Previous ${formatCurrency(prevAmt)}) ÷ Previous ${formatCurrency(prevAmt)} × 100.`,
          coveredPeriod: `${prevMonthLabel} vs ${currentMonthLabel}`,
          relatedCategory: cat,
          actionLink: { label: "Inspect Category", href: `/transactions?category=${encodeURIComponent(cat)}` },
        });
      }

      // Notable Reduction: <= -20% and >= ₹600 saved
      if (diffPct <= -20 && Math.abs(diff) >= 600) {
        insights.push({
          id: `behavior-drop-${cat}`,
          category: "spending_behavior",
          priority: "low",
          title: `Effective Spending Reduction in ${cat}: ${diffPct.toFixed(1)}%`,
          summary: `You successfully decreased ${cat} spending by ${formatCurrency(Math.abs(diff))} compared to ${prevMonthLabel}.`,
          whatHappened: `Expenditures dropped from ${formatCurrency(prevAmt)} in ${prevMonthLabel} down to ${formatCurrency(curAmt)} in ${currentMonthLabel}, saving ${formatCurrency(Math.abs(diff))}.`,
          financialData: [
            { label: "Current Spend", value: formatCurrency(curAmt), rawValue: curAmt },
            { label: "Previous Spend", value: formatCurrency(prevAmt), rawValue: prevAmt },
            { label: "Amount Saved", value: formatCurrency(Math.abs(diff)) },
            { label: "Percentage Reduction", value: `${diffPct.toFixed(1)}%` },
          ],
          whyItMatters: `Disciplined spending cuts directly widen your monthly net cash flow and accelerate personal savings targets.`,
          suggestedAction: `Maintain the habits and vendor choices that enabled this reduction into the upcoming month.`,
          potentialImpact: `Continuing this disciplined pace will preserve ${formatCurrency(Math.abs(diff) * 12)} in cumulative annual savings.`,
          calculationMethod: `(Current ${formatCurrency(curAmt)} − Previous ${formatCurrency(prevAmt)}) ÷ Previous ${formatCurrency(prevAmt)} × 100.`,
          coveredPeriod: `${prevMonthLabel} vs ${currentMonthLabel}`,
          relatedCategory: cat,
        });
      }
    }
  }

  // 3. Frequent Small Purchases ("Latte Factor / Micro-Spending Bleed")
  const smallTxns = curExpenses.filter((t) => Number(t.amount || 0) <= 450);
  const smallTotal = smallTxns.reduce((a, t) => a + Number(t.amount || 0), 0);
  const smallCount = smallTxns.length;

  if (smallCount >= 4 && smallTotal >= 1200) {
    const smallShare = totalExpenses > 0 ? (smallTotal / totalExpenses) * 100 : 0;
    insights.push({
      id: "behavior-micro-spending",
      category: "spending_behavior",
      priority: smallShare >= 15 ? "high" : "medium",
      title: `Frequent Micro-Purchases Totaling ${formatCurrency(smallTotal)}`,
      summary: `You made ${smallCount} small transactions (≤ ₹450 each) that collectively accumulated to ${formatCurrency(smallTotal)} (${smallShare.toFixed(1)}% of your expenses).`,
      whatHappened: `Multiple minor outlays across snacks, coffee, quick deliveries, or transit added up to a significant financial sum of ${formatCurrency(smallTotal)} across ${smallCount} purchases.`,
      financialData: [
        { label: "Small Txn Count", value: `${smallCount} transactions` },
        { label: "Cumulative Total", value: formatCurrency(smallTotal), rawValue: smallTotal },
        { label: "Share of Total Outlay", value: `${smallShare.toFixed(1)}%` },
        { label: "Average Small Txn", value: formatCurrency(smallTotal / smallCount) },
      ],
      whyItMatters: `Frequent small transactions are easily overlooked because individual charges appear negligible, yet they quietly drain substantial cash flow over time.`,
      suggestedAction: `Consolidate orders, prepare daily snacks in advance, or establish a weekly cash wallet limit for incidental purchases.`,
      potentialImpact: `Trimming 30% of these discretionary micro-transactions would generate ${formatCurrency(smallTotal * 0.3)} in monthly savings (${formatCurrency(smallTotal * 0.3 * 12)} annually).`,
      calculationMethod: `Sum of expense transactions with amount ≤ ₹450 across ${currentMonthLabel}.`,
      coveredPeriod: currentMonthLabel,
    });
  }

  // 4. Discretionary vs Essential Breakdown
  if (totalExpenses > 0) {
    if (discretionarySharePct >= 35) {
      insights.push({
        id: "behavior-discretionary-ratio",
        category: "spending_behavior",
        priority: discretionarySharePct >= 50 ? "high" : "medium",
        title: `High Discretionary Spending Ratio (${discretionarySharePct.toFixed(1)}%)`,
        summary: `Discretionary categories (Food, Shopping, Entertainment, etc.) represent ${discretionarySharePct.toFixed(1)}% (${formatCurrency(discretionaryExpenses)}) of your monthly expenses.`,
        whatHappened: `You spent ${formatCurrency(discretionaryExpenses)} on non-essential lifestyle purchases versus ${formatCurrency(essentialExpenses)} on essential obligations (Housing, Utilities, Groceries).`,
        financialData: [
          { label: "Discretionary Total", value: formatCurrency(discretionaryExpenses), rawValue: discretionaryExpenses },
          { label: "Essential Total", value: formatCurrency(essentialExpenses), rawValue: essentialExpenses },
          { label: "Discretionary Ratio", value: `${discretionarySharePct.toFixed(1)}%` },
          { label: "Essential Ratio", value: `${(100 - discretionarySharePct).toFixed(1)}%` },
        ],
        whyItMatters: `Financial planning guidelines recommend keeping discretionary spending under 30% of expenses to ensure adequate headroom for savings and debt buffers.`,
        suggestedAction: `Target non-essential dining and shopping purchases for reduction before altering core lifestyle commitments.`,
        potentialImpact: `Restricting discretionary spending to 25% of total expenses would yield ${formatCurrency(Math.max(0, discretionaryExpenses - totalExpenses * 0.25))} in monthly savings.`,
        calculationMethod: `Discretionary sum (${formatCurrency(discretionaryExpenses)}) ÷ Total expenses (${formatCurrency(totalExpenses)}) × 100.`,
        coveredPeriod: currentMonthLabel,
      });
    }
  }

  // =========================================================================
  // CATEGORY B: Budget Intelligence
  // =========================================================================

  if (overallBudget !== null && overallBudget > 0) {
    // 1. Budget Exceeded
    if (totalExpenses > overallBudget) {
      const excess = Math.round((totalExpenses - overallBudget) * 100) / 100;
      insights.push({
        id: "budget-exceeded-critical",
        category: "budget_intelligence",
        priority: "high",
        title: `Overall Monthly Budget Exceeded by ${formatCurrency(excess)}`,
        summary: `Actual spending of ${formatCurrency(totalExpenses)} has exceeded your configured monthly budget of ${formatCurrency(overallBudget)} by ${formatCurrency(excess)} (${budgetUtilization?.toFixed(1)}% utilized).`,
        whatHappened: `You have crossed your financial target with ${daysInMonth - elapsedDays} day(s) remaining in ${currentMonthLabel}.`,
        financialData: [
          { label: "Monthly Budget", value: formatCurrency(overallBudget), rawValue: overallBudget },
          { label: "Actual Spend", value: formatCurrency(totalExpenses), rawValue: totalExpenses },
          { label: "Over-Budget Amount", value: formatCurrency(excess) },
          { label: "Utilization Rate", value: `${budgetUtilization?.toFixed(1)}%` },
        ],
        whyItMatters: `Running an ongoing budget deficit reduces liquid savings and forces reliance on credit card balances or borrowing.`,
        suggestedAction: `Freeze non-essential purchases for the remainder of ${currentMonthLabel} and review whether the monthly budget requires realistic adjustment.`,
        potentialImpact: `A revised budget of ${formatCurrency(Math.round(totalExpenses * 1.05))} would reflect realistic expenses while enforcing spending controls.`,
        calculationMethod: `Actual expense (${formatCurrency(totalExpenses)}) − Configured budget (${formatCurrency(overallBudget)}).`,
        coveredPeriod: currentMonthLabel,
        actionLink: { label: "Manage Budgets", href: "/budgets" },
      });
    }
    // 2. Budget Burn-Rate Alert: Early Exhaustion Projected
    else if (
      isCurrentMonth &&
      projectedOverBudgetAmount !== null &&
      projectedOverBudgetAmount > 0 &&
      estimatedBudgetExhaustionDate
    ) {
      insights.push({
        id: "budget-burnrate-warning",
        category: "budget_intelligence",
        priority: "high",
        title: `Budget Pace Warning: Exhaustion Projected by ${estimatedBudgetExhaustionDate}`,
        summary: `At your current burn rate of ${formatCurrency(dailyBurnRate)}/day, your remaining budget (${formatCurrency(budgetRemaining ?? 0)}) is projected to run out on ${estimatedBudgetExhaustionDate}.`,
        whatHappened: `Over the first ${elapsedDays} day(s) of ${currentMonthLabel}, you have spent ${formatCurrency(totalExpenses)} (${budgetUtilization?.toFixed(1)}% of budget). Continuing this pace will result in month-end spending of ${formatCurrency(projectedMonthEndExpense)}, exceeding budget by ${formatCurrency(projectedOverBudgetAmount)}.`,
        financialData: [
          { label: "Daily Burn Rate", value: `${formatCurrency(dailyBurnRate)}/day` },
          { label: "Remaining Budget", value: formatCurrency(budgetRemaining ?? 0) },
          { label: "Projected Month-End", value: formatCurrency(projectedMonthEndExpense) },
          { label: "Exhaustion Date", value: estimatedBudgetExhaustionDate },
        ],
        whyItMatters: `Identifying spending velocity early in the month provides an opportunity to course-correct before deficits actually occur.`,
        suggestedAction: `Limit your daily spending pace to ${formatCurrency(Math.max(0, (budgetRemaining ?? 0) / Math.max(1, daysInMonth - elapsedDays)))}/day for the remaining ${daysInMonth - elapsedDays} days to stay within target.`,
        potentialImpact: `Pacing daily expenditures prevents a projected budget overshoot of ${formatCurrency(projectedOverBudgetAmount)}.`,
        calculationMethod: `Daily pace (${formatCurrency(dailyBurnRate)}) × ${daysInMonth} days = ${formatCurrency(projectedMonthEndExpense)} projected outlay.`,
        coveredPeriod: currentMonthLabel,
        actionLink: { label: "View Budget Details", href: "/budgets" },
      });
    }
    // 3. Approaching Budget Warning (Near Limit)
    else if ((budgetUtilization ?? 0) >= warningThreshold) {
      insights.push({
        id: "budget-near-limit",
        category: "budget_intelligence",
        priority: "medium",
        title: `Budget Approaching Limit: ${budgetUtilization?.toFixed(1)}% Consumed`,
        summary: `You have utilized ${budgetUtilization?.toFixed(1)}% of your monthly budget, with ${formatCurrency(budgetRemaining ?? 0)} remaining for the rest of the period.`,
        whatHappened: `Expenditures have reached the ${warningThreshold}% warning threshold. You have ${formatCurrency(budgetRemaining ?? 0)} remaining across the remaining ${Math.max(0, daysInMonth - elapsedDays)} day(s).`,
        financialData: [
          { label: "Monthly Budget", value: formatCurrency(overallBudget) },
          { label: "Utilized", value: `${budgetUtilization?.toFixed(1)}%` },
          { label: "Remaining Balance", value: formatCurrency(budgetRemaining ?? 0) },
          { label: "Allowed Daily Pace", value: `${formatCurrency(Math.max(0, (budgetRemaining ?? 0) / Math.max(1, daysInMonth - elapsedDays)))}/day` },
        ],
        whyItMatters: `Reaching the threshold early leaves little financial buffer for unforeseen expenses before the next pay cycle.`,
        suggestedAction: `Defer discretionary online purchases and restaurant visits until the upcoming month.`,
        potentialImpact: `Adhering to the remaining balance prevents unexpected overdrafts or debt accumulation.`,
        calculationMethod: `Actual spent (${formatCurrency(totalExpenses)}) ÷ Budget (${formatCurrency(overallBudget)}) × 100.`,
        coveredPeriod: currentMonthLabel,
        actionLink: { label: "Adjust Budget", href: "/budgets" },
      });
    }
  } else if (totalExpenses > 0) {
    // No budget configured
    insights.push({
      id: "budget-unconfigured",
      category: "budget_intelligence",
      priority: "medium",
      title: "No Budget Configured for this Period",
      summary: `You have recorded ${formatCurrency(totalExpenses)} in expenses without a benchmark budget target.`,
      whatHappened: `Setting a budget establishes a clear spending boundary to prevent lifestyle creep and track financial discipline.`,
      financialData: [
        { label: "Recorded Expenses", value: formatCurrency(totalExpenses) },
        { label: "Target Status", value: "Unconfigured" },
        { label: "Recommended Initial Budget", value: formatCurrency(Math.round(totalExpenses * 1.1)) },
      ],
      whyItMatters: `Without a budget, tracking financial discipline relies purely on backward-looking analysis rather than proactive control.`,
      suggestedAction: `Set an initial monthly budget of approximately ${formatCurrency(Math.round(totalExpenses * 1.1))} in Budget Management.`,
      potentialImpact: `Setting a budget and monitoring progress typically reduces non-essential leakage by 10%–15%.`,
      calculationMethod: "Evaluated from app_settings and user budget table.",
      coveredPeriod: currentMonthLabel,
      actionLink: { label: "Create a Budget", href: "/budgets" },
    });
  }

  // =========================================================================
  // CATEGORY C: Anomaly and Unusual Transaction Detection
  // =========================================================================

  const allUserExpenses = expensesOnly(transactions);
  const outlierReport = detectOutliersIQR(allUserExpenses, 1.5, 6);

  // Filter outliers that occurred in the selected reporting period
  const periodOutliers = outlierReport.outliers.filter(
    (o) => normalizeMonthKey(o.transaction.transactionDate) === selectedMonth,
  );

  if (periodOutliers.length > 0) {
    for (const o of periodOutliers.slice(0, 3)) {
      const t = o.transaction;
      const amt = Number(t.amount || 0);
      insights.push({
        id: `anomaly-txn-${t.id}`,
        category: "anomaly",
        priority: amt >= 5000 || o.zScore >= 2.5 ? "high" : "medium",
        title: `Spending Anomaly: ${formatCurrency(amt)} (${t.category})`,
        summary: `A payment of ${formatCurrency(amt)} on ${t.transactionDate} significantly deviated from your typical spending pattern.`,
        whatHappened: `On ${t.transactionDate}, an expense of ${formatCurrency(amt)} for &ldquo;${t.description || t.category}&rdquo; was flagged because it exceeded your upper statistical bound (${formatCurrency(outlierReport.upperThreshold)}, IQR: ${formatCurrency(outlierReport.iqr)}).`,
        financialData: [
          { label: "Flagged Amount", value: formatCurrency(amt), rawValue: amt },
          { label: "Transaction Date", value: t.transactionDate },
          { label: "Historical Median", value: formatCurrency(outlierReport.median) },
          { label: "Upper IQR Bound", value: formatCurrency(outlierReport.upperThreshold) },
          { label: "Z-Score", value: `${o.zScore.toFixed(1)}σ` },
        ],
        whyItMatters: `Anomalous transactions often represent forgotten renewals, accidental duplicate charges, or one-time big-ticket items that distort monthly trendlines.`,
        suggestedAction: `Verify this transaction in your bank/card statement. If planned, note it as an extraordinary expense; if accidental, seek a refund from the vendor.`,
        potentialImpact: `Confirming legitimacy prevents duplicate payment errors and maintains accurate budget baselines.`,
        calculationMethod: `IQR outlier rule: Amount (${formatCurrency(amt)}) > Q3 (${formatCurrency(outlierReport.q3)}) + 1.5 × IQR (${formatCurrency(outlierReport.iqr)}).`,
        coveredPeriod: t.transactionDate,
        relatedCategory: t.category,
        relatedTransactionId: t.id,
        actionLink: { label: "Review Transaction", href: `/transactions?search=${encodeURIComponent(t.description || t.category)}` },
        dismissible: true,
      });
    }
  }

  // =========================================================================
  // CATEGORY D: Saving Opportunities
  // =========================================================================

  // Evaluate discretionary categories with meaningful totals
  const discretionaryCandidates = sortedCats.filter(
    ([cat, amt]) => isDiscretionary(cat) && amt >= 1000,
  );

  if (discretionaryCandidates.length > 0) {
    const [bestDiscCat, bestDiscAmt] = discretionaryCandidates[0];
    const target15 = Math.round(bestDiscAmt * 0.15);
    const target20 = Math.round(bestDiscAmt * 0.2);

    insights.push({
      id: `saving-opportunity-${bestDiscCat}`,
      category: "saving_opportunity",
      priority: "medium",
      title: `Potential Savings in ${bestDiscCat}: Up to ${formatCurrency(target20)}/month`,
      summary: `You spent ${formatCurrency(bestDiscAmt)} in ${bestDiscCat} this month. Trimming discretionary purchases by 15%–20% could yield ${formatCurrency(target15)} to ${formatCurrency(target20)} in monthly savings.`,
      whatHappened: `Discretionary purchases in ${bestDiscCat} accounted for ${formatCurrency(bestDiscAmt)} (${totalExpenses > 0 ? ((bestDiscAmt / totalExpenses) * 100).toFixed(1) : 0}% of your total outlays).`,
      financialData: [
        { label: "Current Spend", value: formatCurrency(bestDiscAmt), rawValue: bestDiscAmt },
        { label: "15% Target Savings", value: `${formatCurrency(target15)}/mo` },
        { label: "20% Target Savings", value: `${formatCurrency(target20)}/mo` },
        { label: "Projected Annual Benefit", value: `${formatCurrency(target15 * 12)} – ${formatCurrency(target20 * 12)}/yr` },
      ],
      whyItMatters: `Discretionary categories are the easiest and most flexible area to generate surplus cash flow without affecting essential living standards.`,
      suggestedAction: `Review dining or retail purchases in ${bestDiscCat} and set a weekly cap to capture this target.`,
      potentialImpact: `Capturing a 15% reduction would compound to ${formatCurrency(target15 * 12)} in verified annual wealth accumulation.`,
      calculationMethod: `Scenario analysis: 15% and 20% haircut applied strictly to discretionary category total (${formatCurrency(bestDiscAmt)}).`,
      coveredPeriod: currentMonthLabel,
      relatedCategory: bestDiscCat,
      actionLink: { label: "Review Purchases", href: `/transactions?category=${encodeURIComponent(bestDiscCat)}` },
    });
  }

  // =========================================================================
  // CATEGORY E: Income, Cash Flow, and Financial Health
  // =========================================================================

  if (totalIncome > 0 && totalExpenses > 0) {
    // 1. Cash flow deficit (Expenses > Income)
    if (totalExpenses > totalIncome) {
      const deficit = totalExpenses - totalIncome;
      insights.push({
        id: "cashflow-deficit",
        category: "cash_flow",
        priority: "high",
        title: `Cash Flow Deficit: Expenses Exceeded Income by ${formatCurrency(deficit)}`,
        summary: `Your outlays of ${formatCurrency(totalExpenses)} exceeded recorded income of ${formatCurrency(totalIncome)}, resulting in a negative net cash flow of ${formatCurrency(deficit)}.`,
        whatHappened: `In ${currentMonthLabel}, spending outpaced incoming revenue by ${formatCurrency(deficit)}, causing a negative savings rate of ${savingsRateLabel}.`,
        financialData: [
          { label: "Recorded Income", value: formatCurrency(totalIncome), rawValue: totalIncome },
          { label: "Recorded Expenses", value: formatCurrency(totalExpenses), rawValue: totalExpenses },
          { label: "Net Period Deficit", value: `−${formatCurrency(deficit)}` },
          { label: "Savings Rate", value: savingsRateLabel },
        ],
        whyItMatters: `A negative net cash flow erodes existing bank reserves and forces reliance on debt instruments.`,
        suggestedAction: `Immediately postpone non-essential discretionary expenditures until the upcoming income deposit occurs.`,
        potentialImpact: `Rebalancing outlays to match income eliminates cash flow drawdowns and protects emergency savings.`,
        calculationMethod: `Total income (${formatCurrency(totalIncome)}) − Total expenses (${formatCurrency(totalExpenses)}).`,
        coveredPeriod: currentMonthLabel,
      });
    }
    // 2. Strong Positive Cash Flow & Savings Health
    else if (savingsRateVal !== null && savingsRateVal >= 25) {
      insights.push({
        id: "cashflow-strong-savings",
        category: "cash_flow",
        priority: "low",
        title: `Healthy Savings Rate of ${savingsRateLabel}`,
        summary: `You retained ${formatCurrency(netCash)} of your ${formatCurrency(totalIncome)} income this period, achieving a robust savings rate of ${savingsRateLabel}.`,
        whatHappened: `Net cash flow remained firmly positive at ${formatCurrency(netCash)}, well above the recommended 20% minimum savings benchmark.`,
        financialData: [
          { label: "Recorded Income", value: formatCurrency(totalIncome) },
          { label: "Recorded Expenses", value: formatCurrency(totalExpenses) },
          { label: "Net Savings", value: formatCurrency(netCash) },
          { label: "Savings Rate", value: savingsRateLabel },
        ],
        whyItMatters: `Maintaining a savings rate above 20% provides strong protection against unexpected financial shocks and accelerates long-term goals.`,
        suggestedAction: `Consider moving this surplus ${formatCurrency(netCash)} into a dedicated savings or investment account to prevent passive end-of-month spending.`,
        potentialImpact: `Sustaining this savings trajectory accumulates ${formatCurrency(netCash * 12)} in annual capital reserves.`,
        calculationMethod: `Net savings (${formatCurrency(netCash)}) ÷ Total income (${formatCurrency(totalIncome)}) × 100.`,
        coveredPeriod: currentMonthLabel,
      });
    }
  }

  // =========================================================================
  // CATEGORY F: Deep Learning Prediction Insights
  // =========================================================================

  if (forecast && forecast.predictedExpense !== null && forecast.predictedExpense > 0) {
    const predAmt = forecast.predictedExpense;
    const targetLabel = `${getMonthName(Number(forecast.targetMonth.split("-")[1]))} ${forecast.targetMonth.split("-")[0]}`;

    // Compare with overall budget
    if (overallBudget !== null && overallBudget > 0 && predAmt > overallBudget) {
      const shortfall = Math.round((predAmt - overallBudget) * 100) / 100;
      insights.push({
        id: "prediction-shortfall",
        category: "prediction",
        priority: "high",
        title: `Forecast Warning: Projected Overspending for ${targetLabel}`,
        summary: `The LSTM deep learning model forecasts next-month expenditures of ${formatCurrency(predAmt)}, which exceeds your monthly budget (${formatCurrency(overallBudget)}) by ${formatCurrency(shortfall)}.`,
        whatHappened: `Based on your recent time-series patterns, the model projects ${formatCurrency(predAmt)} in expenditures for ${targetLabel}.`,
        financialData: [
          { label: "Predicted Expense", value: formatCurrency(predAmt), rawValue: predAmt },
          { label: "Configured Budget", value: formatCurrency(overallBudget) },
          { label: "Projected Shortfall", value: formatCurrency(shortfall) },
          { label: "Model MAE", value: forecast.mae != null ? formatCurrency(forecast.mae) : "Evaluated" },
        ],
        whyItMatters: `Predictive models detect upward momentum in your time series before the billing period begins, allowing you to prevent budget overruns proactively.`,
        suggestedAction: `Plan upcoming recurring payments and schedule discretionary shopping around the forecasted peak.`,
        potentialImpact: `Proactively capping commitments before ${targetLabel} begins prevents an estimated budget overrun of ${formatCurrency(shortfall)}.`,
        calculationMethod: `LSTM time-series inference output (${formatCurrency(predAmt)}) − Current budget (${formatCurrency(overallBudget)}).`,
        coveredPeriod: `Forecast for ${targetLabel}`,
        actionLink: { label: "View ML Prediction", href: "/prediction" },
      });
    } else {
      const expDiff = totalExpenses > 0 ? predAmt - totalExpenses : 0;
      insights.push({
        id: "prediction-baseline-trajectory",
        category: "prediction",
        priority: "medium",
        title: `Next-Month Forecast: ${formatCurrency(predAmt)} for ${targetLabel}`,
        summary: `The neural forecasting model projects next-month spending of ${formatCurrency(predAmt)} (${expDiff >= 0 ? "+" : ""}${formatCurrency(expDiff)} vs this month).`,
        whatHappened: `The model evaluated your historical expenditure series and projects ${formatCurrency(predAmt)} for ${targetLabel}.`,
        financialData: [
          { label: "Forecast Amount", value: formatCurrency(predAmt), rawValue: predAmt },
          { label: "Current Month Spend", value: formatCurrency(totalExpenses) },
          { label: "Projected Delta", value: `${expDiff >= 0 ? "+" : ""}${formatCurrency(expDiff)}` },
          { label: "Forecasting Method", value: forecast.method ?? "LSTM Deep Learning" },
        ],
        whyItMatters: `Anticipating the next month's outflow enables proactive liquidity planning and smoother monthly budgeting.`,
        suggestedAction: `Ensure your anticipated income deposits cover this projected baseline with adequate savings margin.`,
        potentialImpact: `Aligning upcoming income with predicted spending avoids emergency borrowing or overdraft fees.`,
        calculationMethod: `Trained LSTM recurrent neural network projection (${forecast.method ?? "LSTM"}).`,
        coveredPeriod: `Forecast for ${targetLabel}`,
        actionLink: { label: "Explore Forecasting", href: "/prediction" },
      });
    }
  }

  // =========================================================================
  // CATEGORY G: Fallback when history is sparse
  // =========================================================================

  if (insights.length === 0) {
    if (totalExpenses === 0 && totalIncome === 0) {
      insights.push({
        id: "empty-state-welcome",
        category: "spending_behavior",
        priority: "low",
        title: "No Transactions Recorded for this Period",
        summary: `No income or expense records were found for ${currentMonthLabel}.`,
        whatHappened: "Your financial ledger is currently empty for the selected reporting month.",
        financialData: [
          { label: "Expenses", value: "₹0" },
          { label: "Income", value: "₹0" },
          { label: "Status", value: "Awaiting Records" },
        ],
        whyItMatters: "The intelligent analyst requires recorded transactions to identify patterns, evaluate budgets, and generate savings opportunities.",
        suggestedAction: "Add your everyday expenses or import a bank statement CSV in the Transactions module.",
        calculationMethod: "Transaction ledger inspection.",
        coveredPeriod: currentMonthLabel,
        actionLink: { label: "Add Transactions", href: "/transactions" },
      });
    } else {
      insights.push({
        id: "sparse-history-notice",
        category: "spending_behavior",
        priority: "low",
        title: "Accumulating Financial History",
        summary: `Your spending in ${currentMonthLabel} (${formatCurrency(totalExpenses)}) is steady with no major anomalies detected.`,
        whatHappened: "Current transactions show normal spending without exceeding statistical thresholds.",
        financialData: [
          { label: "Current Expenses", value: formatCurrency(totalExpenses) },
          { label: "Categories Active", value: `${sortedCats.length}` },
        ],
        whyItMatters: "Consistent, steady spending without sudden spikes reflects controlled financial discipline.",
        suggestedAction: "Continue logging transactions and maintain your current spending pace.",
        calculationMethod: "Baseline spending pattern evaluation.",
        coveredPeriod: currentMonthLabel,
      });
    }
  }

  // =========================================================================
  // Intelligent Ranking
  // =========================================================================

  const priorityScore: Record<InsightPriority, number> = {
    high: 100,
    medium: 60,
    low: 20,
  };

  insights.sort((a, b) => {
    const pScore = priorityScore[b.priority] - priorityScore[a.priority];
    if (pScore !== 0) return pScore;
    // Tiebreaker: Financial amount or presence of actionable impact
    const aImpact = a.financialData[0]?.rawValue ?? 0;
    const bImpact = b.financialData[0]?.rawValue ?? 0;
    return bImpact - aImpact;
  });

  // =========================================================================
  // Visual Chart Data
  // =========================================================================

  const categoryChanges = sortedCats.slice(0, 6).map(([cat, cur]) => ({
    category: cat,
    current: cur,
    previous: prevCatMap.get(cat) ?? 0,
  }));

  // Historical trend (last 6 months)
  const monthExpenseMap = new Map<string, { expense: number; income: number }>();
  for (const t of transactions) {
    const m = normalizeMonthKey(t.transactionDate);
    const existing = monthExpenseMap.get(m) ?? { expense: 0, income: 0 };
    if (t.transactionType === "Expense") existing.expense += Number(t.amount || 0);
    else existing.income += Number(t.amount || 0);
    monthExpenseMap.set(m, existing);
  }

  const historicalTrend = [...monthExpenseMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([m, data]) => ({
      month: m,
      expense: Math.round(data.expense * 100) / 100,
      income: Math.round(data.income * 100) / 100,
    }));

  const savingsOpportunities = discretionaryCandidates.slice(0, 4).map(([cat, amt]) => ({
    category: cat,
    currentSpend: amt,
    potentialMonthlySavings: Math.round(amt * 0.15),
    potentialAnnualSavings: Math.round(amt * 0.15 * 12),
  }));

  const chartData: InsightsChartData = {
    categoryChanges,
    budgetVsActual: {
      budget: overallBudget,
      actual: totalExpenses,
      projected: projectedMonthEndExpense,
    },
    historicalTrend,
    savingsOpportunities,
  };

  const highPriorityCount = insights.filter((i) => i.priority === "high").length;
  let summaryText = "";
  if (highPriorityCount > 0) {
    summaryText = `Found ${highPriorityCount} critical financial alert${highPriorityCount === 1 ? "" : "s"} requiring your immediate attention.`;
  } else if (insights.length > 0) {
    summaryText = `Identified ${insights.length} data-driven observations and savings opportunities across your accounts.`;
  } else {
    summaryText = "Financial activity is stable with no immediate risks detected.";
  }

  return {
    metrics,
    insights,
    chartData,
    summaryText,
  };
}

// ---------------------------------------------------------------------------
// Legacy Compatibility Wrapper (Preserved for existing report integration)
// ---------------------------------------------------------------------------

export function buildInsights(ctx: InsightContext): Insight[] {
  const intelligent = generateIntelligentInsights({
    selectedMonth: ctx.selectedMonth ?? normalizeMonthKey(new Date()),
    transactions: ctx.allTransactions,
    budgetStatus: ctx.budgetStatus,
    forecast: ctx.forecast,
    warningThreshold: ctx.warningThreshold,
  });

  return intelligent.insights.map((ins) => ({
    id: ins.id,
    severity:
      ins.priority === "high"
        ? "danger"
        : ins.priority === "medium"
        ? "warning"
        : "info",
    title: ins.title,
    detail: `${ins.summary} ${ins.suggestedAction}`,
  }));
}
