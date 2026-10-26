import type { LayersModel, Tensor } from "@tensorflow/tfjs";
import { MinMaxScaler } from "./scaler";
import {
  artifactsExist,
  loadArtifacts,
  loadEval,
  getArtifactMtime,
  type ModelMeta,
  type EvalPayload,
} from "./persist";

export interface LoadedModel {
  model: LayersModel;
  scaler: MinMaxScaler;
  meta: ModelMeta;
  evalData: EvalPayload | null;
  mtime: number;
  userId?: number;
}

// In-memory model cache keyed by `user_${userId || "default"}`
const modelCache = new Map<string, LoadedModel>();

// In-flight loading promises to prevent concurrent duplicate loading
const loadingPromises = new Map<string, Promise<LoadedModel | null>>();

function cacheKey(userId?: number): string {
  return `user_${userId ?? "default"}`;
}

export async function getModel(userId?: number): Promise<LoadedModel | null> {
  const key = cacheKey(userId);

  // Check if artifacts exist on disk with valid non-empty files
  if (!artifactsExist(userId)) {
    invalidateModel(userId);
    return null;
  }

  const currentMtime = getArtifactMtime(userId);
  const cached = modelCache.get(key);

  // If already cached and the disk artifacts have not changed, reuse cached instance
  if (cached && cached.mtime === currentMtime) {
    return cached;
  }

  // If a load operation is already in flight for this user, wait for it
  if (loadingPromises.has(key)) {
    return loadingPromises.get(key)!;
  }

  const loadPromise = (async (): Promise<LoadedModel | null> => {
    try {
      const { model, scaler, meta } = await loadArtifacts(userId);
      const evalData = loadEval(userId);

      // Verify model integrity by running a single forward-pass test
      const tf = await import("@tensorflow/tfjs");
      const seqLen = meta.sequenceLength || 6;
      const dummyInput = tf.tensor3d(
        [new Array(seqLen).fill([0.5])],
        [1, seqLen, 1],
      );
      const testPred = model.predict(dummyInput) as Tensor;
      await testPred.data();
      testPred.dispose();
      dummyInput.dispose();

      // Dispose previously cached model if replacing
      const existing = modelCache.get(key);
      if (existing && existing.model !== model) {
        try {
          existing.model.dispose();
        } catch {}
      }

      const loaded: LoadedModel = {
        model,
        scaler,
        meta,
        evalData,
        mtime: currentMtime,
        userId,
      };

      modelCache.set(key, loaded);
      return loaded;
    } catch (err) {
      console.error(
        `Failed to load or verify model for ${key}:`,
        err instanceof Error ? err.message : String(err),
      );
      invalidateModel(userId);
      return null;
    } finally {
      loadingPromises.delete(key);
    }
  })();

  loadingPromises.set(key, loadPromise);
  return loadPromise;
}

export async function isModelTrained(userId?: number): Promise<{
  trained: boolean;
  meta: ModelMeta | null;
  evalData: EvalPayload | null;
  reason?: string;
}> {
  if (!artifactsExist(userId)) {
    return {
      trained: false,
      meta: null,
      evalData: null,
      reason: "No saved model artifacts found on disk.",
    };
  }

  const loaded = await getModel(userId);
  if (!loaded) {
    return {
      trained: false,
      meta: null,
      evalData: null,
      reason: "Model artifacts are corrupted or could not be loaded into TensorFlow.js.",
    };
  }

  return {
    trained: true,
    meta: loaded.meta,
    evalData: loaded.evalData,
  };
}

export function invalidateModel(userId?: number): void {
  const key = cacheKey(userId);
  const existing = modelCache.get(key);
  if (existing) {
    try {
      existing.model.dispose();
    } catch {}
    modelCache.delete(key);
  }
}
