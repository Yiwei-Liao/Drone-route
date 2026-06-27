import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cesiumBuildRoot = path.join(__dirname, 'node_modules', 'cesium', 'Build', 'Cesium');

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.b3dm': 'application/octet-stream',
    '.bin': 'application/octet-stream',
    '.css': 'text/css',
    '.gif': 'image/gif',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.ktx2': 'image/ktx2',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.terrain': 'application/vnd.quantized-mesh',
    '.wasm': 'application/wasm',
    '.webp': 'image/webp',
    '.xml': 'application/xml',
  };
  return types[ext] || 'application/octet-stream';
}

function serveCesiumDevAssets() {
  return {
    name: 'serve-cesium-dev-assets',
    configureServer(server) {
      server.middlewares.use('/cesium', (req, res, next) => {
        const requestPath = decodeURIComponent((req.url || '').split('?')[0] || '/');
        const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
        const filePath = path.normalize(path.join(cesiumBuildRoot, safePath));
        if (!filePath.startsWith(cesiumBuildRoot)) {
          next();
          return;
        }
        fs.stat(filePath, (statError, stat) => {
          if (statError || !stat.isFile()) {
            next();
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', contentTypeFor(filePath));
          fs.createReadStream(filePath).pipe(res);
        });
      });
    },
  };
}

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  plugins: [
    react(),
    serveCesiumDevAssets(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/cesium/Build/Cesium/Workers', dest: 'cesium' },
        { src: 'node_modules/cesium/Build/Cesium/Assets', dest: 'cesium' },
        { src: 'node_modules/cesium/Build/Cesium/ThirdParty', dest: 'cesium' },
        { src: 'node_modules/cesium/Build/Cesium/Widgets', dest: 'cesium' },
      ],
    }),
  ],
});
