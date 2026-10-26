import { NextResponse } from "next/server";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
} from "@/lib/types";
import { getSettings } from "@/lib/settingsService";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    expenseCategories: [...EXPENSE_CATEGORIES],
    incomeCategories: [...INCOME_CATEGORIES],
    paymentMethods: [...PAYMENT_METHODS],
    settings,
  });
}
