/* eslint-disable no-param-reassign */
import debug from 'debug';
import { v4 } from 'uuid';
import deepmerge from 'deepmerge';
import datadogMetrics from 'datadog-metrics';
import type { PluginOption, Plugin } from 'vite';
import {
  DXVitePluginProps,
  TrackingMetricKeys,
  trackingMetricKeys,
} from './types';
import { DEBUG_STRING, PLUGIN_NAME, PLUGIN_VERSION } from './constants';

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
      prefix: 'ux.vite.',
      flushIntervalSeconds: 2,
    },
  };

  private trackingEnabled: boolean = true;

  private enabledKeysSet: Set<TrackingMetricKeys> = new Set();

  private internallyDefinedTags: string[] = [];

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
    if (!this.trackingEnabled) {
      d('Tracking disabled, will not track %s', key);
      return false;
    }
    if (!this.enabledKeysSet.has(key)) {
      d('Tracking key is not allowed, will not track %s', key);
      return false;
    }
    d('Tracking "%s" as "%s". With value %s', key, typeOfTracking, value);
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
          const compileTime = Date.now() - (global as any).__vite_start_time;
          this.trackGauge('compile_session', compileTime);
          this.trackHistogram('compile_session', compileTime);
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
          this.trackGauge('recompile_session', time);
          this.trackHistogram('recompile_session', time);
          d(`elapsed time recompiling module %s, %d`, id, time);
          this.dxTimeMap.delete(id);
        }
        return code || null;
      },
    };
  }

  dxMetricsWrapper(plugins: PluginOption[] | PluginOption) {
    if (Array.isArray(plugins)) {
      return [this.dxMetricsPre(), ...plugins, this.dxMetricsPost()];
    }
    return [this.dxMetricsPre(), plugins, this.dxMetricsPost()];
  }
}

export = DXVitePlugin;
