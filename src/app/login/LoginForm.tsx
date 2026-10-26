"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiPost } from "@/lib/api";

interface LoginFormProps {
  currentUser?: { id: number; name: string; email: string } | null;
}

export default function LoginForm({ currentUser }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setLoading(true);
    try {
      await apiPost("/api/auth/login", { email, password });
      window.location.href = redirectPath;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign in.");
      setLoading(false);
    }
  }

  async function handleSignOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await apiPost("/api/auth/logout");
      window.location.href = "/login";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign out.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-md">
      {/* Brand Header */}
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-2xl font-bold text-white shadow-lg shadow-brand-500/20">
          ₿
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {currentUser ? "Switch Account or Sign In" : "Welcome Back"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {currentUser
            ? "Sign in to another account or return to your dashboard"
            : "Sign in to your Expense DL analytics account"}
        </p>
      </div>

      {currentUser && (
        <div className="mb-6 rounded-xl border border-brand-500/30 bg-brand-500/10 p-4 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="font-semibold text-white">Currently Signed In</p>
              <p className="mt-0.5 text-slate-300 font-medium">
                {currentUser.name} <span className="text-slate-400">({currentUser.email})</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={redirectPath !== "/login" ? redirectPath : "/"}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 transition-colors shadow-sm"
              >
                Go to Dashboard →
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={loggingOut}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-rose-950/70 hover:text-rose-300 transition-colors border border-slate-700"
              >
                {loggingOut ? "Signing out..." : "Sign Out"}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3.5 text-sm text-rose-300">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="name@example.com"
            className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-4 py-2.5 pr-11 text-sm text-white placeholder-slate-500 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors text-sm"
              tabIndex={-1}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          )}
          <span>{loading ? "Signing in..." : "Sign In"}</span>
        </button>
      </form>

      <div className="mt-8 border-t border-slate-800 pt-6 text-center text-sm text-slate-400">
        Don&apos;t have an account?{" "}
        <Link
          href={`/register${redirectPath !== "/" ? `?redirect=${encodeURIComponent(redirectPath)}` : ""}`}
          className="font-semibold text-brand-400 hover:text-brand-300 transition-colors"
        >
          Create account
        </Link>
      </div>
    </div>
  );
}
