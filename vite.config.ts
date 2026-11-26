import { defineConfig } from 'vite';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';

export default defineConfig({
  plugins: [wgslVitePlugin()],
  build: { target: 'es2022' },
  server: { port: 5178 },
});
