"use client";

import { useState } from "react";
import { apiPost } from "@/lib/api";
import { Alert, Card, EmptyState, Spinner } from "@/components/ui";

interface ValidationResult {
  total: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  errors: { row: number; reason: string }[];
  duplicateRows: number[];
}

export default function CsvImport({ onImported }: { onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState<string>("");
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

  async function handleFile(f: File) {
    setFile(f);
    setMsg(null);
    setResult(null);
    const content = await f.text();
    setText(content);
    setLoading(true);
    try {
      const res = await apiPost<{ ok: boolean; result: ValidationResult }>(
        "/api/csv/validate",
        { text: content },
      );
      setResult(res.result);
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function doImport() {
    if (!text) return;
    setImporting(true);
    setMsg(null);
    try {
      const res = await apiPost<{ ok: boolean; imported: number; invalid: number; duplicates: number; failures: string[] }>(
        "/api/csv/import",
        { text },
      );
      setMsg({
        kind: "success",
        text: `Imported ${res.imported} rows. ${res.invalid} invalid, ${res.duplicates} duplicates skipped.`,
      });
      setResult(null);
      setFile(null);
      setText("");
      onImported();
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message });
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">
        Import from CSV
      </h3>
      <p className="mb-3 text-xs text-slate-500">
        Upload a CSV with columns: transaction_date, transaction_type, amount,
        category, payment_method, description, external_transaction_id. Rows are
        validated and duplicates are detected before import.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          className="input w-auto"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <a className="btn-ghost" href="/api/csv/template" download>
          Download template
        </a>
      </div>

      {loading && <div className="mt-3"><Spinner label="Validating…" /></div>}
      {msg && (
        <div className="mt-3">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}

      {result && !loading && (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total rows" value={result.total} />
            <Stat label="Valid" value={result.validCount} tone="green" />
            <Stat label="Invalid" value={result.invalidCount} tone="rose" />
            <Stat label="Duplicates" value={result.duplicateCount} tone="amber" />
          </div>

          {result.errors.length > 0 && (
            <div className="mt-3 max-h-48 overflow-auto rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <p className="mb-1 font-semibold">Rejected rows</p>
              <ul className="space-y-0.5">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.validCount > 0 ? (
            <div className="mt-4 flex items-center gap-3">
              <button
                className="btn-primary"
                disabled={importing}
                onClick={doImport}
              >
                {importing ? "Importing…" : `Import ${result.validCount} valid rows`}
              </button>
              <span className="text-xs text-slate-500">
                Invalid/duplicate rows are skipped, not silently discarded.
              </span>
            </div>
          ) : (
            <div className="mt-3">
              <EmptyState>No valid rows to import.</EmptyState>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "green" | "rose" | "amber";
}) {
  const color =
    tone === "green"
      ? "text-emerald-600"
      : tone === "rose"
        ? "text-rose-600"
        : tone === "amber"
          ? "text-amber-600"
          : "text-slate-700";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}
