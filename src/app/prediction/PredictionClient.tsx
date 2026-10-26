"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiPost } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  KpiCard,
  PageHeader,
  Spinner,
} from "@/components/ui";
import PlotlyChart from "@/components/PlotlyChart";
import type {
  PersonalizedForecast,
  MultiHorizonForecastResult,
  CategoryForecastSummary,
  GranularAnalysis,
  PredictionExplainability,
  ScenarioSimulationResult,
  PredictionHistorySummary,
  ForecastHorizon,
} from "@/ml/pipeline";

interface EvalData {
  targetMonth: string;
  nextForecast: number;
  evaluation: {
    actual: number[];
    predicted: number[];
    metrics: { mae: number; rmse: number; mape: number | null; wape?: number | null };
  };
  baselines: { name: string; predictions: number[]; metrics: any }[];
  history: { loss: number[]; valLoss: number[] };
  trainMonths: number;
  valMonths: number;
  testMonths: number;
  modelVersion: string;
}

interface Status {
  hasModel: boolean;
  modelStatus: "untrained" | "training" | "trained" | "error";
  modelVersion: string | null;
  targetMonth: string | null;
  predictedExpense: number | null;
  predictionStatus?: string;
  forecastingMethod?: string;
  explanation?: string;
  datasetMode: string | null;
  datasetSource: string | null;
  dataStartDate: string | null;
  dataEndDate: string | null;
  lastTrainedAt: string | null;
  latestRun: any;
  meta: any;
  evaluation: EvalData | null;
  personalized?: PersonalizedForecast;
}

interface FullPredictionData {
  personalized: PersonalizedForecast;
  multiHorizon: MultiHorizonForecastResult;
  categories: CategoryForecastSummary;
  granular: GranularAnalysis;
  explainability: PredictionExplainability;
  history: PredictionHistorySummary;
}

