import * as fs from "fs";
import * as path from "path";
import type { LayersModel, io } from "@tensorflow/tfjs";
import { MinMaxScaler } from "./scaler";

export function getArtifactDir(userId?: number): string {
  // If in a Vitest test environment and not explicitly overridden, use an isolated directory
  const isTest =
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test" ||
    typeof (globalThis as any).describe === "function";

  const root =
    process.env.ML_ARTIFACT_DIR ||
    (isTest
      ? path.join(process.cwd(), ".ml-artifacts-test")
      : path.join(process.cwd(), ".ml-artifacts"));

  if (userId != null) {
    return path.join(root, `user_${userId}`);
  }

  // Check if legacy root artifacts exist (for backward compatibility)
  const legacyModel = path.join(root, "model", "model.json");
  if (!isTest && fs.existsSync(legacyModel) && !fs.existsSync(path.join(root, "global", "model", "model.json"))) {
    return root;
  }

  return path.join(root, "global");
}

export const ARTIFACT_DIR = getArtifactDir();

export interface ModelMeta {
  modelVersion: string;
  sequenceLength: number;
  trainMonths: number;
  valMonths: number;
  testMonths: number;
  firstMonth: string;
  lastMonth: string;
  targetMonth: string;
  trainStart: string;
  trainEnd: string;
  epochs: number;
  batchSize: number;
  savedAt: string;
  datasetMode?: string;
  dateRange?: { startDate: string; endDate: string };
  userId?: number | null;
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function getPaths(targetDir: string) {
  const modelDir = path.join(targetDir, "model");
  return {
    dir: targetDir,
    modelDir,
    modelJson: path.join(modelDir, "model.json"),
    weightsBin: path.join(modelDir, "weights.bin"),
    scalerJson: path.join(targetDir, "scaler.json"),
    metaJson: path.join(targetDir, "meta.json"),
    evalJson: path.join(targetDir, "eval.json"),
  };
}

export interface EvalPayload {
  targetMonth: string;
  nextForecast: number;
  evaluation: {
    actual: number[];
    predicted: number[];
    metrics: { mae: number; rmse: number; mape: number | null; wape?: number | null };
  };
  baselines: {
    name: string;
    predictions: number[];
    metrics: { mae: number; rmse: number; mape: number | null; wape?: number | null };
  }[];
  history: { loss: number[]; valLoss: number[] };
  trainMonths: number;
  valMonths: number;
  testMonths: number;
  modelVersion: string;
}

// Check if all artifact files exist and have non-zero size
export function artifactsExist(userId?: number): boolean {
  const targetDir = getArtifactDir(userId);
  const p = getPaths(targetDir);
  try {
    if (!fs.existsSync(p.modelJson) || !fs.existsSync(p.weightsBin)) return false;
    if (!fs.existsSync(p.scalerJson) || !fs.existsSync(p.metaJson)) return false;

    const sWeight = fs.statSync(p.weightsBin);
    const sJson = fs.statSync(p.modelJson);
    const sScaler = fs.statSync(p.scalerJson);
    const sMeta = fs.statSync(p.metaJson);

    return (
      sWeight.size > 0 && sJson.size > 0 && sScaler.size > 0 && sMeta.size > 0
    );
  } catch {
    return false;
  }
}

// Atomic save: writes into a temporary staging folder first.
// If saving fails or errors occur, the existing good model in targetDir is untouched.
export async function saveArtifacts(
  model: LayersModel,
  scaler: MinMaxScaler,
  meta: ModelMeta,
  evalData?: EvalPayload,
  userId?: number,
): Promise<string> {
  const targetDir = getArtifactDir(userId);
  ensureDir(path.dirname(targetDir));

  const stagingDir = `${targetDir}_staging_${Date.now()}`;
  ensureDir(stagingDir);
  const stagingPaths = getPaths(stagingDir);
  ensureDir(stagingPaths.modelDir);

  const tf = await import("@tensorflow/tfjs");

  try {
    await model.save(
      tf.io.withSaveHandler(async (artifacts) => {
        const weightData = Buffer.from(artifacts.weightData as ArrayBuffer);
        fs.writeFileSync(stagingPaths.weightsBin, weightData);
        const manifest = [
          { paths: ["weights.bin"], weights: artifacts.weightSpecs },
        ];
        fs.writeFileSync(
          stagingPaths.modelJson,
          JSON.stringify({
            modelTopology: artifacts.modelTopology,
            weightsManifest: manifest,
            format: artifacts.format,
            generatedBy: artifacts.generatedBy,
            convertedBy: null,
          }),
        );
        return {
          modelArtifactsInfo: {
            dateSaved: new Date(),
            modelTopologyType: "JSON",
            modelTopologyBytes: 0,
            weightSpecsBytes: 0,
            weightDataBytes: weightData.byteLength,
          },
        };
      }),
    );

    fs.writeFileSync(
      stagingPaths.scalerJson,
      JSON.stringify(scaler.toJSON()),
    );
    fs.writeFileSync(
      stagingPaths.metaJson,
      JSON.stringify(meta, null, 2),
    );

    if (evalData) {
      fs.writeFileSync(
        stagingPaths.evalJson,
        JSON.stringify(evalData, null, 2),
      );
    }

    // Now safely swap staging into targetDir
    const backupDir = `${targetDir}_backup_${Date.now()}`;
    if (fs.existsSync(targetDir)) {
      try {
        fs.renameSync(targetDir, backupDir);
      } catch {
        // Fallback: copy files if cross-device or locked
        fs.cpSync(targetDir, backupDir, { recursive: true });
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    }

    try {
      fs.renameSync(stagingDir, targetDir);
    } catch {
      fs.cpSync(stagingDir, targetDir, { recursive: true });
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }

    // Remove backup after successful swap
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }

    return targetDir;
  } catch (err) {
    // If anything failed, clean up staging without touching targetDir
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    throw err;
  }
}

export async function loadArtifacts(userId?: number): Promise<{
  model: LayersModel;
  scaler: MinMaxScaler;
  meta: ModelMeta;
}> {
  if (!artifactsExist(userId)) {
    throw new Error("No trained model artifacts found.");
  }

  const targetDir = getArtifactDir(userId);
  const p = getPaths(targetDir);

  const tf = await import("@tensorflow/tfjs");
  const handler: io.IOHandler = {
    load: async () => {
      const modelJson = JSON.parse(fs.readFileSync(p.modelJson, "utf-8"));
      const buf = fs.readFileSync(p.weightsBin);
      const weightData = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      );
      return {
        modelTopology: modelJson.modelTopology,
        weightSpecs: modelJson.weightsManifest[0].weights,
        weightData,
      };
    },
  };

