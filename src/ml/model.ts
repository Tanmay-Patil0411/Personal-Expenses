import * as tf from "@tensorflow/tfjs";

// Genuine LSTM forecasting model (TensorFlow.js / Keras-style Sequential API).
// Architecture: LSTM(64) -> Dropout(0.2) -> Dense(32, ReLU) -> Dense(1).
// Mirrors the requested baseline deep-learning architecture.
export function buildLstmModel(seqLen: number, units = 64): tf.Sequential {
  const model = tf.sequential();

  model.add(
    tf.layers.lstm({
      units,
      inputShape: [seqLen, 1],
      returnSequences: false,
    }),
  );

  model.add(tf.layers.dropout({ rate: 0.2 }));

  model.add(tf.layers.dense({ units: 32, activation: "relu" }));

  model.add(tf.layers.dense({ units: 1 }));

  model.compile({
    optimizer: "adam",
    loss: "meanSquaredError",
  });

  return model;
}

export function sequencesToTensors(
  xs: number[][],
  ys: number[],
): { x: tf.Tensor3D; y: tf.Tensor2D } {
  // xs: [samples, seqLen] -> [samples, seqLen, 1]
  const seqLen = xs[0]?.length ?? 0;
  const xData = new Float32Array(xs.length * seqLen);
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < seqLen; j++) xData[i * seqLen + j] = xs[i][j];
  }
  const x = tf.tensor3d(xData, [xs.length, seqLen, 1]);
  const y = tf.tensor2d(ys, [ys.length, 1]);
  return { x, y };
}
