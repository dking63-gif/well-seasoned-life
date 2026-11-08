import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { validateRecipe } from '../editor/worker.mjs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const ORIGIN = 'https://the-well-seasoned-life.dking63.workers.dev';
const API = 'https://falling-king-6c41.dking63.workers.dev/comments';
const escapeHtml = (v = '') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsonScript = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const readJson = async p => JSON.parse(await fs.readFile(path.join(ROOT, p), 'utf8'));
const excluded = new Set(['dist', 'node_modules', 'scripts', 'tests', 'editor/worker.mjs']);
const publicTypes = /\.(html|css|js|mjs|json|webp|png|jpe?g|gif|svg|ico|woff2?|ttf|avif|pdf|mp4|webm)$/i;

function sections(text) {
  const result = []; let section = { heading: '', lines: [] }; result.push(section);
  for (const line of text.split('\n')) {
    if (/^[A-Z][A-Z &/()–-]+$/.test(line.trim())) { section = {heading: line.trim(), lines: []}; result.push(section); }
    else section.lines.push(line);
  }
  return result;
}
function imageUrls(recipe) {
  const images = recipe.images ?? recipe.image ?? [];
  const list = typeof images === 'string' ? [images] : images;
  if (!Array.isArray(list)) throw Error('image/images must be a URL string or an array of URL strings');
  return list.map(image => {
    if (typeof image !== 'string' || !image.trim()) throw Error('Invalid recipe image');
    const url = new URL(image, ORIGIN + '/');
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('Image must use HTTP or HTTPS');
    return url.href;
  });
}
async function loadRecipes() {
  const manifest = await readJson('recipes/index.json');
  if (!Array.isArray(manifest) || !manifest.length) throw Error('Recipe index must be a nonempty array');
  const ids = new Set(), files = new Set(), recipes = [];
  for (const item of manifest) {
    const file = typeof item === 'string' ? item : item?.file;
    if (typeof file !== 'string' || !/^[a-z0-9][a-z0-9-]*\.json$/.test(file) || file === 'index.json') throw Error('Invalid recipe filename: ' + file);
    if (files.has(file)) throw Error('Duplicate recipe file: ' + file);
    files.add(file);
    try {
      const record = validateRecipe(await readJson('recipes/' + file));
      const id = (typeof item === 'object' && item.id) || record.id || file.slice(0, -5);
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(id) || id === 'index') throw Error('Invalid recipe ID');
      if (record.id !== undefined && record.id !== id) throw Error('Recipe and manifest IDs disagree');
      if (ids.has(id)) throw Error('Duplicate recipe ID: ' + id);
      ids.add(id);
      recipes.push({record, id, images: imageUrls(record)});
    } catch (error) { throw Error(file + ': ' + error.message); }
  }
  // Unlisted records must also be valid; an omitted file should never silently disappear.
  const disk = (await fs.readdir(path.join(ROOT, 'recipes'))).filter(f => f.endsWith('.json') && f !== 'index.json');
  for (const file of disk) if (!files.has(file)) throw Error('Recipe is missing from index: ' + file);
  return recipes;
}
async function copyPublic(relative = '') {
  for (const entry of await fs.readdir(path.join(ROOT, relative), {withFileTypes: true})) {
    const rel = path.posix.join(relative, entry.name);
    if (entry.name.startsWith('.') || excluded.has(rel) || /^package(?:-lock)?\.json$|^wrangler\./.test(rel)) continue;
    if (entry.isSymbolicLink()) throw Error('Public assets cannot be symlinks: ' + rel);
    if (entry.isDirectory()) await copyPublic(rel);
    else if (publicTypes.test(entry.name)) {
      await fs.mkdir(path.dirname(path.join(DIST, rel)), {recursive: true});
      await fs.copyFile(path.join(ROOT, rel), path.join(DIST, rel));
    }
  }
}
function metadata(title, description, url) {
  return `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(url)}">`;
}

