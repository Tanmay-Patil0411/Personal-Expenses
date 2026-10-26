import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_SETTINGS, type AppSettings } from "./config";

const KEY = "app_settings";

export async function getSettings(userId?: number): Promise<AppSettings> {
  const settingsKey = userId ? `app_settings_${userId}` : KEY;
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, settingsKey))
    .limit(1);
  if (!row) {
    await db
      .insert(appSettings)
      .values({ key: settingsKey, value: JSON.stringify(DEFAULT_SETTINGS) })
      .onConflictDoNothing();
    return { ...DEFAULT_SETTINGS };
  }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(
  partial: Partial<AppSettings>,
  userId?: number,
): Promise<AppSettings> {
  const settingsKey = userId ? `app_settings_${userId}` : KEY;
  const current = await getSettings(userId);
  const merged = { ...current, ...partial };
  await db
    .insert(appSettings)
    .values({ key: settingsKey, value: JSON.stringify(merged) })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(merged) },
    });
  return merged;
}
