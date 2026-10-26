"use client";

import { useEffect, useState } from "react";
import {
  configureFormatting,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatDate,
  formatMonth,
} from "@/lib/format";
import { apiGet } from "@/lib/api";
import type { AppSettings } from "@/lib/config";

export interface FormatApi {
  settings: AppSettings | null;
  ready: boolean;
  currency: (v: number | null | undefined) => string;
  num: (v: number | null | undefined) => string;
  pct: (v: number | null | undefined) => string;
  date: (v: string | null | undefined) => string;
  month: (v: string) => string;
}

export function useFormat(): FormatApi {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    let active = true;
    apiGet<{ settings: AppSettings }>("/api/categories")
      .then((res) => {
        if (!active) return;
        configureFormatting(res.settings.currency, res.settings.locale);
        setSettings(res.settings);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return {
    settings,
    ready: settings !== null,
    currency: formatCurrency,
    num: formatNumber,
    pct: formatPercent,
    date: formatDate,
    month: formatMonth,
  };
}
