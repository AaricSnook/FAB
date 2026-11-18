// Packs dist/ into one self-contained page (inline JS + CSS) for sharing as a
// hosted prototype; data files are published next to it under data/.
// Run after `vite build`: node scripts/build-prototype.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const out = new URL('../dist-prototype/', import.meta.url);
const assets = readdirSync(new URL('assets/', dist));
const js = readFileSync(new URL('assets/' + assets.find((f) => f.endsWith('.js')), dist), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(new URL('assets/' + assets.find((f) => f.endsWith('.css')), dist), 'utf8');

const html = `<title>Fairly Average Athletes</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#07080c">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400;500&display=swap">
<style>html,body{background:#07080c;color-scheme:dark}${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
mkdirSync(new URL('data/', out), { recursive: true });
writeFileSync(new URL('index.html', out), html);
for (const f of ['club.json', 'basemap.json']) copyFileSync(new URL(`../public/data/${f}`, import.meta.url), new URL(`data/${f}`, out));
console.log(`dist-prototype/index.html ${(html.length / 1e6).toFixed(2)} MB`);
