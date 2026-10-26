// MinMax scaler equivalent to scikit-learn's MinMaxScaler, fit on the
// training period only to prevent data leakage.

export class MinMaxScaler {
  min = 0;
  max = 0;
  private range = 1;

  fit(values: number[]): void {
    if (!values.length) {
      this.min = 0;
      this.max = 0;
      this.range = 1;
      return;
    }
    this.min = Math.min(...values);
    this.max = Math.max(...values);
    this.range = this.max - this.min;
    if (this.range === 0) this.range = 1; // avoid division by zero
  }

  transform(value: number): number {
    return (value - this.min) / this.range;
  }

  inverse(value: number): number {
    return value * this.range + this.min;
  }

  toJSON(): { min: number; max: number } {
    return { min: this.min, max: this.max };
  }

  static fromJSON(o: { min: number; max: number }): MinMaxScaler {
    const s = new MinMaxScaler();
    s.min = o.min;
    s.max = o.max;
    s.range = o.max - o.min || 1;
    return s;
  }
}
