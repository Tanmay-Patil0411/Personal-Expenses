"use client";

import { useEffect, useRef } from "react";

export interface PlotlyChartProps {
  data: any[];
  layout?: any;
  config?: any;
  className?: string;
  style?: React.CSSProperties;
}

// Renders an interactive Plotly chart. Plotly is loaded lazily on the client
// only (it relies on the browser `window`), so this component is safe under
// Next.js SSR.
export default function PlotlyChart({
  data,
  layout,
  config,
  className,
  style,
}: PlotlyChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const plotlyRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const Plotly = (await import("plotly.js-dist-min")).default;
      plotlyRef.current = Plotly;
      if (cancelled || !ref.current) return;
      const baseLayout = {
        margin: { t: 30, r: 10, b: 40, l: 50 },
        font: { family: "ui-sans-serif, system-ui, sans-serif", size: 12 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        ...layout,
      };
      const baseConfig = {
        responsive: true,
        displayModeBar: false,
        ...config,
      };
      await Plotly.react(ref.current, data, baseLayout, baseConfig);
    })();
    return () => {
      cancelled = true;
    };
  }, [data, layout, config]);

  return (
    <div
      ref={ref}
      className={className}
      style={style ?? { width: "100%", height: 320 }}
    />
  );
}
