/* eslint-disable import/no-extraneous-dependencies */
import { defineConfig } from 'vite';
import reactRefresh from '@vitejs/plugin-react-refresh';
import { resolve } from 'path';
// @ts-expect-error when the file hasn't been generated
// (via running a yarn build) maps for it do not exist,
// this should be fixed once we move vite.config.ts into the app folder
import DXVitePlugin from './build/src/index.js';

const { dxMetricsWrapper } = new DXVitePlugin({
  projectName: 'some-name',
  dryRun: true,
  datadogConfig: {
    apiKey: 'some-key',
    /* SOME DATADOG API KEY FROM https://<YOUR_ORG>.datadoghq.com/account/settings#api */
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: dxMetricsWrapper([reactRefresh()]),
  build: {
    target: 'es6',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
