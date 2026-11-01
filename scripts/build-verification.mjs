import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
await mkdir(new URL('../public/',import.meta.url),{recursive:true});
await build({
  absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),
  entryPoints:['client/verification-client.jsx'],outfile:'public/verification-widget.js',
  bundle:true,minify:true,format:'esm',platform:'browser',target:['es2022'],
  jsx:'automatic',loader:{'.svg':'dataurl','.png':'dataurl','.gif':'dataurl'},define:{'process.env.NODE_ENV':'"production"',global:'globalThis'},
  logLevel:'warning',legalComments:'none'
});
