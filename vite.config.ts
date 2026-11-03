import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  return {
    // The static bundle is served by the portal API under /monitoring/, so its
    // chunks must not collide with the shell assets at the origin root.
    base: command === 'build' ? '/monitoring/' : '/',
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
