import { defineConfig } from 'vite';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';

export default defineConfig({
  plugins: [wgslVitePlugin()],
  // Relative asset paths, so the build works at a sub-path such as GitHub Pages' /holo-mint/.
  base: './',
  build: { target: 'es2022' },
  server: { port: 5178 },
});
