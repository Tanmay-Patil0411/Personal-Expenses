// Evaluation utilities: regression metrics plus fair baseline comparisons.

export function mae(actual: number[], predicted: number[]): number {
  if (!actual.length) return 0;
  let s = 0;
  for (let i = 0; i < actual.length; i++) s += Math.abs(actual[i] - predicted[i]);
  return s / actual.length;
}

export function rmse(actual: number[], predicted: number[]): number {
  if (!actual.length) return 0;
  let s = 0;
  for (let i = 0; i < actual.length; i++)
    s += (actual[i] - predicted[i]) ** 2;
  return Math.sqrt(s / actual.length);
}

// Mean Absolute Percentage Error. Meaningful only when actuals are non-zero.
export function mape(actual: number[], predicted: number[]): number | null {
  const usable: [number, number][] = [];
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== 0) usable.push([actual[i], predicted[i]]);
  }
  if (!usable.length) return null;
  let s = 0;
  for (const [a, p] of usable) s += Math.abs((a - p) / a);
  return (s / usable.length) * 100;
}

// Weighted Absolute Percentage Error. Total absolute error divided by total actual expenses.
export function wape(actual: number[], predicted: number[]): number | null {
  if (!actual.length) return null;
  let totalError = 0;
  let totalActual = 0;
  for (let i = 0; i < actual.length; i++) {
    totalError += Math.abs(actual[i] - predicted[i]);
    totalActual += actual[i];
  }
  if (totalActual <= 0) return null;
  return (totalError / totalActual) * 100;
}

export interface Metrics {
  mae: number;
  rmse: number;
  mape: number | null; // null when no non-zero denominators
  wape: number | null; // null when sum of actuals <= 0
}

export function evaluate(actual: number[], predicted: number[]): Metrics {
  return {
    mae: mae(actual, predicted),
    rmse: rmse(actual, predicted),
    mape: mape(actual, predicted),
    wape: wape(actual, predicted),
  };
}

// Baseline 1: naive (previous month's value)
// Baseline 2: moving average of the previous `window` months
export interface BaselineResult {
  name: string;
  predictions: number[];
  metrics: Metrics;
}

// Baselines evaluated against the SAME test targets as the LSTM (the most
// recent `testMonths` observations), each prediction using only information
// available before its target month.
export function computeBaselines(
  series: number[],
  testMonths: number,
  movingAvgWindow = 3,
): BaselineResult[] {
  const naive: number[] = [];
  const ma: number[] = [];
  const actual: number[] = [];
  const from = series.length - testMonths;
  for (let i = Math.max(1, from); i < series.length; i++) {
    actual.push(series[i]);
    naive.push(series[i - 1]);
    const start = Math.max(0, i - movingAvgWindow);
    const windowVals = series.slice(start, i);
    const avg =
      windowVals.reduce((a, b) => a + b, 0) / Math.max(1, windowVals.length);
    ma.push(avg);
  }
  return [
    { name: "Naive (last month)", predictions: naive, metrics: evaluate(actual, naive) },
    {
      name: `Moving average (${movingAvgWindow}mo)`,
      predictions: ma,
      metrics: evaluate(actual, ma),
    },
  ];
}
