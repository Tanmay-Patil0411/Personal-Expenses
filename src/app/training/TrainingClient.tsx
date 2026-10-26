"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiPost, apiPut } from "@/lib/api";
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

interface EvalData {
  targetMonth: string;
  nextForecast: number;
  evaluation: {
    actual: number[];
    predicted: number[];
    metrics: { mae: number; rmse: number; mape: number | null };
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
  datasetMode: string | null;
  datasetSource: string | null;
  dataStartDate: string | null;
  dataEndDate: string | null;
  lastTrainedAt: string | null;
  latestRun: any;
  meta: any;
  evaluation: EvalData | null;
}

interface DatasetInfo {
  hasDataset: boolean;
  dataset: {
    id: number;
    name: string;
    source: string;
    filename: string | null;
    rowCount: number;
    expenseRowCount: number;
    monthsCount: number;
    startDate: string | null;
    endDate: string | null;
    createdAt: string;
  } | null;
  recordCount: number;
  sample: any[];
}

interface ModelRun {
  id: number;
  modelVersion: string;
  datasetMode: string;
  dataStartDate: string | null;
  dataEndDate: string | null;
  trainingStart: string;
  trainingEnd: string | null;
  sequenceLength: number;
  trainingStatus: "running" | "completed" | "failed";
  errorMessage: string | null;
  mae: string | number | null;
  rmse: string | number | null;
  mape: string | number | null;
  trainSamples: number | null;
}

export default function TrainingClient({
  user,
}: {
  user?: { id: number; name: string; email: string };
}) {
  const fmt = useFormat();
  const [status, setStatus] = useState<Status | null>(null);
  const [datasetInfo, setDatasetInfo] = useState<DatasetInfo | null>(null);
  const [history, setHistory] = useState<ModelRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // External dataset upload state
  const [showUploader, setShowUploader] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [statusRes, datasetRes, historyRes] = await Promise.all([
        apiGet<Status>("/api/ml/status"),
        apiGet<DatasetInfo>("/api/training/dataset"),
        apiGet<{ runs: ModelRun[] }>("/api/ml/history").catch(() => ({
          runs: [],
        })),
      ]);
      setStatus(statusRes);
      setDatasetInfo(datasetRes);
      setHistory(historyRes.runs || []);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load training data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    Promise.all([
      apiGet<Status>("/api/ml/status"),
      apiGet<DatasetInfo>("/api/training/dataset"),
      apiGet<{ runs: ModelRun[] }>("/api/ml/history").catch(() => ({
        runs: [],
      })),
    ])
      .then(([statusRes, datasetRes, historyRes]) => {
        if (!ignore) {
          setStatus(statusRes);
          setDatasetInfo(datasetRes);
          setHistory(historyRes.runs || []);
          setError(null);
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (!ignore) {
          setError(e.message || "Failed to load training data");
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Train or Retrain Model
  async function handleTrain() {
    if (status?.hasModel) {
      const ok = confirm(
        `Model '${status.modelVersion}' is currently active. Retraining will compute updated weights from the active dataset and overwrite the existing model artifact. Continue?`,
      );
      if (!ok) return;
    }

    setTraining(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await apiPost("/api/ml/train");
      if (res.ok) {
        setSuccessMsg(
          `Training completed successfully! Target month forecast: ${res.targetMonth || "N/A"} (${fmt.currency(res.nextForecast || 0)})`,
        );
      } else {
        setError(res.error || "Training failed");
      }
      await loadAll();
    } catch (e: any) {
      setError(e.message || "Model training failed");
    } finally {
      setTraining(false);
    }
  }

  // Switch Dataset Mode (Kaggle vs User Data vs Demo)
  async function handleSwitchMode(mode: "kaggle" | "real" | "demo") {
    setSwitchingMode(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiPut("/api/settings", { datasetMode: mode });
      await loadAll();
      setSuccessMsg(
        `Switched dataset mode to '${mode === "real" ? "User Financial Records" : mode === "kaggle" ? "Kaggle External Dataset" : "Synthetic Benchmark Demo"}'. Click 'Train Model' to train with this dataset.`,
      );
    } catch (e: any) {
      setError(e.message || "Failed to update dataset mode");
    } finally {
      setSwitchingMode(false);
    }
  }

  // Upload new Kaggle / External Dataset CSV strictly into training_records
  async function handleUploadDataset(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;

    setUploading(true);
    setUploadError(null);
    try {
      const text = await uploadFile.text();
      const res = await apiPost<{
        ok: boolean;
        importedCount: number;
        dataset: any;
        summary: any;
      }>("/api/training/dataset", {
        text,
        filename: uploadFile.name,
        name: uploadFile.name.replace(/\.csv$/i, ""),
        source: "kaggle",
      });

      if (res.ok) {
        setSuccessMsg(
          `Successfully imported external training dataset (${res.importedCount} rows). Stored separately in training storage; personal transactions were not modified.`,
        );
        setShowUploader(false);
        setUploadFile(null);
        await loadAll();
      }
    } catch (e: any) {
      setUploadError(e.message || "Failed to import external dataset.");
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <Spinner label="Loading training module…" />;

  const activeMode = status?.datasetMode ?? "kaggle";
  const evalData = status?.evaluation;
  const historyData = evalData?.history;

  // Plotly Loss Curve
  const lossTraces =
    historyData && historyData.loss && historyData.loss.length > 0
      ? [
          {
            x: historyData.loss.map((_, i) => i + 1),
            y: historyData.loss,
            type: "scatter",
            mode: "lines",
            name: "Train Loss (MSE)",
            line: { color: "#6366f1", width: 2.5 },
          },
          {
            x: historyData.valLoss.map((_, i) => i + 1),
            y: historyData.valLoss,
            type: "scatter",
            mode: "lines",
            name: "Validation Loss (MSE)",
            line: { color: "#10b981", width: 2.5, dash: "dot" },
          },
        ]
      : [];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <PageHeader
        title="Model Training & Evaluation"
        subtitle="Dedicated deep learning module for managing training datasets, LSTM architecture, loss curves, and model metrics"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={handleTrain}
              disabled={training || switchingMode}
              className="btn-primary flex items-center gap-2 shadow-sm"
            >
              {training ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Training Model…</span>
                </>
              ) : (
                <>
                  <span>🏋️</span>
                  <span>{status?.hasModel ? "Retrain Model" : "Train Model"}</span>
                </>
              )}
            </button>
          </div>
        }
      />

      {/* Notifications */}
      {error && <Alert kind="error">{error}</Alert>}
      {successMsg && <Alert kind="success">{successMsg}</Alert>}

      {/* Isolation Guarantee Banner */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 text-indigo-900 shadow-xs">
        <div className="flex items-start gap-3">
          <span className="text-xl">🛡️</span>
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-indigo-950">
              Strict Training & Personal Financial Data Separation
            </h4>
            <p className="text-xs text-indigo-800 leading-relaxed">
              Model training data is stored in isolated training tables (
              <code className="rounded bg-indigo-100 px-1 py-0.5 font-mono text-[11px]">
                training_datasets
              </code>{" "}
              &amp;{" "}
              <code className="rounded bg-indigo-100 px-1 py-0.5 font-mono text-[11px]">
                training_records
              </code>
              ). Training or retraining the LSTM model will <strong>never</strong>{" "}
              inject records into your personal financial transactions or skew your
              dashboard balances.
            </p>
          </div>
        </div>
      </div>

      {/* Top Model Status KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          title="Model Status"
          value={
            <div className="flex items-center gap-2">
              <Badge
                tone={
                  status?.modelStatus === "trained"
                    ? "green"
                    : status?.modelStatus === "training"
                    ? "amber"
                    : "rose"
                }
              >
                {status?.modelStatus?.toUpperCase() || "UNTRAINED"}
              </Badge>
            </div>
          }
          subtitle={`Version: ${status?.modelVersion || "lstm-v1"}`}
          tone="indigo"
        />

        <KpiCard
          title="Active Training Source"
          value={
            activeMode === "kaggle"
              ? "Kaggle External"
              : activeMode === "real"
              ? "User Transactions"
              : "Demo Benchmark"
          }
          subtitle={
            activeMode === "kaggle"
              ? (datasetInfo?.dataset?.name || "Daily Household")
              : activeMode === "real"
              ? "PostgreSQL Personal Data"
              : "60-Month Synthetic"
          }
          tone="brand"
        />

        <KpiCard
          title="Evaluation MAE"
          value={
            evalData?.evaluation?.metrics?.mae != null
              ? fmt.currency(evalData.evaluation.metrics.mae)
              : "—"
          }
          subtitle={
            evalData?.evaluation?.metrics?.rmse != null
              ? `RMSE: ${fmt.currency(evalData.evaluation.metrics.rmse)}`
              : "Untrained"
          }
          tone="green"
        />

        <KpiCard
          title="Last Trained"
          value={
            status?.lastTrainedAt
              ? new Date(status.lastTrainedAt).toLocaleDateString()
              : "Never"
          }
          subtitle={
            status?.lastTrainedAt
              ? new Date(status.lastTrainedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Awaiting run"
          }
          tone="slate"
        />
      </div>

      {/* Dataset Selection & Details */}
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              Training Dataset Source
            </h3>
            <p className="text-xs text-slate-500">
              Configure which dataset is fed to the LSTM sequence generator
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowUploader(!showUploader)}
              className="btn-ghost text-xs border border-slate-200"
            >
              {showUploader ? "Close Uploader" : "📤 Upload New Kaggle CSV"}
            </button>
          </div>
        </div>

        {/* Source Switcher Buttons */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 mb-6">
          <div
            onClick={() => handleSwitchMode("kaggle")}
            className={`cursor-pointer rounded-xl border p-4 transition-all ${
              activeMode === "kaggle"
                ? "border-brand-500 bg-brand-50/40 shadow-xs ring-1 ring-brand-500"
                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900 text-sm">
                📦 Kaggle External Dataset
              </span>
              {activeMode === "kaggle" && <Badge tone="brand">Active Source</Badge>}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Trained on Daily Household Transactions dataset (2,461 records, 2014–2018).
              Completely isolated from your personal transactions.
            </p>
          </div>

          <div
            onClick={() => handleSwitchMode("real")}
            className={`cursor-pointer rounded-xl border p-4 transition-all ${
              activeMode === "real"
                ? "border-brand-500 bg-brand-50/40 shadow-xs ring-1 ring-brand-500"
                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900 text-sm">
                💳 Personal User Transactions
              </span>
              {activeMode === "real" && <Badge tone="brand">Active Source</Badge>}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Uses only transactions entered or imported by you in PostgreSQL.
              Requires at least 6 months of personal expense records.
            </p>
          </div>

          <div
            onClick={() => handleSwitchMode("demo")}
            className={`cursor-pointer rounded-xl border p-4 transition-all ${
              activeMode === "demo"
                ? "border-brand-500 bg-brand-50/40 shadow-xs ring-1 ring-brand-500"
                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900 text-sm">
                🧪 Synthetic Demonstration
              </span>
              {activeMode === "demo" && <Badge tone="brand">Active Source</Badge>}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              60 months of simulated realistic expenses with seasonal trends and
              inflation for algorithm benchmarking.
            </p>
          </div>
        </div>

        {/* External Dataset Uploader Drawer */}
        {showUploader && (
          <div className="mb-6 rounded-xl border border-dashed border-brand-300 bg-brand-50/30 p-5">
            <h4 className="text-sm font-semibold text-brand-900 mb-1">
              Upload External Training Dataset (CSV)
            </h4>
            <p className="text-xs text-brand-700 mb-4">
              Import a Kaggle or external expense CSV directly to model training
              storage. Records will be saved to{" "}
              <code className="font-mono text-[11px] bg-brand-100 px-1 py-0.5 rounded">
                training_records
              </code>{" "}
              and will not be added to your personal transaction history.
            </p>

            {uploadError && (
              <div className="mb-4">
                <Alert kind="error">{uploadError}</Alert>
              </div>
            )}

            <form onSubmit={handleUploadDataset} className="space-y-3">
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-brand-500"
              />
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={!uploadFile || uploading}
                  className="btn-primary text-xs flex items-center gap-2"
                >
                  {uploading ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Importing Dataset…</span>
                    </>
                  ) : (
                    <span>Import to Training Storage</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowUploader(false)}
                  className="btn-ghost text-xs"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Dataset Metadata Details */}
        {datasetInfo?.hasDataset && datasetInfo.dataset && (
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
              Active Dataset Metadata ({datasetInfo.dataset.name})
            </h4>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
              <div>
                <p className="text-slate-400">Total Rows</p>
                <p className="text-sm font-semibold text-slate-800">
                  {datasetInfo.dataset.rowCount.toLocaleString()} records
                </p>
              </div>
              <div>
                <p className="text-slate-400">Expense Records</p>
                <p className="text-sm font-semibold text-slate-800">
                  {datasetInfo.dataset.expenseRowCount.toLocaleString()} expenses
                </p>
              </div>
              <div>
                <p className="text-slate-400">Date Range</p>
                <p className="text-sm font-semibold text-slate-800">
                  {datasetInfo.dataset.startDate || "N/A"} →{" "}
                  {datasetInfo.dataset.endDate || "N/A"}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Monthly Coverage</p>
                <p className="text-sm font-semibold text-slate-800">
                  {datasetInfo.dataset.monthsCount} distinct months
                </p>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Preprocessing & Sequence Architecture */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h3 className="text-base font-semibold text-slate-800 mb-3">
            Preprocessing &amp; LSTM Architecture
          </h3>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between border-b border-slate-100 py-1.5">
              <span className="text-slate-500">Lookback Sequence</span>
              <span className="font-semibold text-slate-800">
                {status?.meta?.sequenceLength || 6} months
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1.5">
              <span className="text-slate-500">Target Horizon</span>
              <span className="font-semibold text-slate-800">1 month ahead</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1.5">
              <span className="text-slate-500">Normalization</span>
              <span className="font-semibold text-slate-800">MinMaxScaler [0, 1]</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1.5">
              <span className="text-slate-500">LSTM Hidden Units</span>
              <span className="font-semibold text-slate-800">32 units (tanh)</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1.5">
              <span className="text-slate-500">Dense Output Layer</span>
              <span className="font-semibold text-slate-800">1 unit (linear)</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1.5">
              <span className="text-slate-500">Optimizer &amp; Loss</span>
              <span className="font-semibold text-slate-800">Adam (MSE loss)</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1.5">
              <span className="text-slate-500">Training Epochs</span>
              <span className="font-semibold text-slate-800">80 epochs</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-slate-500">Batch Size</span>
              <span className="font-semibold text-slate-800">8 batches</span>
            </div>
          </div>
        </Card>

        {/* Training Loss Curve */}
        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-800">
              Training &amp; Validation Loss Curves
            </h3>
            {evalData?.history?.loss && (
              <span className="text-xs text-slate-400">
                {evalData.history.loss.length} epochs recorded
              </span>
            )}
          </div>
          {lossTraces.length === 0 ? (
            <EmptyState>
              No training loss history available yet. Click &apos;Train Model&apos; above
              to train the LSTM network.
            </EmptyState>
          ) : (
            <PlotlyChart
              data={lossTraces}
              layout={{
                xaxis: { title: "Epoch" },
                yaxis: { title: "Mean Squared Error (MSE)" },
              }}
            />
          )}
        </Card>
      </div>

      {/* Model vs Baseline Evaluation Comparison */}
      {evalData && (
        <Card>
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-800">
              Test Set Evaluation &amp; Baseline Benchmarks
            </h3>
            <p className="text-xs text-slate-500">
              Performance metrics calculated on the unseen test split (
              {evalData.testMonths} test months)
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left font-semibold uppercase text-slate-500">
                  <th className="py-2.5">Model / Strategy</th>
                  <th>MAE</th>
                  <th>RMSE</th>
                  <th>MAPE</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-brand-50/40 font-semibold text-slate-900">
                  <td className="py-2.5 flex items-center gap-1.5">
                    <span>🧠</span>
                    <span>LSTM Deep Learning (Active)</span>
                  </td>
                  <td className="text-emerald-700">
                    {fmt.currency(evalData.evaluation.metrics.mae)}
                  </td>
                  <td className="text-emerald-700">
                    {fmt.currency(evalData.evaluation.metrics.rmse)}
                  </td>
                  <td>
                    {evalData.evaluation.metrics.mape != null
                      ? fmt.pct(evalData.evaluation.metrics.mape)
                      : "—"}
                  </td>
                  <td>
                    <Badge tone="green">Primary</Badge>
                  </td>
                </tr>

                {evalData.baselines?.map((b) => (
                  <tr key={b.name} className="text-slate-600">
                    <td className="py-2">{b.name}</td>
                    <td>{fmt.currency(b.metrics.mae)}</td>
                    <td>{fmt.currency(b.metrics.rmse)}</td>
                    <td>
                      {b.metrics.mape != null ? fmt.pct(b.metrics.mape) : "—"}
                    </td>
                    <td>
                      <Badge tone="slate">Baseline</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Training History Table */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              Training History &amp; Run Log
            </h3>
            <p className="text-xs text-slate-500">
              Historical record of model training runs, dataset sources, and outcomes
            </p>
          </div>
        </div>

        {history.length === 0 ? (
          <EmptyState>No previous training runs found.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left font-semibold uppercase text-slate-500">
                  <th className="py-2.5">Run ID</th>
                  <th>Timestamp</th>
                  <th>Version</th>
                  <th>Source Mode</th>
                  <th>Status</th>
                  <th>Test MAE</th>
                  <th>Test RMSE</th>
                  <th>Error / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 font-mono text-slate-500">#{run.id}</td>
                    <td className="text-slate-600">
                      {new Date(run.trainingStart).toLocaleString()}
                    </td>
                    <td className="font-semibold text-slate-800">
                      {run.modelVersion}
                    </td>
                    <td>
                      <Badge
                        tone={
                          run.datasetMode === "kaggle"
                            ? "brand"
                            : run.datasetMode === "real"
                            ? "amber"
                            : "slate"
                        }
                      >
                        {run.datasetMode}
                      </Badge>
                    </td>
                    <td>
                      <Badge
                        tone={
                          run.trainingStatus === "completed"
                            ? "green"
                            : run.trainingStatus === "running"
                            ? "amber"
                            : "rose"
                        }
                      >
                        {run.trainingStatus}
                      </Badge>
                    </td>
                    <td className="font-mono">
                      {run.mae ? fmt.currency(Number(run.mae)) : "—"}
                    </td>
                    <td className="font-mono">
                      {run.rmse ? fmt.currency(Number(run.rmse)) : "—"}
                    </td>
                    <td className="max-w-[200px] truncate text-slate-500">
                      {run.errorMessage || "Completed without errors"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Sample Training Records Preview */}
      {datasetInfo?.sample && datasetInfo.sample.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-800">
                Sample Training Records Preview
              </h3>
              <p className="text-xs text-slate-500">
                First 10 records from the isolated training table (
                <code className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded">
                  training_records
                </code>
                )
              </p>
            </div>
            <span className="text-xs text-slate-400">
              Showing 10 of {datasetInfo.recordCount.toLocaleString()}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left font-semibold uppercase text-slate-500">
                  <th className="py-2">Date</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Payment Method</th>
                  <th>Description</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {datasetInfo.sample.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="py-2 font-mono text-slate-600">
                      {fmt.date(r.transactionDate)}
                    </td>
                    <td className="text-slate-700">{r.category}</td>
                    <td>
                      <Badge tone={r.transactionType === "Income" ? "green" : "rose"}>
                        {r.transactionType}
                      </Badge>
                    </td>
                    <td className="text-slate-500">{r.paymentMethod}</td>
                    <td className="max-w-[200px] truncate text-slate-500">
                      {r.description || "—"}
                    </td>
                    <td className="text-right font-medium text-slate-800">
                      {fmt.currency(Number(r.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
