"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
} from "@/components/ui";
import CsvImport from "@/components/CsvImport";

interface Tx {
  id: number;
  transactionDate: string;
  transactionType: "Income" | "Expense";
  amount: number;
  category: string;
  paymentMethod: string;
  description: string | null;
}

export default function TransactionsPage() {
  const fmt = useFormat();
  const [cats, setCats] = useState<any>(null);
  const [txns, setTxns] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [filters, setFilters] = useState({
    search: "",
    type: "",
    category: "",
    paymentMethod: "",
    startDate: "",
    endDate: "",
    sortBy: "date",
    sortDir: "desc",
  });

  const [form, setForm] = useState({
    id: null as number | null,
    transactionDate: new Date().toISOString().slice(0, 10),
    transactionType: "Expense" as "Income" | "Expense",
    amount: "",
    category: "",
    paymentMethod: "",
    description: "",
    externalTransactionId: "",
  });

  useEffect(() => {
    apiGet("/api/categories")
      .then((c) => {
        setCats(c);
        setForm((f) => ({
          ...f,
          category: f.category || (f.transactionType === "Income" ? c.incomeCategories[0] : c.expenseCategories[0]),
          paymentMethod: f.paymentMethod || c.paymentMethods[0],
        }));
      })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    return apiGet<{ transactions: Tx[] }>(
      `/api/transactions?${qs.toString()}`,
    );
  }, [filters]);

  useEffect(() => {
    let ignore = false;
    load()
      .then((res) => {
        if (!ignore) {
          setTxns(res.transactions);
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (!ignore) {
          setMsg({ kind: "error", text: e.message });
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
        setTxns(res.transactions);
      })
      .catch((e: any) => {
        setMsg({ kind: "error", text: e.message });
      })
      .finally(() => {
        setLoading(false);
      });
  };

  function resetForm() {
    setForm({
      id: null,
      transactionDate: new Date().toISOString().slice(0, 10),
      transactionType: "Expense",
      amount: "",
      category: cats?.expenseCategories[0] ?? "",
      paymentMethod: cats?.paymentMethods[0] ?? "",
      description: "",
      externalTransactionId: "",
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const payload = {
      ...form,
      amount: Number(form.amount),
      description: form.description?.trim() || null,
      externalTransactionId: form.externalTransactionId?.trim() || null,
    };
    try {
      if (form.id) {
        await apiPut(`/api/transactions/${form.id}`, payload);
        setMsg({ kind: "success", text: "Transaction updated." });
      } else {
        await apiPost("/api/transactions", payload);
        setMsg({ kind: "success", text: "Transaction added." });
      }
      resetForm();
      load();
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message });
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this transaction? This cannot be undone.")) return;
    try {
      await apiDelete(`/api/transactions/${id}`);
      setMsg({ kind: "success", text: "Transaction deleted." });
      load();
    } catch (e: any) {
      setMsg({ kind: "error", text: e.message });
    }
  }

  function edit(t: Tx) {
    setForm({
      id: t.id,
      transactionDate: t.transactionDate,
      transactionType: t.transactionType,
      amount: String(t.amount),
      category: t.category,
      paymentMethod: t.paymentMethod,
      description: t.description ?? "",
      externalTransactionId: "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const categoryList =
    form.transactionType === "Income"
      ? cats?.incomeCategories ?? []
      : cats?.expenseCategories ?? [];

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle="Add, filter, edit and import income & expense records"
      />

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            {form.id ? "Edit Transaction" : "Add Transaction"}
          </h3>
          {!cats ? (
            <Spinner label="Loading options…" />
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="label">Date</label>
                <input
                  type="date"
                  className="input"
                  required
                  value={form.transactionDate}
                  onChange={(e) =>
                    setForm({ ...form, transactionDate: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">Type</label>
                <select
                  className="input"
                  value={form.transactionType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      transactionType: e.target.value as "Income" | "Expense",
                      category:
                        e.target.value === "Income"
                          ? cats.incomeCategories[0]
                          : cats.expenseCategories[0],
                    })
                  }
                >
                  <option>Income</option>
                  <option>Expense</option>
                </select>
              </div>
              <div>
                <label className="label">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="input"
                  required
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Category</label>
                <select
                  className="input"
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                >
                  {categoryList.map((c: string) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Payment Method</label>
                <select
                  className="input"
                  value={form.paymentMethod}
                  onChange={(e) =>
                    setForm({ ...form, paymentMethod: e.target.value })
                  }
                >
                  {cats.paymentMethods.map((m: string) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Description</label>
                <input
                  className="input"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">
                  External ID (optional, for dedupe)
                </label>
                <input
                  className="input"
                  value={form.externalTransactionId}
                  onChange={(e) =>
                    setForm({ ...form, externalTransactionId: e.target.value })
                  }
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary">
                  {form.id ? "Update" : "Add"}
                </button>
                {form.id && (
                  <button type="button" className="btn-ghost" onClick={resetForm}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              Filters
            </h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div className="col-span-2 md:col-span-1">
                <label className="label">Search</label>
                <input
                  className="input"
                  placeholder="Description / merchant"
                  value={filters.search}
                  onChange={(e) =>
                    setFilters({ ...filters, search: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">Type</label>
                <select
                  className="input"
                  value={filters.type}
                  onChange={(e) =>
                    setFilters({ ...filters, type: e.target.value })
                  }
                >
                  <option value="">All</option>
                  <option>Income</option>
                  <option>Expense</option>
                </select>
              </div>
              <div>
                <label className="label">Category</label>
                <select
                  className="input"
                  value={filters.category}
                  onChange={(e) =>
                    setFilters({ ...filters, category: e.target.value })
                  }
                >
                  <option value="">All</option>
                  {cats?.expenseCategories.map((c: string) => (
                    <option key={c}>{c}</option>
                  ))}
                  {cats?.incomeCategories.map((c: string) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Method</label>
                <select
                  className="input"
                  value={filters.paymentMethod}
                  onChange={(e) =>
                    setFilters({ ...filters, paymentMethod: e.target.value })
                  }
                >
                  <option value="">All</option>
                  {cats?.paymentMethods.map((m: string) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">From</label>
                <input
                  type="date"
                  className="input"
                  value={filters.startDate}
                  onChange={(e) =>
                    setFilters({ ...filters, startDate: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">To</label>
                <input
                  type="date"
                  className="input"
                  value={filters.endDate}
                  onChange={(e) =>
                    setFilters({ ...filters, endDate: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="label mr-1">Sort</label>
              <select
                className="input w-auto"
                value={filters.sortBy}
                onChange={(e) =>
                  setFilters({ ...filters, sortBy: e.target.value })
                }
              >
                <option value="date">Date</option>
                <option value="amount">Amount</option>
              </select>
              <select
                className="input w-auto"
                value={filters.sortDir}
                onChange={(e) =>
                  setFilters({ ...filters, sortDir: e.target.value })
                }
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
              <button className="btn-ghost" onClick={load}>
                Apply
              </button>
              <a
                className="btn-ghost"
                href={`/api/csv/export?${new URLSearchParams(
                  Object.entries(filters).filter(([, v]) => v) as [string, string][],
                ).toString()}`}
              >
                Export CSV
              </a>
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              Transaction History ({txns.length})
            </h3>
            {loading ? (
              <Spinner label="Loading…" />
            ) : txns.length === 0 ? (
              <EmptyState>No transactions match your filters.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                      <th className="py-2">Date</th>
                      <th>Type</th>
                      <th>Category</th>
                      <th>Method</th>
                      <th>Description</th>
                      <th className="text-right">Amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((t) => (
                      <tr key={t.id} className="border-b border-slate-100">
                        <td className="py-2">{fmt.date(t.transactionDate)}</td>
                        <td>
                          <Badge
                            tone={t.transactionType === "Income" ? "green" : "rose"}
                          >
                            {t.transactionType}
                          </Badge>
                        </td>
                        <td>{t.category}</td>
                        <td>{t.paymentMethod}</td>
                        <td className="max-w-[200px] truncate text-slate-500">
                          {t.description || "—"}
                        </td>
                        <td
                          className={`text-right font-medium ${
                            t.transactionType === "Income"
                              ? "text-emerald-600"
                              : "text-rose-600"
                          }`}
                        >
                          {fmt.currency(t.amount)}
                        </td>
                        <td className="text-right">
                          <button
                            className="text-xs text-brand-600 hover:underline"
                            onClick={() => edit(t)}
                          >
                            Edit
                          </button>{" "}
                          <button
                            className="text-xs text-rose-600 hover:underline"
                            onClick={() => remove(t.id)}
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
      </div>

      <div className="mt-4">
        <CsvImport onImported={load} />
      </div>
    </div>
  );
}
