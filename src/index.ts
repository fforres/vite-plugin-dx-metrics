/* eslint-disable no-param-reassign */
import debug from 'debug';
import { v4 } from 'uuid';
import deepmerge from 'deepmerge';
import datadogMetrics from 'datadog-metrics';
import { performance } from 'perf_hooks';
import type { PluginOption, Plugin } from 'vite';
import {
  DXVitePluginProps,
  TrackingMetricKeys,
  trackingMetricKeys,
} from './types';
import {
  DEBUG_STRING,
  PLUGIN_NAME,
  PLUGIN_PREFIX,
  PLUGIN_VERSION,
} from './constants';

const d = debug(DEBUG_STRING);

class DXVitePlugin {
  private sessionId = v4();

  private dxTimeMap = new Map<string, bigint>();

  private options: Required<DXVitePluginProps>;

  private datadogClient = datadogMetrics;

  private defaultOptions: Partial<DXVitePluginProps> = {
    enabledKeysToTrack: trackingMetricKeys,
    dryRun: false,
    tags: {},
    datadogConfig: {
      prefix: PLUGIN_PREFIX,
      flushIntervalSeconds: 2,
    },
    memoryTracking: {
      enabled: true,
      lapseTimeInMilliseconds: 2000,
    },
  };

  private trackingEnabled: boolean = true;

  private enabledKeysSet: Set<TrackingMetricKeys> = new Set();

  private internallyDefinedTags: string[] = [];

  private memoryTrackingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: DXVitePluginProps) {
    this.options = deepmerge<Required<DXVitePluginProps>>(
      this.defaultOptions,
      options,
    );
    this.trackingEnabled = !this.options.dryRun;
    this.enabledKeysSet = new Set(this.options.enabledKeysToTrack);
    this.internallyDefinedTags = this.generateInternalTags();
    this.preflightCheck();
  }

  private trackMemoryUsage = () => {
    const { rss, heapUsed, heapTotal } = process.memoryUsage();
    this.trackAll('process_memory', rss / 1024);
    this.trackAll('heap_total', heapTotal / 1024);
    this.trackAll('heap_used', heapUsed / 1024);
  };

  private initializeMemoryUsageTracking = () => {
    if (this.options.memoryTracking.enabled) {
      this.memoryTrackingInterval = setInterval(
        this.trackMemoryUsage,
        this.options.memoryTracking.lapseTimeInMilliseconds,
      );
    }
  };

  private preflightCheck = () => {
    try {
      if (!this.options) {
        throw new Error('Options not initialized');
      }
      if (!this.options.projectName) {
        throw new Error('No project name was defined');
      }
      d('Options: %O', this.options);
      this.datadogClient.init(this.options.datadogConfig);
      this.initializeMemoryUsageTracking();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('DXVitePlugin Preflight Check was not successful ❌');
      // eslint-disable-next-line no-console
      console.error(e);
    }
    // eslint-disable-next-line no-console
    console.info('DXVitePlugin Preflight Check successful ✅. Ready to Start');
  };

  private generateInternalTags = (): string[] => {
    const optionTags = Object.entries(this.options.tags).map((tag) =>
      tag.join(':'),
    );

    const internalTags = [
      `projectName:${this.options.projectName}`,
      `pluginVersion:${PLUGIN_VERSION}`,
    ];

    d('internallyDefinedTags %o', internalTags);

    return [...optionTags, ...internalTags];
  };

  private extendTags = (tags: any[] = []) => [
    `sessionId:${this.sessionId}`,
    ...this.internallyDefinedTags,
    ...tags,
  ];

  private shouldTrack = (
    key: TrackingMetricKeys,
    value: number,
    typeOfTracking: 'histogram' | 'gauge' | 'increment',
  ) => {
    d('Tracking "%s" as "%s". With value %s', key, typeOfTracking, value);
    if (!this.trackingEnabled) {
      d('Tracking disabled, will not track %s', key);
      return false;
    }
    if (!this.enabledKeysSet.has(key)) {
      d('Tracking key is not allowed, will not track %s', key);
      return false;
    }
    return true;
  };

  private trackHistogram = (key: TrackingMetricKeys, value: number) => {
    if (!this.shouldTrack(key, value, 'histogram')) {
      return;
    }
    this.datadogClient.histogram(key, value, this.extendTags());
  };

  private trackGauge = (key: TrackingMetricKeys, value: number) => {
    if (!this.shouldTrack(key, value, 'gauge')) {
      return;
    }
    this.datadogClient.gauge(key, value, this.extendTags());
  };

  private trackIncrement = (key: TrackingMetricKeys, value: number = 1) => {
    if (this.shouldTrack(key, value, 'increment')) {
      return;
    }
    this.datadogClient.increment(key, value, this.extendTags());
  };

  private trackAll = (key: TrackingMetricKeys, value: number) => {
    this.trackHistogram(key, value);
    this.trackGauge(key, value);
    this.trackIncrement(key, value);
  };

  private dxMetricsPre(): Plugin {
    return {
      name: 'dx-metrics',
      enforce: 'pre' as 'pre',
      // When a hot reload happens, "handleHotUpdate" runs first.
      // then "load" and finally "transform"
      handleHotUpdate: ({ file }) => {
        this.trackIncrement('recompile_session');
        this.dxTimeMap.set(file, process.hrtime.bigint());
      },
      buildStart: () => {
        d('Starting %s session. ID: "%s"', PLUGIN_NAME, this.sessionId);
        this.trackIncrement('compile_session');
      },
      configureServer: (server) => {
        server.httpServer?.on('listening', () => {
          const startupDuration =
            performance.now() - (global as any).__vite_start_time;
          this.trackAll('compile_session_time', startupDuration);
        });
      },
    };
  }

  private dxMetricsPost(): Plugin {
    return {
      name: 'dx-metrics-post',
      enforce: 'post',
      transform: async (code, id) => {
        if (this.dxTimeMap.has(id)) {
          const endtime = process.hrtime.bigint();
          const startTime = this.dxTimeMap.get(id);
          const substracted = endtime - startTime!;
          const time = Math.floor(Number(substracted / BigInt(1000000)));
          this.trackAll('recompile_session_time', time);
          d(`elapsed time recompiling module %s, %d`, id, time);
          this.dxTimeMap.delete(id);
        }
        return code || null;
      },
    };
  }

  dxMetricsWrapper = (plugins: (PluginOption | PluginOption[])[]) => {
    return [this.dxMetricsPre(), ...plugins, this.dxMetricsPost()];
  };

  dxMetricsPlugins = [this.dxMetricsPre, this.dxMetricsPost] as const;
}

export = DXVitePlugin;