  const model = await tf.loadLayersModel(handler);
  const scaler = MinMaxScaler.fromJSON(
    JSON.parse(fs.readFileSync(p.scalerJson, "utf-8")),
  );
  const meta: ModelMeta = JSON.parse(
    fs.readFileSync(p.metaJson, "utf-8"),
  );

  return { model, scaler, meta };
}

export function saveEval(payload: EvalPayload, userId?: number): void {
  const targetDir = getArtifactDir(userId);
  ensureDir(targetDir);
  const p = getPaths(targetDir);
  fs.writeFileSync(p.evalJson, JSON.stringify(payload, null, 2));
}

export function loadEval(userId?: number): EvalPayload | null {
  const targetDir = getArtifactDir(userId);
  const p = getPaths(targetDir);
  if (!fs.existsSync(p.evalJson)) return null;
  try {
    return JSON.parse(fs.readFileSync(p.evalJson, "utf-8"));
  } catch {
    return null;
  }
}

export function getArtifactMtime(userId?: number): number {
  const targetDir = getArtifactDir(userId);
  const p = getPaths(targetDir);
  try {
    if (!fs.existsSync(p.modelJson)) return 0;
    return fs.statSync(p.modelJson).mtimeMs;
  } catch {
    return 0;
  }
}

export interface ModelValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateModelCompatibility(
  meta: ModelMeta,
  userId?: number,
  completedMonthKeys?: string[],
): ModelValidationResult {
  if (!meta) {
    return { valid: false, reason: "Missing model metadata." };
  }

  // 1. Verify user ID ownership
  if (userId != null && meta.userId != null && meta.userId !== userId) {
    return {
      valid: false,
      reason: `Model belongs to user #${meta.userId}, not user #${userId}.`,
    };
  }

  // 2. Verify sequence length configuration
  if (!meta.sequenceLength || meta.sequenceLength < 1) {
    return { valid: false, reason: "Invalid sequence length in model metadata." };
  }

  // 3. Reject external/demo models when personal model is required
  if (meta.datasetMode !== "real") {
    return {
      valid: false,
      reason: `Model was trained in '${meta.datasetMode}' mode, not personal real user data.`,
    };
  }

  // 4. Verify training period alignment with current user history
  if (completedMonthKeys && completedMonthKeys.length > 0) {
    const earliestUserMonth = completedMonthKeys[0];
    if (meta.lastMonth && meta.lastMonth < earliestUserMonth) {
      return {
        valid: false,
        reason: `Model is obsolete: trained up to ${meta.lastMonth}, which precedes user history starting at ${earliestUserMonth}.`,
      };
    }
  }

  return { valid: true };
}
