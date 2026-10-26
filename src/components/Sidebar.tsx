"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";

const NAV = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/transactions", label: "Transactions", icon: "💳" },
  { href: "/analytics", label: "Expense Analytics", icon: "📈" },
  { href: "/prediction", label: "Spending Prediction", icon: "🧠" },
  { href: "/training", label: "Model Training", icon: "🏋️" },
  { href: "/budgets", label: "Budget Management", icon: "🎯" },
  { href: "/insights", label: "Smart Insights", icon: "💡" },
  { href: "/reports", label: "Reports", icon: "📄" },
  { href: "/settings", label: "Settings & Data", icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [user, setUser] = useState<{ id: number; name: string; email: string } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;
    apiGet("/api/auth/me")
      .then((res) => {
        if (active && res && res.user) {
          setUser(res.user);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await apiPost("/api/auth/logout");
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-[#0f172a] text-slate-200">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-lg font-bold text-white shadow-sm">
          ₿
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight text-white">
            Expense DL
          </p>
          <p className="text-[11px] text-slate-400">LSTM Forecasting</p>
        </div>
      </div>
      <nav className="sidebar-scroll flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-brand-600 text-white shadow-xs"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User profile / Auth status */}
      <div className="border-t border-slate-800/80 bg-slate-900/40 p-3">
        {user ? (
          <div>
            <div className="mb-2.5 flex items-center gap-2.5 px-1.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white uppercase shadow-xs">
                {user.name.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white">{user.name}</p>
                <p className="truncate text-[11px] text-slate-400">{user.email}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link
                href="/login"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800/80 px-2 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                title="Switch account"
              >
                <span>🔄</span>
                <span>Switch</span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800/80 px-2 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-rose-950/60 hover:text-rose-300 transition-colors"
              >
                <span>🚪</span>
                <span>{loggingOut ? "..." : "Sign Out"}</span>
              </button>
            </div>
          </div>
        ) : (
          <div>
            <Link
              href="/login"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-500 transition-colors"
            >
              <span>🔑</span>
              <span>Sign In / Login</span>
            </Link>
          </div>
        )}
      </div>

      <div className="px-5 py-3 text-[11px] leading-relaxed text-slate-500 border-t border-slate-800/50">
        AIDS Mini Project · Deep Learning
      </div>
    </aside>
  );
}
