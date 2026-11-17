import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@ai-assistant/core': path.resolve(__dirname, './packages/core/src/index.ts'),
        '@ai-assistant/server': path.resolve(__dirname, './packages/server/src/index.ts'),
        '@ai-assistant/widget': path.resolve(__dirname, './packages/widget/src/index.ts'),
      },
    },
    build: {
      chunkSizeWarningLimit: 750,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('/three/')) return 'vendor-three';
            if (
              id.includes('/jspdf') ||
              id.includes('/xlsx/') ||
              id.includes('/html2canvas/') ||
              id.includes('/dompurify/') ||
              id.includes('/qrcode/') ||
              id.includes('/pdfjs-dist/')
            ) {
              return 'vendor-docs';
            }
            if (id.includes('/recharts/') || id.includes('/d3-')) return 'vendor-charts';
            if (id.includes('/framer-motion/') || id.includes('/motion/')) return 'vendor-motion';
            if (id.includes('/lucide-react/')) return 'vendor-icons';
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/@tanstack/') ||
              id.includes('/zustand/')
            ) {
              return 'vendor-framework';
            }
          },
        },
      },
    },
    server: {
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
