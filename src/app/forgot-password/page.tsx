"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiPost, apiGet } from "@/lib/api";

function ForgotPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("token");

  const [step, setStep] = useState<"request" | "reset">(
    tokenParam ? "reset" : "request",
  );
  const [email, setEmail] = useState("");
  const [token, setToken] = useState(tokenParam || "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);

  async function handleRequestToken(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const res = await apiPost("/api/auth/forgot-password", { email });
      setSuccess(res.message);
      if (res.resetToken) {
        setGeneratedToken(res.resetToken);
        setToken(res.resetToken);
      }
      setStep("reset");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to request password reset.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token.trim()) {
      setError("Please provide the reset token.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await apiPost("/api/auth/reset-password", {
        token: token.trim(),
        newPassword,
      });
      setSuccess(res.message || "Password successfully reset! Redirecting to login...");
      setTimeout(() => {
        router.push("/login");
      }, 1500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reset password.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-md">
      {/* Brand Header */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-2xl font-bold text-white shadow-lg shadow-brand-500/20">
          ₿
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {step === "request" ? "Reset Password" : "Enter New Password"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {step === "request"
            ? "Enter your email to receive a password reset code"
            : "Set a new secure password for your account"}
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3.5 text-sm text-rose-300">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {success && (
        <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-sm text-emerald-300">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{success}</span>
          </div>
        </div>
      )}

      {step === "request" ? (
        <form onSubmit={handleRequestToken} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">
              Account Email
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

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            <span>{loading ? "Generating reset token..." : "Continue"}</span>
          </button>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} className="space-y-4">
          {generatedToken && (
            <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 p-3 text-xs text-brand-300">
              <span className="font-semibold">Security Token Generated:</span>
              <p className="mt-1 font-mono break-all text-[11px] text-slate-200">
                {generatedToken}
              </p>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">
              Reset Token
            </label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              placeholder="Paste security reset token"
              className="w-full font-mono rounded-lg border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs text-white placeholder-slate-500 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">
              New Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="At least 8 characters"
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

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">
              Confirm New Password
            </label>
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="Repeat new password"
              className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            <span>{loading ? "Updating password..." : "Set New Password"}</span>
          </button>

          <button
            type="button"
            onClick={() => setStep("request")}
            className="w-full text-center text-xs text-slate-400 hover:text-slate-200 transition-colors py-1"
          >
            ← Request a different token
          </button>
        </form>
      )}

      <div className="mt-8 border-t border-slate-800 pt-6 text-center text-sm text-slate-400">
        Remember your password?{" "}
        <Link
          href="/login"
          className="font-semibold text-brand-400 hover:text-brand-300 transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-8 text-slate-400">
          Loading reset form...
        </div>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}
