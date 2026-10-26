"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPut, apiPost } from "@/lib/api";
import { Card, PageHeader, KpiCard, Spinner, Alert } from "@/components/ui";
import { useFormat } from "@/lib/useFormat";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "CAD", "AUD", "JPY"];

export default function SettingsPage() {
  const fmt = useFormat();
  const [settings, setSettings] = useState<any>(null);
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [training, setTraining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "warning"; text: string } | null>(null);

  async function loadData() {
    try {
      const [s, ml, tx] = await Promise.all([
        apiGet("/api/settings"),
        apiGet("/api/ml/status"),
        apiGet("/api/transactions"),
      ]);
      setSettings(s);
      setInfo({ ml, txCount: tx.count });
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      apiGet("/api/settings"),
      apiGet("/api/ml/status"),
      apiGet("/api/transactions"),
    ])
      .then(([s, ml, tx]) => {
        if (active) {
          setSettings(s);
          setInfo({ ml, txCount: tx.count });
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (active) {
          setMsg({ kind: "error", text: e.message });
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function update(field: string, value: any) {
    setSettings((prev: any) => ({ ...prev, [field]: value }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiPut("/api/settings", settings);
      setSettings(res.settings);
      setMsg({ kind: "success", text: "Settings saved successfully." });
      await loadData();
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleTrainModel() {
    if (info?.ml?.hasModel) {
      const ok = confirm(
        `Model '${info.ml.modelVersion}' is currently trained and functional. Are you sure you want to retrain and replace it?`,
      );
      if (!ok) return;
    }

    setTraining(true);
    setMsg(null);
    try {
      const res = await apiPost("/api/ml/train", {
        datasetMode: settings?.datasetMode,
      });
      if (res.ok) {
        setMsg({
          kind: "success",
          text: `LSTM model trained successfully using ${res.datasetMode ?? settings.datasetMode} data (${res.monthsUsed} months). Next month forecast: ${fmt.currency(res.nextForecast)}.`,
        });
      } else if (res.insufficient) {
        setMsg({
          kind: "warning",
          text: res.error || "Insufficient data for training.",
        });
      } else {
        setMsg({
          kind: "error",
          text: `Training failed: ${res.error}`,
        });
      }
      await loadData();
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message || "Failed to train model." });
    } finally {
      setTraining(false);
    }
  }

  async function generateSample() {
    if (
      !confirm(
        "Generate 60 months (5 years) of synthetic demonstration data? This will clear current transactions for this account and populate high-quality test data.",
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiPost("/api/settings/seed", { months: 60, seed: 42 });
      setMsg({
        kind: "success",
        text: `Generated ${res.inserted} synthetic transactions across ${res.months} months. Dataset mode switched to 'demo'.`,
      });
      await loadData();
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function resetAll() {
    if (
      !confirm(
        "DANGER: This permanently deletes ALL your transactions and budgets. Continue?",
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      await apiPost("/api/settings/reset");
      setMsg({ kind: "success", text: "All your transactions and budgets have been cleared." });
      await loadData();
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !settings) return <Spinner label="Loading settings…" />;

  const ml = info?.ml;
  const modelStatus = ml?.modelStatus ?? "untrained";
  const statusTone =
    modelStatus === "trained"
      ? "green"
      : modelStatus === "training"
      ? "brand"
      : modelStatus === "error"
      ? "rose"
      : "amber";

  return (
    <div>
      <PageHeader
        title="Settings & Data"
        subtitle="Preferences, dataset mode and model management"
        action={
          <div className="flex gap-2">
            <button
              className="btn-primary"
              onClick={handleTrainModel}
              disabled={training || busy}
            >
              {training
                ? "Training Model…"
                : ml?.hasModel
                ? "Retrain Model"
                : "Train Model"}
            </button>
          </div>
        }
      />

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard title="Transactions" value={info?.txCount ?? 0} tone="slate" />
        <KpiCard
          title="Dataset Mode"
          value={
            settings?.datasetMode === "kaggle"
              ? "Kaggle (External)"
              : settings?.datasetMode === "demo"
              ? "Demo (Synthetic)"
              : "Real (Database)"
          }
          tone="brand"
        />
        <KpiCard
          title="Model Artifacts"
          value={ml?.hasModel ? "present (verified)" : "none"}
          tone={ml?.hasModel ? "green" : "amber"}
        />
        <KpiCard
          title="Model Status"
          value={modelStatus.toUpperCase()}
          tone={statusTone}
        />
      </div>

      {ml?.hasModel && (
        <Card className="mt-4 border-emerald-500/30 bg-emerald-500/5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-emerald-950">
                Active Saved Model Details
              </h3>
              <p className="text-xs text-emerald-800">
                Weights and parameters verified and cached in memory
              </p>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              ✓ Ready for Live Predictions
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
            <div>
              <span className="text-slate-500">Model Version:</span>
              <p className="font-semibold text-slate-800">{ml.modelVersion ?? "—"}</p>
            </div>
            <div>
              <span className="text-slate-500">Training Dataset Mode:</span>
              <p className="font-semibold text-slate-800 uppercase">{ml.datasetMode ?? "—"}</p>
            </div>
            <div>
              <span className="text-slate-500">Training Data Range:</span>
              <p className="font-semibold text-slate-800">
                {ml.dataStartDate && ml.dataEndDate
                  ? `${ml.dataStartDate.slice(0, 7)} → ${ml.dataEndDate.slice(0, 7)}`
                  : "—"}
              </p>
            </div>
            <div>
              <span className="text-slate-500">Last Trained:</span>
              <p className="font-semibold text-slate-800">
                {ml.lastTrainedAt ? new Date(ml.lastTrainedAt).toLocaleString() : "—"}
              </p>
            </div>
            {ml.latestRun?.mae != null && (
              <div>
                <span className="text-slate-500">Test MAE:</span>
                <p className="font-semibold text-slate-800">{fmt.currency(ml.latestRun.mae)}</p>
              </div>
            )}
            {ml.latestRun?.rmse != null && (
              <div>
                <span className="text-slate-500">Test RMSE:</span>
                <p className="font-semibold text-slate-800">{fmt.currency(ml.latestRun.rmse)}</p>
              </div>
            )}
            {ml.latestRun?.mape != null && (
              <div>
                <span className="text-slate-500">Test MAPE:</span>
                <p className="font-semibold text-slate-800">{ml.latestRun.mape.toFixed(1)}%</p>
              </div>
            )}
            {ml.targetMonth && (
              <div>
                <span className="text-slate-500">Next Target Month:</span>
                <p className="font-semibold text-slate-800">{ml.targetMonth}</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {!ml?.hasModel && (
        <Card className="mt-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-amber-950">
                Model Status: Untrained
              </h3>
              <p className="text-xs text-amber-800">
                No active trained LSTM weights found on disk for this account
              </p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              Needs Training
            </span>
          </div>

          <div className="mt-3 text-xs text-slate-700 space-y-2">
            <p className="leading-relaxed">
              {ml?.insufficientReason || (
                settings?.datasetMode === "real"
                  ? `Your personal database currently contains ${info?.txCount ?? 0} transaction(s). An LSTM deep learning model requires at least ${ml?.requiredMonths ?? 13} distinct monthly observations (sequence lookback of 6 months + 3 validation + 3 testing months + target) to build chronological training sequences.`
                  : `Please click "Train Model" to train the LSTM forecaster with the selected ${settings?.datasetMode ?? "kaggle"} dataset.`
              )}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4 rounded-lg bg-amber-500/10 p-3">
              <div>
                <span className="text-slate-500">Configured Mode:</span>
                <p className="font-semibold text-slate-800 uppercase">{settings?.datasetMode ?? "real"}</p>
              </div>
              <div>
                <span className="text-slate-500">Available Months:</span>
                <p className="font-semibold text-slate-800">
                  {ml?.availableMonths ?? (settings?.datasetMode === "real" ? 1 : 46)} month(s)
                </p>
              </div>
              <div>
                <span className="text-slate-500">Required Minimum:</span>
                <p className="font-semibold text-slate-800">{ml?.requiredMonths ?? 13} months</p>
              </div>
              <div>
                <span className="text-slate-500">Training Feasible:</span>
                <p className={`font-semibold ${(ml?.canTrain ?? (settings?.datasetMode !== "real")) ? "text-emerald-700" : "text-amber-700"}`}>
                  {(ml?.canTrain ?? (settings?.datasetMode !== "real")) ? "✓ Yes (Ready to Train)" : "✗ Need More Data"}
                </p>
              </div>
            </div>

            {settings?.datasetMode === "real" && (
              <div className="mt-3 flex flex-wrap items-center gap-3 pt-2">
                <span className="text-slate-600 font-medium">Quick options to train right now:</span>
                <button
                  type="button"
                  onClick={async () => {
                    update("datasetMode", "kaggle");
                    await apiPut("/api/settings", { datasetMode: "kaggle" });
                    setMsg({ kind: "success", text: "Switched to Kaggle External Dataset (46 months available). Click 'Train Model' now to train." });
                    await loadData();
                  }}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors shadow-xs"
                >
                  Switch to Kaggle Dataset (46 mos)
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    update("datasetMode", "demo");
                    await apiPut("/api/settings", { datasetMode: "demo" });
                    setMsg({ kind: "success", text: "Switched to Demo Benchmark Mode (60 months synthetic data). Click 'Train Model' now to train." });
                    await loadData();
                  }}
                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600 transition-colors shadow-xs"
                >
                  Switch to Demo Benchmark (60 mos)
                </button>
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            Display & Dataset Preferences
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Currency</label>
              <select
                className="input"
                value={settings?.currency ?? "USD"}
                onChange={(e) => update("currency", e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Locale</label>
              <input
                className="input"
                value={settings?.locale ?? "en-US"}
                onChange={(e) => update("locale", e.target.value)}
              >
              </input>
            </div>
            <div>
              <label className="label">Budget Warning (%)</label>
              <input
                type="number"
                className="input"
                value={settings?.warningThreshold ?? 80}
                onChange={(e) => update("warningThreshold", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Dataset Mode</label>
              <select
                className="input"
                value={settings?.datasetMode ?? "kaggle"}
                onChange={(e) => update("datasetMode", e.target.value)}
              >
                <option value="kaggle">Kaggle (External Dataset)</option>
                <option value="real">Real (PostgreSQL Personal Records)</option>
                <option value="demo">Demo (Synthetic Benchmark)</option>
              </select>
            </div>
          </div>
          <button className="btn-primary mt-4" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Preferences"}
          </button>
        </Card>

        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            LSTM Training Configuration
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Sequence Length (months)</label>
              <input
                type="number"
                className="input"
                value={settings?.sequenceLength ?? 6}
                onChange={(e) => update("sequenceLength", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Epochs</label>
              <input
                type="number"
                className="input"
                value={settings?.epochs ?? 80}
                onChange={(e) => update("epochs", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Batch Size</label>
              <input
                type="number"
                className="input"
                value={settings?.batchSize ?? 8}
                onChange={(e) => update("batchSize", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Validation Months</label>
              <input
                type="number"
                className="input"
                value={settings?.valMonths ?? 3}
                onChange={(e) => update("valMonths", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Test Months</label>
              <input
                type="number"
                className="input"
                value={settings?.testMonths ?? 3}
                onChange={(e) => update("testMonths", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Model Version</label>
              <input
                className="input"
                value={settings?.modelVersion ?? "lstm-v1"}
                onChange={(e) => update("modelVersion", e.target.value)}
              />
            </div>
          </div>
          <button className="btn-primary mt-4" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Training Config"}
          </button>
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Data Management</h3>
          <p className="mb-3 text-xs text-slate-500">
            Demo mode generates reproducible synthetic transactions for experimentation.
            Real mode uses your manually entered or imported records.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={generateSample} disabled={busy}>
              {busy ? "Working…" : "Generate sample dataset"}
            </button>
            <a className="btn-ghost" href="/api/csv/template" download>
              Download CSV template
            </a>
          </div>
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Danger Zone</h3>
          <p className="mb-3 text-xs text-slate-500">
            Resetting permanently deletes all transactions and budgets. This cannot be
            undone and is protected by confirmation.
          </p>
          <button className="btn-danger" onClick={resetAll} disabled={busy}>
            Reset all data
          </button>
        </Card>
      </div>
    </div>
  );
}
