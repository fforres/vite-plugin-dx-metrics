/* eslint-disable import/no-extraneous-dependencies */
import { defineConfig } from 'vite';
import reactRefresh from '@vitejs/plugin-react-refresh';
import { resolve } from 'path';
import DXVitePlugin from './src/index';

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
  server: {
    open: true,
  },
  build: {
    target: 'es6',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
