// Renders the two icon SVGs to the PNG sizes installers actually ask for.
// Android reads the manifest, iOS reads <link rel="apple-touch-icon">, and
// neither is reliable with SVG, so both are committed as PNG.
//
//   cd tools && npm run icons

import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const JOBS = [
  {from: 'icon.svg', to: 'icon-192.png', size: 192},
  {from: 'icon.svg', to: 'icon-512.png', size: 512},
  {from: 'icon.svg', to: 'apple-touch-icon.png', size: 180},
  {from: 'icon-maskable.svg', to: 'icon-maskable-512.png', size: 512},
];

const browser = await chromium.launch(process.env.CHROME_PATH
  ? {executablePath: process.env.CHROME_PATH, args: ['--no-sandbox']}
  : {});

for (const job of JOBS) {
  const svg = await readFile(path.join(root, job.from), 'utf8');
  const page = await browser.newPage({viewport: {width: job.size, height: job.size}});
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${job.size}px;height:${job.size}px}</style>${svg}`
  );
  const png = await page.screenshot({omitBackground: true});
  await writeFile(path.join(root, job.to), png);
  await page.close();
  console.log(`${job.to.padEnd(26)} ${job.size}px  ${(png.length / 1024).toFixed(1)} KB`);
}

await browser.close();
