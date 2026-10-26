import * as tf from "@tensorflow/tfjs";
import type { MinMaxScaler } from "./scaler";
import { InsufficientDataError } from "./dataset";

// Generate a single-step forecast using a trained LSTM + fitted scaler.
// Takes the most recent `seqLen` monthly expense observations, scales them,
// runs the model, and inverse-transforms the output. Never uses the target
// month's actual value.
export async function predictNext(
  model: tf.LayersModel,
  scaler: MinMaxScaler,
  series: number[],
  seqLen: number,
): Promise<number> {
  if (series.length < seqLen) {
    throw new InsufficientDataError(
      `Need at least ${seqLen} months of history to forecast.`,
    );
  }
  const scaled = series.map((v) => scaler.transform(v));
  const window = scaled.slice(scaled.length - seqLen);
  const x = tf.tensor3d([window.map((v) => [v])], [1, seqLen, 1]);
  const pred = model.predict(x) as tf.Tensor;
  const data = await pred.data();
  const scaledValue = data[0];
  pred.dispose();
  x.dispose();
  const value = scaler.inverse(scaledValue);
  return Math.max(0, value); // expenses are non-negative
}