export default function PredictionClient({
  user,
}: {
  user?: { id: number; name: string; email: string };
}) {
  const fmt = useFormat();
  const [activeTab, setActiveTab] = useState<
    "overview" | "categories" | "granular" | "explain" | "simulator" | "history"
  >("overview");
  const [selectedHorizon, setSelectedHorizon] = useState<ForecastHorizon>("30d");

  const [status, setStatus] = useState<Status | null>(null);
  const [fullData, setFullData] = useState<FullPredictionData | null>(null);
  const [horizonData, setHorizonData] = useState<MultiHorizonForecastResult | null>(null);

  const [loading, setLoading] = useState(true);
  const [horizonLoading, setHorizonLoading] = useState(false);
  const [training, setTraining] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // What-If Simulator state
  const [categoryAdjustments, setCategoryAdjustments] = useState<Record<string, number>>({});
  const [oneOffExpenses, setOneOffExpenses] = useState<
    { name: string; amount: number; category: string }[]
  >([]);
  const [newOneOffName, setNewOneOffName] = useState("");
  const [newOneOffAmount, setNewOneOffAmount] = useState("");
  const [newOneOffCategory, setNewOneOffCategory] = useState("");
  const [simulationResult, setSimulationResult] = useState<ScenarioSimulationResult | null>(null);
  const [simulating, setSimulating] = useState(false);

  // Initial data loading
  const loadInitialData = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([
        apiGet<Status>("/api/ml/status"),
        apiGet<FullPredictionData>("/api/predict?full=1"),
      ]);
      setStatus(s);
      setFullData(f);
      setHorizonData(f.multiHorizon);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load prediction data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Load horizon when selectedHorizon changes
  useEffect(() => {
    if (!fullData) return;
    if (selectedHorizon === fullData.multiHorizon.horizon && !horizonLoading) {
      setHorizonData(fullData.multiHorizon);
      return;
    }

    let ignore = false;
    setHorizonLoading(true);
    apiGet<MultiHorizonForecastResult>(`/api/predict?horizon=${selectedHorizon}`)
      .then((res) => {
        if (!ignore) {
          setHorizonData(res);
          setHorizonLoading(false);
        }
      })
      .catch(() => {
        if (!ignore) setHorizonLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedHorizon, fullData]);

  // Run What-If Simulation
  const runSimulation = useCallback(
    async (
      adjustments: Record<string, number>,
      oneOffs: { name: string; amount: number; category: string }[],
    ) => {
      setSimulating(true);
      try {
        const res = await apiPost<ScenarioSimulationResult>("/api/predict", {
          action: "simulate",
          categoryAdjustments: adjustments,
          oneOffExpenses: oneOffs,
        });
        setSimulationResult(res);
      } catch (e: any) {
        setError(e.message || "Failed to simulate spending scenario.");
      } finally {
        setSimulating(false);
      }
    },
    [],
  );

  // Auto-run simulation on tab open or changes
  useEffect(() => {
    if (activeTab === "simulator" && !simulationResult && fullData) {
      runSimulation(categoryAdjustments, oneOffExpenses);
    }
  }, [activeTab, simulationResult, fullData, categoryAdjustments, oneOffExpenses, runSimulation]);

  async function train() {
    if (status?.hasModel) {
      const ok = confirm(
        `Model '${status.modelVersion}' is currently active and trained. Retraining will calculate new weights and replace it. Continue?`,
      );
      if (!ok) return;
    }

    setTraining(true);
    setResult(null);
    setError(null);
    try {
      const res = await apiPost("/api/ml/train");
      setResult(res);
      await loadInitialData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTraining(false);
    }
  }

  if (loading && !status) return <Spinner label="Loading intelligent expense forecasts…" />;

  const isTrained = status?.hasModel === true;
  const personalized = fullData?.personalized ?? status?.personalized;
  const targetMo = personalized?.targetMonth ?? status?.targetMonth ?? "—";
  const predVal = personalized?.predictedExpense ?? status?.predictedExpense ?? null;
  const method = personalized?.method ?? status?.forecastingMethod ?? "Personalized Forecast";
  const explanation = personalized?.explanation ?? status?.explanation ?? "";
  const historical = personalized?.historicalSeries ?? [];
  const budgetRisk = personalized?.budgetRisk;
  const uncertainty = personalized?.uncertaintyInterval;
  const evalMetrics = personalized?.evaluationMetrics ?? status?.latestRun;
  const reliability = personalized?.reliability;

  const predStatusTone =
    personalized?.status === "ready"
      ? "green"
      : personalized?.status === "baseline"
      ? "brand"
      : personalized?.status === "run_rate"
      ? "amber"
      : "slate";

  const isKaggleMode =
    status?.datasetMode === "kaggle" || status?.datasetMode === "external";

  // Build Interactive Plotly Chart for selected horizon
  const isDaily = horizonData?.granularity === "daily";
  const forecastTraces: any[] = [];

  if (isDaily && horizonData) {
    const dates = horizonData.points.map((p: any) => p.date);
    const uppers = horizonData.points.map((p: any) => p.upperBound);
    const lowers = horizonData.points.map((p: any) => p.lowerBound);
    const preds = horizonData.points.map((p: any) => p.predictedAmount);

    // Uncertainty interval upper
    forecastTraces.push({
      x: dates,
      y: uppers,
      mode: "lines",
      line: { width: 0 },
      showlegend: false,
      hoverinfo: "none",
    });

    // Uncertainty interval lower with fill
    forecastTraces.push({
      x: dates,
      y: lowers,
      mode: "lines",
      line: { width: 0 },
      fill: "tonexty",
      fillcolor: "rgba(20, 184, 166, 0.15)",
      name: "95% Prediction Interval",
      hoverinfo: "none",
    });

    // Forecast line
    forecastTraces.push({
      x: dates,
      y: preds,
      type: "scatter",
      mode: "lines+markers",
      name: `Predicted Daily Spend (${selectedHorizon.toUpperCase()})`,
      line: { color: "#0d9488", width: 2.5 },
      marker: { size: 6, color: "#0d9488" },
      hovertemplate: "%{x}<br>Forecast: ₹%{y:,.2f}<extra></extra>",
    });
  } else if (!isDaily && horizonData) {
    // Medium / Long-term Rollout (3m, 6m)
    // 1. Historical Actuals Trace
    if (historical.length > 0) {
      forecastTraces.push({
        x: historical.map((h) => h.month),
        y: historical.map((h) => h.amount),
        type: "scatter",
        mode: "lines+markers",
        name: "Historical Monthly Expenses",
        line: { color: "#0f172a", width: 2.5 },
        marker: { size: 6, color: "#0f172a" },
        hovertemplate: "%{x}<br>Actual: ₹%{y:,.2f}<extra></extra>",
      });
    }

    const forecastMonths = horizonData.points.map((p: any) => p.month);
    const uppers = horizonData.points.map((p: any) => p.upperBound);
    const lowers = horizonData.points.map((p: any) => p.lowerBound);
    const preds = horizonData.points.map((p: any) => p.predictedAmount);
    const budgets = horizonData.points.map((p: any) => p.budget);

    // Connecting bridge from last historical month
    const bridgeX = historical.length > 0 ? [historical[historical.length - 1].month, ...forecastMonths] : forecastMonths;
    const bridgeY = historical.length > 0 ? [historical[historical.length - 1].amount, ...preds] : preds;

    // Uncertainty band
    forecastTraces.push({
      x: forecastMonths,
      y: uppers,
      mode: "lines",
      line: { width: 0 },
      showlegend: false,
      hoverinfo: "none",
    });

    forecastTraces.push({
      x: forecastMonths,
      y: lowers,
      mode: "lines",
      line: { width: 0 },
      fill: "tonexty",
      fillcolor: "rgba(20, 184, 166, 0.18)",
      name: "95% Prediction Interval",
      hoverinfo: "none",
    });

    // Forecast line
    forecastTraces.push({
      x: bridgeX,
      y: bridgeY,
      type: "scatter",
      mode: "lines+markers",
      name: `Multi-Month Rollout (${selectedHorizon.toUpperCase()})`,
      line: { color: "#14b8a6", width: 2.5, dash: "dot" },
      marker: { size: 8, color: "#14b8a6", symbol: "diamond" },
      hovertemplate: "%{x}<br>Forecast: ₹%{y:,.2f}<extra></extra>",
    });

    // Budget line if present
    const hasBudgets = budgets.some((b: any) => b != null);
    if (hasBudgets) {
      forecastTraces.push({
        x: forecastMonths,
        y: budgets,
        type: "scatter",
        mode: "lines+markers",
        name: "Configured Budget",
        line: { color: "#e11d48", width: 1.8, dash: "dash" },
        marker: { size: 6, color: "#e11d48", symbol: "square" },
        hovertemplate: "%{x}<br>Budget: ₹%{y:,.2f}<extra></extra>",
      });
    }
  }

  return (
    <div className="space-y-6 pb-16">
      <PageHeader
        title="Intelligent Expense Forecasting System"
        subtitle="Multi-horizon predictive intelligence derived strictly from your verified financial sequence"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/training"
              className="btn-ghost flex items-center gap-1.5 border border-slate-200"
            >
              <span>🏋️</span>
              <span>Model Training &amp; Loss</span>
            </Link>
            <button
              className="btn-primary"
              onClick={train}
              disabled={training}
            >
              {training
                ? "Training Model…"
                : isTrained
                ? "Retrain Model"
                : "Train Model"}
            </button>
          </div>
        }
      />

      {error && <Alert kind="error">{error}</Alert>}

      {/* Dataset & Privacy Guarantee Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🛡️</span>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-slate-800">
                  Data-Driven Forecasting Guarantee
                </h4>
                <Badge tone="green">Multi-User Isolated</Badge>
                {reliability && (
                  <Badge
                    tone={
                      reliability.level === "High"
                        ? "green"
                        : reliability.level === "Moderate"
                        ? "brand"
                        : "amber"
                    }
                  >
                    {reliability.level} Reliability ({reliability.score}%)
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed max-w-3xl">
                Every forecast is calculated exclusively from your personal transactions using
                chronological backtested weights. Zero sample/mock data is mixed into your
                predictions.
              </p>
            </div>
          </div>
          <Link
            href="/training"
            className="btn-ghost text-xs shrink-0 flex items-center gap-1.5 border border-slate-200"
          >
            <span>Inspect Neural Weights →</span>
          </Link>
        </div>
      </div>

      {result?.insufficient && (
        <Alert kind="warning">
          <strong>Insufficient Data for Training:</strong> {result.error}{" "}
          You can switch dataset modes in{" "}
          <Link href="/training" className="underline font-semibold">
            Model Training
          </Link>
          .
        </Alert>
      )}

      {result?.ok && (
        <Alert kind="success">
          Model trained successfully using {result.datasetMode ?? "configured"} data (
          {result.monthsUsed} months). Next month forecast ({result.targetMonth}):{" "}
          <strong>{fmt.currency(result.nextForecast)}</strong>.
        </Alert>
      )}

      {result && !result.ok && !result.insufficient && (
        <Alert kind="error">Training failed: {result.error}</Alert>
      )}

      {/* 5 Core Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Card 1: Next Month's Predicted Expense */}
        <KpiCard
          title="Predicted Expenses"
          value={predVal == null ? "—" : fmt.currency(predVal)}
          subtitle={
            personalized?.previousMonthExpense != null
              ? `Target: ${targetMo} (vs ${fmt.currency(personalized.previousMonthExpense)} prior)`
              : `Target horizon: ${targetMo}`
          }
          tone="brand"
        />

        {/* Card 2: Predicted Spending Change */}
        <KpiCard
          title="Spending Change"
          value={
            personalized?.changePercent != null ? (
              <span
                className={
                  personalized.changeAmount && personalized.changeAmount > 0
                    ? "text-rose-600"
                    : "text-emerald-600"
                }
              >
                {personalized.changePercent > 0 ? "+" : ""}
                {personalized.changePercent}%
              </span>
            ) : (
              "—"
            )
          }
          subtitle={
            personalized?.changeAmount != null
              ? `${personalized.changeAmount > 0 ? "+" : ""}${fmt.currency(
                  personalized.changeAmount,
                )} vs baseline`
              : "Baseline pending"
          }
          tone={
            personalized?.changeAmount && personalized.changeAmount > 0 ? "rose" : "green"
          }
        />

        {/* Card 3: Average Daily Spending */}
        <KpiCard
          title="Daily Spending Pace"
          value={
            personalized?.forecastDailyAverage != null
              ? `${fmt.currency(personalized.forecastDailyAverage)}/day`
              : "—"
          }
          subtitle={
            personalized?.historicalDailyAverage != null
              ? `Hist: ${fmt.currency(personalized.historicalDailyAverage)}/day`
              : "Historical pace"
          }
          tone="indigo"
        />

        {/* Card 4: Budget Risk Status */}
        <KpiCard
          title="Budget Risk Status"
          value={
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold">
                {budgetRisk?.status === "over"
                  ? "Exceeded"
                  : budgetRisk?.riskLevel === "high"
                  ? "High Risk"
                  : budgetRisk?.riskLevel === "medium"
                  ? "Moderate"
                  : budgetRisk?.status === "under"
                  ? "On Track"
                  : "No Budget"}
              </span>
            </div>
          }
          subtitle={
            budgetRisk?.difference != null
              ? budgetRisk.status === "over"
                ? `Exceeds by ${fmt.currency(budgetRisk.difference)}`
                : `${fmt.currency(Math.abs(budgetRisk.difference))} buffer left`
              : "No overall budget set"
          }
          tone={
            budgetRisk?.status === "over"
              ? "rose"
              : budgetRisk?.riskLevel === "high"
              ? "amber"
              : "green"
          }
        />

        {/* Card 5: Model Evaluation Metrics */}
        <KpiCard
          title="Model Backtesting"
          value={
            evalMetrics?.wape != null
              ? `WAPE: ${evalMetrics.wape}%`
              : evalMetrics?.mae != null
              ? `MAE: ${fmt.currency(evalMetrics.mae)}`
              : isTrained
              ? "Trained LSTM"
              : "Baseline Engine"
          }
          subtitle={
            evalMetrics?.rmse != null
              ? `RMSE: ₹${Math.round(evalMetrics.rmse)} (${
                  uncertainty ? `±${fmt.currency(uncertainty.margin)}` : "evaluated"
                })`
              : `${method}`
          }
          tone={isTrained ? "green" : "slate"}
        />
      </div>

      {/* Navigation Tabs */}
      <div className="flex overflow-x-auto border-b border-slate-200">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === "overview"
              ? "border-brand-600 text-brand-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <span>📈</span>
          <span>Overview &amp; Horizon Forecasts</span>
        </button>

        <button
          onClick={() => setActiveTab("categories")}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === "categories"
              ? "border-brand-600 text-brand-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <span>🏷️</span>
          <span>Category Forecasts</span>
        </button>

        <button
          onClick={() => setActiveTab("granular")}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === "granular"
              ? "border-brand-600 text-brand-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <span>📅</span>
          <span>Daily &amp; Weekly Patterns</span>
        </button>

        <button
          onClick={() => setActiveTab("explain")}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === "explain"
              ? "border-brand-600 text-brand-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <span>💡</span>
          <span>Why This Prediction?</span>
        </button>

        <button
          onClick={() => setActiveTab("simulator")}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === "simulator"
              ? "border-brand-600 text-brand-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <span>🎛️</span>
          <span>&quot;What-If&quot; Spending Simulator</span>
        </button>

        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === "history"
              ? "border-brand-600 text-brand-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <span>🎯</span>
          <span>Performance &amp; Accuracy History</span>
        </button>
      </div>

      {/* =================================================================== */}
      {/* TAB 1: OVERVIEW & MULTI-HORIZON EXPLORER */}
      {/* =================================================================== */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Horizon Selection Bar */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Select Forecast Horizon
                </h3>
                <p className="text-xs text-slate-500">
                  Toggle between short-term daily trajectories and multi-month autoregressive projections
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-100 p-1">
                {(["7d", "30d", "3m", "6m"] as ForecastHorizon[]).map((hz) => (
                  <button
                    key={hz}
                    onClick={() => setSelectedHorizon(hz)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                      selectedHorizon === hz
                        ? "bg-white text-brand-700 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {hz === "7d"
                      ? "7-Day Daily"
                      : hz === "30d"
                      ? "30-Day Daily"
                      : hz === "3m"
                      ? "3-Month Rollout"
                      : "6-Month Rollout"}
                  </button>
                ))}
              </div>
            </div>

            {/* Horizon Summary Metrics Bar */}
            {horizonData && (
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-4">
                <div>
                  <span className="text-[11px] font-medium text-slate-400">Forecast Period</span>
                  <p className="text-xs font-bold text-slate-700">
                    {horizonData.startDate} → {horizonData.endDate}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] font-medium text-slate-400">Total Horizon Projection</span>
                  <p className="text-xs font-bold text-brand-600">
                    {fmt.currency(horizonData.totalPredicted)}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] font-medium text-slate-400">
                    {horizonData.granularity === "daily" ? "Daily Run-Rate Pace" : "Monthly Average"}
                  </span>
                  <p className="text-xs font-bold text-slate-700">
                    {fmt.currency(horizonData.averagePerUnit)}/
                    {horizonData.granularity === "daily" ? "day" : "mo"}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] font-medium text-slate-400">Methodology</span>
                  <p className="truncate text-xs font-bold text-slate-700" title={horizonData.method}>
                    {horizonData.method}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Interactive Chart */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  {isDaily
                    ? `Daily Spend Forecast & Seasonality (${selectedHorizon.toUpperCase()})`
                    : `Actual vs. Predicted Expenses with 95% Uncertainty Interval (${selectedHorizon.toUpperCase()})`}
                </h3>
                <p className="text-xs text-slate-500">
                  {isDaily
                    ? "Day-of-week adjusted expenditure projection with 95% confidence intervals"
                    : "Chronological historical actuals connected to future autoregressive rollout"}
                </p>
              </div>

              {uncertainty && (
                <Badge tone="brand">
                  ±{fmt.currency(uncertainty.margin)} Margin of Error
                </Badge>
              )}
            </div>

            {horizonLoading ? (
              <div className="flex h-72 items-center justify-center">
                <Spinner label="Computing horizon projection…" />
              </div>
            ) : forecastTraces.length === 0 ? (
              <EmptyState>
                No personal expense records found.{" "}
                <Link href="/transactions" className="font-semibold text-brand-600 hover:underline">
                  Add transactions
                </Link>{" "}
                to unlock expenditure predictions.
              </EmptyState>
            ) : (
              <PlotlyChart
                data={forecastTraces}
                layout={{
                  xaxis: {
                    title: isDaily ? "Forecast Date" : "Calendar Month",
                    showgrid: true,
                    gridcolor: "#f1f5f9",
                  },
                  yaxis: {
                    title: isDaily ? "Projected Spending (₹)" : "Monthly Total Expenses (₹)",
                    showgrid: true,
                    gridcolor: "#f1f5f9",
                  },
                  hovermode: "x unified",
                  legend: { orientation: "h", y: -0.2 },
                }}
              />
            )}
          </Card>

          {/* Forecast Points Data Table */}
          {horizonData && horizonData.points.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-800">
                Detailed Forecast Trajectory Points ({horizonData.points.length}{" "}
                {isDaily ? "Days" : "Months"})
              </h3>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-2.5 font-semibold">Period / Date</th>
                      <th className="p-2.5 font-semibold">{isDaily ? "Day of Week" : "Month Name"}</th>
                      <th className="p-2.5 text-right font-semibold">Forecast Amount</th>
                      <th className="p-2.5 text-right font-semibold">95% Confidence Interval</th>
                      {!isDaily && <th className="p-2.5 text-right font-semibold">Budget</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {horizonData.points.map((pt: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="p-2.5 font-medium text-slate-800">
                          {isDaily ? pt.date : pt.month}
                        </td>
                        <td className="p-2.5 text-slate-600">
                          {isDaily ? pt.dayName : pt.monthName}
                        </td>
                        <td className="p-2.5 text-right font-bold text-brand-700">
                          {fmt.currency(pt.predictedAmount)}
                        </td>
                        <td className="p-2.5 text-right text-slate-500">
                          {fmt.currency(pt.lowerBound)} – {fmt.currency(pt.upperBound)}
                        </td>
                        {!isDaily && (
                          <td className="p-2.5 text-right font-medium">
                            {pt.budget != null ? fmt.currency(pt.budget) : "—"}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Target Month Budget Comparison Callout */}
          {budgetRisk && budgetRisk.budget != null && (
            <div
              className={`rounded-xl border p-4 shadow-xs ${
                budgetRisk.status === "over"
                  ? "border-rose-200 bg-rose-50/50"
                  : "border-emerald-200 bg-emerald-50/50"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-800">
                    Target Month Budget Comparison for {targetMo}
                  </h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Configured Budget: <strong>{fmt.currency(budgetRisk.budget)}</strong> | Forecast:{" "}
                    <strong>{predVal != null ? fmt.currency(predVal) : "—"}</strong>
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`text-sm font-bold ${
                      budgetRisk.status === "over" ? "text-rose-700" : "text-emerald-700"
                    }`}
                  >
                    {budgetRisk.status === "over" ? "Deficit: +" : "Surplus: "}
                    {budgetRisk.difference != null ? fmt.currency(Math.abs(budgetRisk.difference)) : "—"}
                  </span>
                  {budgetRisk.projectedExhaustionDate && (
                    <p className="text-[11px] text-rose-600 font-semibold mt-0.5">
                      ⚠️ Estimated Budget Exhaustion: {budgetRisk.projectedExhaustionDate}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: CATEGORY FORECASTS */}
      {/* =================================================================== */}
      {activeTab === "categories" && fullData?.categories && (
        <div className="space-y-6">
          {/* Category Highlights */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Highest Projected Category
              </span>
              <p className="mt-1 text-base font-bold text-slate-800">
                {fullData.categories.highestProjectedCategory ?? "None"}
              </p>
              <span className="text-xs text-brand-600 font-semibold">
                {fullData.categories.categories[0]
                  ? `${fmt.currency(fullData.categories.categories[0].predictedAmount)} (${fullData.categories.categories[0].shareOfTotal}% of total)`
                  : "—"}
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Largest Projected Increase
              </span>
              <p className="mt-1 text-base font-bold text-slate-800">
                {fullData.categories.largestIncreaseCategory ?? "None"}
              </p>
              <span className="text-xs text-rose-600 font-semibold">
                {(() => {
                  const item = fullData.categories.categories.find(
                    (c) => c.category === fullData.categories.largestIncreaseCategory,
                  );
                  return item && item.changeAmount > 0
                    ? `+${fmt.currency(item.changeAmount)} (${item.changePercent != null ? `+${item.changePercent}%` : ""})`
                    : "No major increase projected";
                })()}
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Largest Projected Reduction
              </span>
              <p className="mt-1 text-base font-bold text-slate-800">
                {fullData.categories.largestDecreaseCategory ?? "None"}
              </p>
              <span className="text-xs text-emerald-600 font-semibold">
                {(() => {
                  const item = fullData.categories.categories.find(
                    (c) => c.category === fullData.categories.largestDecreaseCategory,
                  );
                  return item && item.changeAmount < 0
                    ? `${fmt.currency(item.changeAmount)} (${item.changePercent != null ? `${item.changePercent}%` : ""})`
                    : "No reductions projected";
                })()}
              </span>
            </div>
          </div>

          {/* Category Breakdown Bar Chart */}
          {fullData.categories.categories.length > 0 && (
            <Card>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                Category Comparison: Historical Average vs. Forecasted vs. Budget
              </h3>
              <PlotlyChart
                data={[
                  {
                    x: fullData.categories.categories.map((c) => c.category),
                    y: fullData.categories.categories.map((c) => c.historicalAverage),
                    type: "bar",
                    name: "Historical Average",
                    marker: { color: "#94a3b8" },
                  },
                  {
                    x: fullData.categories.categories.map((c) => c.category),
                    y: fullData.categories.categories.map((c) => c.predictedAmount),
                    type: "bar",
                    name: "Forecasted Expense",
                    marker: { color: "#14b8a6" },
                  },
                  {
                    x: fullData.categories.categories.map((c) => c.category),
                    y: fullData.categories.categories.map((c) => c.categoryBudget ?? 0),
                    type: "bar",
                    name: "Category Budget",
                    marker: { color: "#f43f5e" },
                  },
                ]}
                layout={{
                  barmode: "group",
                  xaxis: { title: "Category" },
                  yaxis: { title: "Amount (₹)" },
                  legend: { orientation: "h", y: -0.2 },
                }}
              />
            </Card>
          )}

          {/* Full Category Table */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-800">
              Detailed Category Expenditure Projections ({targetMo})
            </h3>
            {fullData.categories.categories.length === 0 ? (
              <EmptyState>No category data found in your personal records.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-3 font-semibold">Category</th>
                      <th className="p-3 text-right font-semibold">Historical Avg</th>
                      <th className="p-3 text-right font-semibold">Predicted Amount</th>
                      <th className="p-3 text-right font-semibold">Projected Change</th>
                      <th className="p-3 text-right font-semibold">Share of Total</th>
                      <th className="p-3 text-right font-semibold">Category Budget</th>
                      <th className="p-3 text-right font-semibold">Budget Status</th>
                      <th className="p-3 text-center font-semibold">Momentum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fullData.categories.categories.map((c) => (
                      <tr key={c.category} className="hover:bg-slate-50/60">
                        <td className="p-3 font-bold text-slate-800">{c.category}</td>
                        <td className="p-3 text-right text-slate-600">
                          {fmt.currency(c.historicalAverage)}
                        </td>
                        <td className="p-3 text-right font-bold text-brand-700">
                          {fmt.currency(c.predictedAmount)}
                        </td>
                        <td className="p-3 text-right font-semibold">
                          <span
                            className={
                              c.changeAmount > 0
                                ? "text-rose-600"
                                : c.changeAmount < 0
                                ? "text-emerald-600"
                                : "text-slate-500"
                            }
                          >
                            {c.changeAmount > 0 ? "+" : ""}
                            {fmt.currency(c.changeAmount)}
                            {c.changePercent != null && ` (${c.changePercent > 0 ? "+" : ""}${c.changePercent}%)`}
                          </span>
                        </td>
                        <td className="p-3 text-right font-medium text-slate-700">
                          {c.shareOfTotal}%
                        </td>
                        <td className="p-3 text-right font-medium text-slate-700">
                          {c.categoryBudget != null ? fmt.currency(c.categoryBudget) : "—"}
                        </td>
                        <td className="p-3 text-right font-semibold">
                          {c.categoryBudget != null ? (
                            <Badge tone={c.budgetStatus === "over" ? "rose" : "green"}>
                              {c.budgetStatus === "over"
                                ? `Over by ${fmt.currency(c.budgetVariance ?? 0)}`
                                : `Under by ${fmt.currency(Math.abs(c.budgetVariance ?? 0))}`}
                            </Badge>
                          ) : (
                            <span className="text-slate-400">No Budget</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <Badge
                            tone={
                              c.trend === "increasing"
                                ? "rose"
                                : c.trend === "decreasing"
                                ? "green"
                                : "slate"
                            }
                          >
                            {c.trend.toUpperCase()}
                          </Badge>
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

      {/* =================================================================== */}
      {/* TAB 3: GRANULAR ANALYSIS (DAILY, WEEKLY, MONTHLY) */}
      {/* =================================================================== */}
      {activeTab === "granular" && fullData?.granular && (
        <div className="space-y-6">
          {/* Daily Patterns */}
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Day-of-Week Spending Dynamics
                </h3>
                <p className="text-xs text-slate-500">
                  Historical average expenditure distribution across Sunday through Saturday
                </p>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <div>
                  <span className="text-slate-400">Peak Day: </span>
                  <strong className="text-brand-700">{fullData.granular.daily.peakDay}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Lowest Day: </span>
                  <strong className="text-slate-700">{fullData.granular.daily.lowestDay}</strong>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <PlotlyChart
                  data={[
                    {
                      x: fullData.granular.daily.dayOfWeekAverages.map((d) => d.day),
                      y: fullData.granular.daily.dayOfWeekAverages.map((d) => d.average),
                      type: "bar",
                      marker: {
                        color: fullData.granular.daily.dayOfWeekAverages.map((d) =>
                          d.day === fullData.granular.daily.peakDay ? "#0d9488" : "#94a3b8",
                        ),
                      },
                      hovertemplate: "%{x}<br>Average Spend: ₹%{y:,.2f}<extra></extra>",
                    },
                  ]}
                  layout={{
                    xaxis: { title: "Day of Week" },
                    yaxis: { title: "Average Spend (₹)" },
                    margin: { t: 20, r: 20, l: 50, b: 40 },
                  }}
                />
              </div>

              <div className="flex flex-col justify-center space-y-3 rounded-lg bg-slate-50 p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Weekday vs. Weekend Spending
                </h4>

                <div className="rounded-lg bg-white p-3 shadow-2xs">
                  <span className="text-[11px] text-slate-400">Weekday Average (Mon–Fri)</span>
                  <p className="text-base font-bold text-slate-800">
                    {fmt.currency(fullData.granular.daily.weekdayAverage)}/day
                  </p>
                </div>

                <div className="rounded-lg bg-white p-3 shadow-2xs">
                  <span className="text-[11px] text-slate-400">Weekend Average (Sat–Sun)</span>
                  <p className="text-base font-bold text-brand-600">
                    {fmt.currency(fullData.granular.daily.weekendAverage)}/day
                  </p>
                </div>

                <div className="rounded-lg bg-white p-3 shadow-2xs">
                  <span className="text-[11px] text-slate-400">Weekend vs. Weekday Ratio</span>
                  <p className="text-base font-bold text-slate-800">
                    {fullData.granular.daily.weekendVsWeekdayRatio != null
                      ? `${fullData.granular.daily.weekendVsWeekdayRatio}x`
                      : "—"}
                  </p>
                  <span className="text-[10px] text-slate-500">
                    {fullData.granular.daily.weekendVsWeekdayRatio &&
                    fullData.granular.daily.weekendVsWeekdayRatio > 1
                      ? "Spending is heavier on weekends"
                      : "Spending is heavier on weekdays"}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Weekly Patterns */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Weekly Spending Trajectory</h3>
                <p className="text-xs text-slate-500">
                  Chronological week-over-week spending progression
                </p>
              </div>
              <div className="text-xs font-semibold text-slate-600">
                Average Weekly Spend: {fmt.currency(fullData.granular.weekly.averageWeeklySpend)}
              </div>
            </div>

            {fullData.granular.weekly.weeklySeries.length === 0 ? (
              <EmptyState>No weekly records available.</EmptyState>
            ) : (
              <PlotlyChart
                data={[
                  {
                    x: fullData.granular.weekly.weeklySeries.map((w) => w.weekLabel),
                    y: fullData.granular.weekly.weeklySeries.map((w) => w.total),
                    type: "scatter",
                    mode: "lines+markers",
                    line: { color: "#6366f1", width: 2.5 },
                    marker: { size: 6, color: "#6366f1" },
                    hovertemplate: "%{x}<br>Total Spend: ₹%{y:,.2f}<extra></extra>",
                  },
                ]}
                layout={{
                  xaxis: { title: "Calendar Week" },
                  yaxis: { title: "Weekly Spend (₹)" },
                }}
              />
            )}
          </Card>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 4: WHY THIS PREDICTION? (EXPLAINABILITY) */}
      {/* =================================================================== */}
      {activeTab === "explain" && fullData?.explainability && (
        <div className="space-y-6">
          {/* Executive Summary */}
          <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-5 shadow-xs">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🧠</span>
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Forecast Rationale &amp; Synthesis
                </h3>
                <p className="mt-1.5 text-xs text-slate-700 leading-relaxed font-medium">
                  {fullData.explainability.summary}
                </p>
              </div>
            </div>
          </div>

          {/* Key Drivers Grid */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800">
              Evidence-Backed Predictive Drivers
            </h3>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fullData.explainability.factors.map((factor, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                    <h4 className="text-xs font-bold text-slate-800">{factor.factor}</h4>
                    <Badge
                      tone={
                        factor.impact === "upward"
                          ? "rose"
                          : factor.impact === "downward"
                          ? "green"
                          : "slate"
                      }
                    >
                      {factor.impact.toUpperCase()} IMPACT
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">
                    {factor.description}
                  </p>
                  {factor.estimatedImpactAmount != null && factor.estimatedImpactAmount > 0 && (
                    <div className="mt-2 text-[11px] font-semibold text-slate-700">
                      Estimated Momentum Impact: {fmt.currency(factor.estimatedImpactAmount)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Model Transparency & Specification */}
          <Card>
            <h3 className="mb-2 text-sm font-bold text-slate-800">
              Model Specifications &amp; Backtesting Validation
            </h3>
            <div className="grid grid-cols-1 gap-4 text-xs text-slate-600 sm:grid-cols-2">
              <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                <p>
                  <strong>Architecture:</strong> Recurrent Neural Network (LSTM 32 Units +
                  Dropout 0.2 + Dense Layer).
                </p>
                <p>
                  <strong>Lookback Window:</strong>{" "}
                  {fullData.explainability.methodDetails.lookbackMonths} consecutive monthly
                  observations.
                </p>
                <p>
                  <strong>Training Samples:</strong>{" "}
                  {fullData.explainability.methodDetails.trainingDataPoints} monthly data points.
                </p>
              </div>

              <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                <p>
                  <strong>WAPE (Weighted Absolute Percentage Error):</strong>{" "}
                  {fullData.explainability.methodDetails.lastEvaluationWape != null
                    ? `${fullData.explainability.methodDetails.lastEvaluationWape}%`
                    : "Calibrating (Baseline active)"}
                </p>
                <p>
                  <strong>Data Isolation:</strong> External datasets (e.g. Kaggle) are strictly
                  isolated in the training sandbox and never used to synthesize personal forecasts.
                </p>
                <p>
                  <strong>Temporal Integrity:</strong> Normalization scalers fit strictly on
                  training splits; zero future lookahead bias.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 5: "WHAT-IF" SPENDING SIMULATOR */}
      {/* =================================================================== */}
      {activeTab === "simulator" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <h3 className="text-sm font-bold text-slate-800">
              Interactive Spending Scenario Simulator
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Test hypothetical spending adjustments (e.g. &quot;What if I reduce dining by 20%?&quot;)
              or plan upcoming one-off purchases without modifying your real financial transactions.
            </p>
          </div>

          {/* Simulation Output Cards */}
          {simulationResult && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <KpiCard
                title="Baseline Forecast"
                value={fmt.currency(simulationResult.baselineForecast)}
                subtitle="Calculated model prediction"
                tone="slate"
              />
              <KpiCard
                title="Simulated Forecast"
                value={fmt.currency(simulationResult.simulatedForecast)}
                subtitle={
                  simulationResult.percentChange !== 0
                    ? `${simulationResult.percentChange > 0 ? "+" : ""}${simulationResult.percentChange}% vs baseline`
                    : "No adjustments applied"
                }
                tone={simulationResult.netDifference > 0 ? "rose" : "green"}
              />
              <KpiCard
                title="Net Spending Impact"
                value={
                  <span
                    className={
                      simulationResult.netDifference > 0
                        ? "text-rose-600 font-bold"
                        : simulationResult.netDifference < 0
                        ? "text-emerald-600 font-bold"
                        : "text-slate-800 font-bold"
                    }
                  >
                    {simulationResult.netDifference > 0 ? "+" : ""}
                    {fmt.currency(simulationResult.netDifference)}
                  </span>
                }
                subtitle="Difference from original forecast"
                tone="brand"
              />
              <KpiCard
                title="Simulated Budget Status"
                value={
                  simulationResult.overallBudget != null ? (
                    <Badge tone={simulationResult.budgetStatusAfter === "over" ? "rose" : "green"}>
                      {simulationResult.budgetStatusAfter === "over" ? "Exceeds Budget" : "Within Budget"}
                    </Badge>
                  ) : (
                    "No Budget"
                  )
                }
                subtitle={
                  simulationResult.simulatedBudgetDifference != null
                    ? simulationResult.simulatedBudgetDifference > 0
                      ? `Exceeds by ${fmt.currency(simulationResult.simulatedBudgetDifference)}`
                      : `Surplus of ${fmt.currency(Math.abs(simulationResult.simulatedBudgetDifference))}`
                    : "Configure budget to monitor"
                }
                tone={simulationResult.budgetStatusAfter === "over" ? "rose" : "green"}
              />
            </div>
          )}

          {/* Controls: Category Sliders & One-Off Inputs */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Category Adjustments */}
            <Card>
              <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="text-sm font-semibold text-slate-800">
                  Category Percentage Adjustments
                </h4>
                <button
                  onClick={() => {
                    setCategoryAdjustments({});
                    runSimulation({}, oneOffExpenses);
                  }}
                  className="btn-ghost text-xs text-rose-600 hover:text-rose-700"
                >
                  Reset Sliders
                </button>
              </div>

              <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
                {fullData?.categories?.categories.map((c) => {
                  const currentVal = categoryAdjustments[c.category] ?? 0;
                  return (
                    <div key={c.category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-800">{c.category}</span>
                        <span
                          className={`font-bold ${
                            currentVal > 0
                              ? "text-rose-600"
                              : currentVal < 0
                              ? "text-emerald-600"
                              : "text-slate-500"
                          }`}
                        >
                          {currentVal > 0 ? "+" : ""}
                          {currentVal}% (₹
                          {Math.round(c.predictedAmount * (1 + currentVal / 100)).toLocaleString(
                            "en-IN",
                          )}
                          )
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-50"
                        max="50"
                        step="5"
                        value={currentVal}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          const nextAdj = { ...categoryAdjustments, [c.category]: val };
                          setCategoryAdjustments(nextAdj);
                          runSimulation(nextAdj, oneOffExpenses);
                        }}
                        className="w-full accent-brand-600"
                      />
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>-50%</span>
                        <span>0%</span>
                        <span>+50%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* One-Off Expenses */}
            <Card>
              <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="text-sm font-semibold text-slate-800">
                  Planned One-Off Purchases
                </h4>
                {oneOffExpenses.length > 0 && (
                  <button
                    onClick={() => {
                      setOneOffExpenses([]);
                      runSimulation(categoryAdjustments, []);
                    }}
                    className="btn-ghost text-xs text-rose-600 hover:text-rose-700"
                  >
                    Clear Purchases
                  </button>
                )}
              </div>

              {/* Add One-Off Input Form */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 mb-3">
                <input
                  type="text"
                  placeholder="e.g. New Smartphone"
                  value={newOneOffName}
                  onChange={(e) => setNewOneOffName(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-brand-500 focus:outline-hidden"
                />
                <input
                  type="number"
                  placeholder="Amount (₹)"
                  value={newOneOffAmount}
                  onChange={(e) => setNewOneOffAmount(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-brand-500 focus:outline-hidden"
                />
                <div className="flex gap-1.5">
                  <select
                    value={newOneOffCategory}
                    onChange={(e) => setNewOneOffCategory(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:border-brand-500 focus:outline-hidden"
                  >
                    <option value="">Category…</option>
                    {fullData?.categories?.categories.map((c) => (
                      <option key={c.category} value={c.category}>
                        {c.category}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const amt = Number(newOneOffAmount);
                      if (!newOneOffName || isNaN(amt) || amt <= 0) return;
                      const nextOneOffs = [
                        ...oneOffExpenses,
                        { name: newOneOffName, amount: amt, category: newOneOffCategory },
                      ];
                      setOneOffExpenses(nextOneOffs);
                      setNewOneOffName("");
                      setNewOneOffAmount("");
                      setNewOneOffCategory("");
                      runSimulation(categoryAdjustments, nextOneOffs);
                    }}
                    className="btn-primary shrink-0 text-xs px-2.5"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* One-off expenses list */}
              {oneOffExpenses.length === 0 ? (
                <p className="text-xs text-slate-400 italic">
                  No one-off expenses added yet. Add large upcoming purchases to test impact.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                  {oneOffExpenses.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2 text-xs">
                      <div>
                        <span className="font-semibold text-slate-800">{item.name}</span>
                        {item.category && (
                          <span className="ml-2 text-slate-400">({item.category})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <strong className="text-slate-800">{fmt.currency(item.amount)}</strong>
                        <button
                          onClick={() => {
                            const filtered = oneOffExpenses.filter((_, i) => i !== idx);
                            setOneOffExpenses(filtered);
                            runSimulation(categoryAdjustments, filtered);
                          }}
                          className="text-slate-400 hover:text-rose-600"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Simulated Category Breakdown Table */}
          {simulationResult && simulationResult.categoryBreakdown.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-800">
                Simulated Category Breakdown
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-2.5 font-semibold">Category</th>
                      <th className="p-2.5 text-right font-semibold">Baseline</th>
                      <th className="p-2.5 text-right font-semibold">Adjustment %</th>
                      <th className="p-2.5 text-right font-semibold">One-Offs</th>
                      <th className="p-2.5 text-right font-semibold">Simulated Total</th>
                      <th className="p-2.5 text-right font-semibold">Budget</th>
                      <th className="p-2.5 text-right font-semibold">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {simulationResult.categoryBreakdown.map((row) => (
                      <tr key={row.category} className="hover:bg-slate-50/60">
                        <td className="p-2.5 font-bold text-slate-800">{row.category}</td>
                        <td className="p-2.5 text-right text-slate-600">
                          {fmt.currency(row.baselineAmount)}
                        </td>
                        <td className="p-2.5 text-right font-semibold">
                          <span
                            className={
                              row.adjustmentPercent > 0
                                ? "text-rose-600"
                                : row.adjustmentPercent < 0
                                ? "text-emerald-600"
                                : "text-slate-400"
                            }
                          >
                            {row.adjustmentPercent > 0 ? "+" : ""}
                            {row.adjustmentPercent}%
                          </span>
                        </td>
                        <td className="p-2.5 text-right font-medium text-slate-700">
                          {row.oneOffAmount > 0 ? `+${fmt.currency(row.oneOffAmount)}` : "—"}
                        </td>
                        <td className="p-2.5 text-right font-bold text-brand-700">
                          {fmt.currency(row.simulatedTotal)}
                        </td>
                        <td className="p-2.5 text-right font-medium text-slate-700">
                          {row.categoryBudget != null ? fmt.currency(row.categoryBudget) : "—"}
                        </td>
                        <td className="p-2.5 text-right font-semibold">
                          {row.categoryBudgetDifference != null ? (
                            <Badge tone={row.categoryBudgetDifference > 0 ? "rose" : "green"}>
                              {row.categoryBudgetDifference > 0
                                ? `+${fmt.currency(row.categoryBudgetDifference)}`
                                : fmt.currency(row.categoryBudgetDifference)}
                            </Badge>
                          ) : (
                            "No Budget"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 6: PERFORMANCE & ACCURACY HISTORY */}
      {/* =================================================================== */}
      {activeTab === "history" && fullData?.history && (
        <div className="space-y-6">
          {/* Historical Accuracy Summary Card */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Overall Historical Rating
              </span>
              <p className="mt-1 text-base font-bold text-slate-800">
                {fullData.history.overallRating}
              </p>
              <span className="text-xs text-brand-600 font-semibold">
                {fullData.history.completedCount} completed realization month(s)
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Mean Absolute Error (MAE)
              </span>
              <p className="mt-1 text-base font-bold text-slate-800">
                {fullData.history.meanAbsoluteError != null
                  ? fmt.currency(fullData.history.meanAbsoluteError)
                  : "—"}
              </p>
              <span className="text-xs text-slate-500">
                Average deviation from actual realized spending
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Average Realized Accuracy
              </span>
              <p className="mt-1 text-base font-bold text-slate-800">
                {fullData.history.averagePercentageAccuracy != null
                  ? `${fullData.history.averagePercentageAccuracy}%`
                  : "—"}
              </p>
              <span className="text-xs text-emerald-600 font-semibold">
                Based on completed months
              </span>
            </div>
          </div>

          {/* Model vs Baselines Comparison Table */}
          {status?.evaluation?.baselines && status.evaluation.baselines.length > 0 && (
            <Card>
              <h3 className="mb-2 text-sm font-bold text-slate-800">
                Model vs. Baseline Benchmark Comparison
              </h3>
              <p className="mb-3 text-xs text-slate-500">
                Chronological backtest verification proving deep learning model performance against naive standards
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-2.5 font-semibold">Model / Baseline</th>
                      <th className="p-2.5 text-right font-semibold">MAE</th>
                      <th className="p-2.5 text-right font-semibold">RMSE</th>
                      <th className="p-2.5 text-right font-semibold">WAPE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-emerald-50/40 font-bold">
                      <td className="p-2.5 text-brand-700">
                        {status.modelVersion ?? "LSTM Neural Network"} (Personalized)
                      </td>
                      <td className="p-2.5 text-right">
                        {status.evaluation.evaluation.metrics.mae.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-right">
                        {status.evaluation.evaluation.metrics.rmse.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-right">
                        {status.evaluation.evaluation.metrics.wape != null
                          ? `${status.evaluation.evaluation.metrics.wape}%`
                          : "—"}
                      </td>
                    </tr>
                    {status.evaluation.baselines.map((b) => (
                      <tr key={b.name} className="hover:bg-slate-50/60">
                        <td className="p-2.5 text-slate-700">{b.name}</td>
                        <td className="p-2.5 text-right">{b.metrics.mae?.toFixed(2) ?? "—"}</td>
                        <td className="p-2.5 text-right">{b.metrics.rmse?.toFixed(2) ?? "—"}</td>
                        <td className="p-2.5 text-right">
                          {b.metrics.wape != null ? `${b.metrics.wape}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Historical Predictions Table */}
          <Card>
            <h3 className="mb-3 text-sm font-bold text-slate-800">
              Audit Log: Past Predictions vs. Realized Spending
            </h3>
            {fullData.history.records.length === 0 ? (
              <EmptyState>No past prediction records recorded yet.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-2.5 font-semibold">Target Month</th>
                      <th className="p-2.5 text-right font-semibold">Predicted</th>
                      <th className="p-2.5 text-right font-semibold">Actual Expense</th>
                      <th className="p-2.5 text-right font-semibold">Error (₹)</th>
                      <th className="p-2.5 text-right font-semibold">Error (%)</th>
                      <th className="p-2.5 text-center font-semibold">Accuracy Rating</th>
                      <th className="p-2.5 text-slate-500 font-semibold">Model Version</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fullData.history.records.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/60">
                        <td className="p-2.5 font-bold text-slate-800">{r.targetMonth}</td>
                        <td className="p-2.5 text-right font-semibold text-brand-700">
                          {fmt.currency(r.predictedExpense)}
                        </td>
                        <td className="p-2.5 text-right text-slate-800">
                          {r.actualExpense != null ? fmt.currency(r.actualExpense) : "Pending"}
                        </td>
                        <td className="p-2.5 text-right">
                          {r.difference != null ? (
                            <span
                              className={
                                Math.abs(r.difference) <= 500
                                  ? "text-emerald-600"
                                  : "text-slate-700"
                              }
                            >
                              {r.difference > 0 ? "+" : ""}
                              {fmt.currency(r.difference)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2.5 text-right">
                          {r.percentageError != null ? `${r.percentageError}%` : "—"}
                        </td>
                        <td className="p-2.5 text-center">
                          <Badge
                            tone={
                              r.accuracyRating === "Accurate"
                                ? "green"
                                : r.accuracyRating === "Moderate"
                                ? "brand"
                                : r.accuracyRating === "Divergent"
                                ? "rose"
                                : "slate"
                            }
                          >
                            {r.accuracyRating}
                          </Badge>
                        </td>
                        <td className="p-2.5 text-slate-400">{r.modelVersion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