async function build() {
  const recipes = await loadRecipes();
  const source = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const style = source.match(/<style>([\s\S]*?)<\/style>/)?.[0];
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!style || !script) throw Error('Cookbook style or script is missing');
  // Reuse the public comment/rating implementation verbatim, including name-based API keys.
  const utensil = script.slice(script.indexOf('const utensil='), script.indexOf('function cats()'));
  const comments = script.slice(script.indexOf('function comments('), script.indexOf('function recipe('));
  if (!utensil.startsWith('const utensil=') || !comments.startsWith('function comments(')) throw Error('Comments implementation changed; update the build adapter');
  if (process.argv.includes('--validate-only')) { console.log(`Validated ${recipes.length} recipes.`); return; }
  await fs.rm(DIST, {recursive: true, force: true});
  await fs.mkdir(DIST, {recursive: true});
  await copyPublic();
  const shell = (title, description, url, body, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${metadata(title,description,url)}${style}${extra}</head><body><header><a class="about-btn" href="/">THE WELL-SEASONED LIFE</a><h1>${escapeHtml(title.replace(/ \| The Well-Seasoned Life$/, ''))}</h1></header><main><nav><a href="/">Search cookbook &amp; Pantry</a> · <a href="/recipes/">All recipes</a> · <a href="/about.html">About David &amp; Donna</a></nav>${body}<footer>The Well-Seasoned Life · Come hungry. Stay awhile.</footer></main></body></html>`;
  const urls = ['/', '/recipes/'];
  for (const {record: r, id, images} of recipes) {
    const route = `/recipes/${id}/`, url = ORIGIN + route;
    const description = `${r.name}: ${r.sub || r.text.split('\n').find(Boolean)} — a recipe from David & Donna’s kitchen.`;
    const parts = sections(r.text);
    const schema = images.length ? {'@context':'https://schema.org','@type':'Recipe',name:r.name,description,url,image:images,author:{'@type':'Person',name:'David & Donna'},recipeIngredient:parts.filter(s=>/INGREDIENT|^DRY MIX$|^CHICKEN MARINADE$|^OPTIONAL TOPPING$/.test(s.heading)).flatMap(s=>s.lines.filter(Boolean)),recipeInstructions:parts.filter(s=>/METHOD|DIRECTIONS|INSTRUCTIONS/.test(s.heading)).flatMap(s=>s.lines.filter(Boolean).map(text=>({'@type':'HowToStep',text})))} : null;
    if (schema && r.servings) schema.recipeYield = String(r.servings);
    const stats = [r.cal !== undefined ? `<div class="stat"><b>${escapeHtml(r.cal)}</b><span>CALORIES / SERVING</span></div>` : '',r.p !== undefined ? `<div class="stat"><b>${escapeHtml(r.p)} g</b><span>PROTEIN / SERVING</span></div>` : ''].join('');
    const controls = [[.25,'1/4x'],[.5,'1/2x'],[1,'1x'],[2,'2x'],[3,'3x']].map(([n,label])=>`<button type="button" data-scale="${n}" aria-pressed="${n===1}" class="${n===1?'active':''}">${label}</button>`).join('');
    const body = `<article><p>${escapeHtml(r.sub)}</p>${images.map(src=>`<img src="${escapeHtml(src)}" alt="${escapeHtml(r.name)}" style="max-width:100%;height:auto">`).join('')}<div class="stats">${stats}</div><div class="scale-controls" aria-label="Recipe scale">${controls}</div><p>Scale changes ingredient quantities; per-serving nutrition stays the same.</p><pre id="recipe-text">${escapeHtml(r.text)}</pre><div id="recipe-comments"></div><noscript>Enable JavaScript to scale ingredients and load comments and ratings.</noscript></article>`;
    const runtime = `<script>const API=${jsonScript(API)};${utensil}\n${comments}\nconst record=${jsonScript(r)};comments(document.querySelector('#recipe-comments'),record);</script><script type="module">import {scaleIngredients} from '/recipe-scaling.mjs';const original=${jsonScript(r.text)};document.querySelectorAll('[data-scale]').forEach(button=>button.addEventListener('click',()=>{document.querySelector('#recipe-text').textContent=scaleIngredients(original,Number(button.dataset.scale));document.querySelectorAll('[data-scale]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button))})}));</script>`;
    const html = shell(r.name + ' | The Well-Seasoned Life',description,url,body,schema?`<script type="application/ld+json">${jsonScript(schema)}</script>`:'').replace('</body>',runtime+'</body>');
    await fs.mkdir(path.join(DIST, 'recipes', id), {recursive: true});
    await fs.writeFile(path.join(DIST, 'recipes', id, 'index.html'), html);
    urls.push(route);
  }
  await fs.copyFile(path.join(ROOT,'scripts/recipe-scaling.mjs'),path.join(DIST,'recipe-scaling.mjs'));
  const listing = `<h2>Recipes from David &amp; Donna</h2><ul>${recipes.map(({record:r,id})=>`<li><a href="/recipes/${id}/">${escapeHtml(r.name)}</a><p>${escapeHtml(r.sub)}</p></li>`).join('')}</ul>`;
  await fs.writeFile(path.join(DIST,'recipes/index.html'),shell('Recipes | The Well-Seasoned Life','Browse all recipes from David and Donna’s kitchen.',ORIGIN+'/recipes/',listing));
  const home = source.replace(/<title>[\s\S]*?<\/title>/,metadata('The Well-Seasoned Life','Recipes, pantry notes, and good food from David & Donna.',ORIGIN+'/')).replace('<nav>','<nav><a href="/recipes/">Browse recipe pages</a>');
  await fs.writeFile(path.join(DIST,'index.html'),home);
  if (await fs.stat(path.join(DIST,'about.html')).catch(()=>false)) urls.push('/about.html');
  await fs.writeFile(path.join(DIST,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(route=>`<url><loc>${escapeHtml(ORIGIN+route)}</loc></url>`).join('')}</urlset>\n`);
  await fs.writeFile(path.join(DIST,'robots.txt'),`User-agent: *\nAllow: /\nDisallow: /editor.html\nDisallow: /editor/\nDisallow: /api/\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  console.log(`Built ${recipes.length} recipe pages, recipe directory, sitemap, and robots.txt in dist.`);
}
build().catch(error=>{console.error(error.message);process.exitCode=1});
