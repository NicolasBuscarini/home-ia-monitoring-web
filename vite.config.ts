import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  return {
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    plugins: [
      react(),
      federation({
        name: 'home_ia_monitoring',
        filename: 'remoteEntry.js',
        exposes: {
          './MonitoringModule': './src/MonitoringModule.tsx',
        },
        shared: ['react', 'react-dom', 'home-ia-shared'],
        dts: false,
      }),
    ],
    server: {
      host: '0.0.0.0',
      port: 5174,
      strictPort: true,
      cors: true,
      origin: env.VITE_REMOTE_ORIGIN || 'http://127.0.0.1:5174',
    },
    preview: {
      host: '0.0.0.0',
      port: 5174,
      strictPort: true,
      cors: true,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      target: 'esnext',
    },
  };
});
