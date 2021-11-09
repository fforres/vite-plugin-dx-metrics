/* eslint-disable no-param-reassign */
import debug from 'debug';
import deepmerge from 'deepmerge';
import { performance } from 'perf_hooks';
import type { PluginOption, Plugin } from 'vite';
import { v4 } from 'uuid';
import { Tracker } from './tracker';
import { DXVitePluginProps, trackingMetricKeys } from './types';
import { DEBUG_STRING, PLUGIN_NAME, PLUGIN_PREFIX } from './constants';

const d = debug(DEBUG_STRING);

class DXVitePlugin {
  private sessionId = v4();

  private dxTimeMap = new Map<string, bigint>();

  private options: Required<DXVitePluginProps>;

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

  private memoryTrackingInterval: ReturnType<typeof setInterval> | null = null;

  private tracker: Tracker;

  constructor(options: DXVitePluginProps) {
    this.options = deepmerge<Required<DXVitePluginProps>>(
      this.defaultOptions,
      options,
    );
    this.tracker = new Tracker(this.options, this.sessionId);
    this.preflightCheck();
  }

  private trackMemoryUsage = () => {
    const { rss, heapUsed, heapTotal } = process.memoryUsage();
    this.tracker.trackAll('process_memory', rss / 1024);
    this.tracker.trackAll('heap_total', heapTotal / 1024);
    this.tracker.trackAll('heap_used', heapUsed / 1024);
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

  private dxMetricsPre(): Plugin {
    return {
      name: 'dx-metrics',
      enforce: 'pre' as 'pre',
      // When a hot reload happens, "handleHotUpdate" runs first.
      // then "load" and finally "transform"
      handleHotUpdate: ({ file }) => {
        this.tracker.trackIncrement('recompile_session');
        this.dxTimeMap.set(file, process.hrtime.bigint());
      },
      buildStart: () => {
        d('Starting %s session. ID: "%s"', PLUGIN_NAME, this.sessionId);
        this.tracker.trackIncrement('compile_session');
      },
      configureServer: (server) => {
        server.httpServer?.on('listening', () => {
          const startupDuration =
            performance.now() - (global as any).__vite_start_time;
          this.tracker.trackAll('compile_session_time', startupDuration);
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
          this.tracker.trackAll('recompile_session_time', time);
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
