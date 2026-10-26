"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import type { ReactNode } from "react";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = Boolean(
    pathname &&
      (pathname === "/login" ||
        pathname.startsWith("/login/") ||
        pathname === "/register" ||
        pathname.startsWith("/register/") ||
        pathname === "/forgot-password" ||
        pathname.startsWith("/forgot-password/")),
  );

  if (isAuthPage) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center bg-slate-950 p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-x-hidden px-6 py-6 lg:px-10">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
