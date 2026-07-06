import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/bin/coco.ts', 'src/bin/coco-mcp.ts', 'src/bin/coco-store.ts'],
  format: 'esm',
  target: 'node20',
  clean: true,
});
