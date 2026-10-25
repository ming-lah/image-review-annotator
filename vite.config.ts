import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  root: 'src/client',
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: { port: Number(process.env.VITE_PORT ?? 5174), proxy: { '/api': `http://127.0.0.1:${process.env.PORT ?? 3002}` } },
});
