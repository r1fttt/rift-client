import { defineConfig } from 'vite';
export default defineConfig({ base: './', server: { host: '127.0.0.1', strictPort: true }, build: { target: 'chrome142', rollupOptions: { output: { manualChunks: { skin: ['skinview3d'], three: ['three'], icons: ['lucide'] } } } } });
