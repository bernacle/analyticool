// Builds the Darkroom B+ prototype pages: injects the shared shell (sidebar, top bar, creation stages)
// into src/*.src.html and writes ./<page>.html. No dependencies. Run: node docs/design/darkroom/prototype/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const icon = (id) => `<svg aria-hidden="true"><use href="icons.svg#${id}"/></svg>`;
const back = '<svg width="14" height="14" aria-hidden="true"><use href="icons.svg#back"/></svg>';

const stages = [
  ['describe', 'Describe', 'index.html'],
  ['clarify', 'Clarify', 'clarify.html'],
  ['review', 'Review', 'review.html'],
  ['embed', 'Embed', 'embed.html'],
];

const pages = {
  index: { nav: 'new', stage: 'describe', where: '<span class="crumbs"><a href="#">Lumen Labs</a> <span aria-hidden="true">/</span></span> <b>New metric</b>' },
  clarify: { nav: 'new', stage: 'clarify', where: `<a href="index.html" class="backlink">${back}<span class="crumbs">New metric <span aria-hidden="true">/</span></span></a> <b>Net revenue after fees</b>` },
  review: { nav: 'metrics', stage: 'review', where: '<span class="crumbs"><a href="#">Metrics</a> <span aria-hidden="true">/</span></span> <b>Net revenue after fees</b>' },
  embed: { nav: 'metrics', stage: 'embed', where: `<a href="review.html" class="backlink">${back}<span class="crumbs">Net revenue after fees <span aria-hidden="true">/</span></span></a> <b>Embed</b>` },
};

const nav = (active, key, href, id, label) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${icon(id)}${label}</a>`;

function stagesHtml(current) {
  const idx = stages.findIndex(([k]) => k === current);
  const items = stages.map(([, label, href], i) => {
    if (i < idx) return `<li class="done"><a href="${href}">${label}</a></li>`;
    if (i === idx) return `<li class="current" aria-current="step"><span>${label}</span></li>`;
    return `<li class="next"><span>${label}</span></li>`;
  });
  return `<ol class="stages" aria-label="Metric creation, step ${idx + 1} of ${stages.length}">${items.join('')}</ol>`;
}

function shell({ nav: active, stage, where }) {
  return `<aside class="side" aria-label="Studio">
    <a class="brand" href="index.html" aria-label="Analyticool home"><svg width="20" height="20" aria-hidden="true"><use href="icons.svg#mark"/></svg><span class="word">analyticool</span></a>
    <nav class="nav" aria-label="Studio">
      ${nav(active, 'new', 'index.html', 'plus', 'New metric')}
      ${nav(active, 'metrics', 'review.html', 'metrics', 'Metrics')}
      ${nav(active, 'sources', '#', 'sources', 'Sources')}
      ${nav(active, 'settings', '#', 'settings', 'Settings')}
    </nav>
    <div class="bottom nav">
      <a href="#">${icon('docs')}Docs</a>
      <div class="user"><span>Bruno S.</span><span class="avatar">BS</span></div>
    </div>
  </aside>
  <header class="top">
    <div class="where">${where}</div>
    <div class="right">${stagesHtml(stage)}<button class="switcher" aria-label="Workspace: Lumen Labs. Switch"><span class="ws">L</span><span class="wsname">Lumen Labs</span><svg width="10" height="10" aria-hidden="true"><use href="icons.svg#chev"/></svg></button><button class="menu" aria-label="Menu"><svg width="16" height="16" aria-hidden="true"><use href="icons.svg#menu"/></svg></button></div>
  </header>`;
}

for (const [page, conf] of Object.entries(pages)) {
  const src = readFileSync(join(here, 'src', `${page}.src.html`), 'utf8');
  if (!src.includes('{{SHELL}}')) throw new Error(`${page}.src.html has no {{SHELL}} slot`);
  writeFileSync(join(here, `${page}.html`), src.replace('{{SHELL}}', shell(conf)));
}
console.log(`built ${Object.keys(pages).length} pages`);
