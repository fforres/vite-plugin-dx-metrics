import { BufferedMetricsLoggerOptions } from 'datadog-metrics';

export type Full<T> = {
  [P in keyof T]-?: T[P];
};

export const TrackingMetrics = {
  recompile_session: 'recompile_session',
  compile_session: 'compile_session',
  compile_session_time: 'compile_session_time',
  recompile_session_time: 'recompile_session_time',
  process_memory: 'process_memory',
  heap_used: 'heap_used',
  heap_total: 'heap_total',
} as const;

export type TrackingMetricKeys = keyof typeof TrackingMetrics;

export type DXVitePluginProps = {
  datadogConfig?: BufferedMetricsLoggerOptions;
  enabledKeysToTrack?: TrackingMetricKeys[];
  tags?: { [key: string]: string };
  projectName: string;
  dryRun?: boolean;
  memoryTracking?: {
    enabled: boolean;
    lapseTimeInMilliseconds: number;
  };
};

export const trackingMetricKeys = Object.keys(
  TrackingMetrics,
) as TrackingMetricKeys[];
