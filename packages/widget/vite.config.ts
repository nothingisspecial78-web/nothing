import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ai-assistant/core': path.resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/embed.ts'),
      name: 'AIAssistantWidget',
      formats: ['iife'],
      fileName: () => 'assistant.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
