import { NextResponse } from "next/server";
import { parseCsv, validateCsv } from "@/lib/csvService";
import { getSessionUser } from "@/lib/auth";
import {
  saveTrainingDataset,
  getActiveTrainingDataset,
  getTrainingRecords,
  ensureTrainingTables,
} from "@/lib/trainingService";
import { saveSettings, getSettings } from "@/lib/settingsService";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureTrainingTables();
    const dataset = await getActiveTrainingDataset(user.id);
    if (!dataset) {
      return NextResponse.json({ hasDataset: false, dataset: null, sample: [] });
    }

    const records = await getTrainingRecords(user.id, dataset.id);
    const sample = records.slice(0, 10);

    return NextResponse.json({
      hasDataset: true,
      dataset,
      recordCount: records.length,
      sample,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      text?: string;
      filename?: string;
      name?: string;
      source?: string;
    };

    if (!body.text || !body.text.trim()) {
      return NextResponse.json(
        { ok: false, error: "No CSV content provided." },
        { status: 400 },
      );
    }

    const parsed = parseCsv(body.text);
    const result = validateCsv(parsed);

    if (result.valid.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No valid rows found in the CSV file.",
          details: result.errors.slice(0, 5),
        },
        { status: 422 },
      );
    }

    const expenseCount = result.valid.filter(
      (r) => r.transactionType === "Expense",
    ).length;

    const datasetName =
      body.name ||
      body.filename ||
      `Kaggle Dataset (${new Date().toLocaleDateString()})`;

    // Save strictly to training tables - never touch user personal transactions!
    const saved = await saveTrainingDataset({
      name: datasetName,
      source: body.source || "kaggle",
      filename: body.filename,
      validRows: result.valid,
      userId: user.id,
    });

    // Update settings so model trains from the Kaggle dataset
    const current = await getSettings(user.id);
    await saveSettings({ ...current, datasetMode: "kaggle" }, user.id);

    return NextResponse.json({
      ok: true,
      dataset: saved.dataset,
      importedCount: saved.count,
      expenseCount,
      summary: {
        total: result.total,
        valid: result.validCount,
        invalid: result.invalidCount,
        duplicates: result.duplicateCount,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
