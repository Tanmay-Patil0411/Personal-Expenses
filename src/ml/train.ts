import * as tf from "@tensorflow/tfjs";
import { buildLstmModel, sequencesToTensors } from "./model";
import { MinMaxScaler } from "./scaler";
import {
  splitSeries,
  buildSplitSequences,
  InsufficientDataError,
} from "./dataset";
import { evaluate, computeBaselines, type Metrics, type BaselineResult } from "./evaluate";
import { predictNext } from "./predict";
import { nextMonth } from "@/lib/config";

export interface TrainSettings {
  sequenceLength: number;
  valMonths: number;
  testMonths: number;
  epochs: number;
  batchSize: number;
  modelVersion: string;
}

export interface TrainResult {
  model: tf.LayersModel;
  scaler: MinMaxScaler;
  series: number[];
  monthKeys: string[];
  split: { train: number[]; val: number[]; test: number[] };
  history: { loss: number[]; valLoss: number[] };
  evaluation: { actual: number[]; predicted: number[]; metrics: Metrics };
  baselines: BaselineResult[];
  targetMonth: string;
  nextForecast: number;
  settings: TrainSettings;
  trainStartISO: string;
  trainEndISO: string;
}

let backendReady = false;
export async function ensureTfBackend(): Promise<void> {
  if (backendReady) return;
  try {
    await tf.setBackend("cpu");
  } catch {
    /* fall back to default */
  }
  await tf.ready();
  backendReady = true;
}

// Full, leakage-free training pipeline:
//   1. chronological split (train/val/test) — never shuffled
//   2. fit scaler on the TRAINING months only
//   3. transform the whole series with that fitted scaler
//   4. build sliding-window sequences (targets assigned to a partition by
//      chronological position; lookback windows may extend into earlier data)
//   5. train LSTM with early stopping on validation loss
//   6. evaluate on held-out test targets + compare against naive baselines
//   7. forecast the next month from the latest window
export async function trainModel(
  series: number[],
  monthKeys: string[],
  settings: TrainSettings,
): Promise<TrainResult> {
  await ensureTfBackend();

  const L = settings.sequenceLength;
  const n = series.length;

  if (n < L + 1 + settings.valMonths + settings.testMonths) {
    throw new InsufficientDataError(
      `Need at least ${L + 1 + settings.valMonths + settings.testMonths} months of data (got ${n}).`,
    );
  }

  const split = splitSeries(series, L, settings.valMonths, settings.testMonths);
  const trainEnd = n - settings.valMonths - settings.testMonths;

  // Fit scaler on training months ONLY (no future information).
  const scaler = new MinMaxScaler();
  scaler.fit(series.slice(0, trainEnd));
  const scaled = series.map((v) => scaler.transform(v));

  const seq = buildSplitSequences(scaled, L, settings.valMonths, settings.testMonths);

  const trainT = sequencesToTensors(seq.train.xs, seq.train.ys);
  const valT = seq.val.xs.length
    ? sequencesToTensors(seq.val.xs, seq.val.ys)
    : null;

  const model = buildLstmModel(L, 64);

  const trainStart = new Date().toISOString();
  const earlyStop = tf.callbacks.earlyStopping({
    monitor: "val_loss",
    patience: 10,
    mode: "min",
  });

  const history = await model.fit(trainT.x, trainT.y, {
    epochs: settings.epochs,
    batchSize: settings.batchSize,
    validationData: valT ? [valT.x, valT.y] : undefined,
    callbacks: [earlyStop],
    verbose: 0,
  });

  const trainEndISO = new Date().toISOString();

  // Test-set evaluation (unseen chronological period).
  let evaluation = {
    actual: [] as number[],
    predicted: [] as number[],
    metrics: { mae: 0, rmse: 0, mape: null } as Metrics,
  };
  if (seq.test.xs.length) {
    const testT = sequencesToTensors(seq.test.xs, seq.test.ys);
    const predTensor = model.predict(testT.x) as tf.Tensor;
    const predScaled = Array.from(await predTensor.data());
    const actualRaw = seq.test.ys.map((v) => scaler.inverse(v));
    const predRaw = predScaled.map((v) => Math.max(0, scaler.inverse(v)));
    evaluation = {
      actual: actualRaw,
      predicted: predRaw,
      metrics: evaluate(actualRaw, predRaw),
    };
    predTensor.dispose();
    testT.x.dispose();
    testT.y.dispose();
  }

  const baselines = computeBaselines(series, settings.testMonths);

  const lastMonth = monthKeys[monthKeys.length - 1];
  const targetMonth = nextMonth(lastMonth);
  const nextForecast = await predictNext(model, scaler, series, L);

  trainT.x.dispose();
  trainT.y.dispose();
  if (valT) {
    valT.x.dispose();
    valT.y.dispose();
  }

  return {
    model,
    scaler,
    series,
    monthKeys,
    split,
    history: {
      loss: history.history.loss as number[],
      valLoss: (history.history.val_loss as number[]) ?? [],
    },
    evaluation,
    baselines,
    targetMonth,
    nextForecast,
    settings,
    trainStartISO: trainStart,
    trainEndISO,
  };
}
