import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5101,
    strictPort: true,
    open: true
  }
});