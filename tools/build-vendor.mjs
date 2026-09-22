// Bundles the only two third-party libraries the app uses into vendor/geo.js,
// so the page loads from disk with no CDN and no network. Output is committed.
//
//   cd tools && npm install && npm run vendor

import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  stdin: {
    contents: `
      export {
        geoPath, geoContains, geoBounds, geoCentroid, geoGraticule,
        geoEqualEarth, geoNaturalEarth1, geoMercator, geoOrthographic, geoDistance,
      } from 'd3-geo';
      export {feature, mesh} from 'topojson-client';
    `,
    resolveDir: here,
    sourcefile: 'vendor-entry.js',
  },
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'geo',
  target: ['es2020'],
  outfile: path.join(here, '..', 'vendor', 'geo.js'),
  banner: {js: '/* d3-geo (ISC) + topojson-client (ISC). Rebuild: tools/build-vendor.mjs */'},
});

console.log('vendor/geo.js written');
