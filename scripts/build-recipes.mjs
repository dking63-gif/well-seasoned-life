import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const RECIPES_DIR = path.join(ROOT, 'recipes');
const SITE_ORIGIN = 'https://the-well-seasoned-life.dking63.workers.dev';
const COMMENTS_API = 'https://falling-king-6c41.dking63.workers.dev/comments';
const validateOnly = process.argv.includes('--validate-only');

const excludedRootNames = new Set([
  '.git', '.github', 'node_modules', 'dist', 'scripts', 'tests',
  'package.json', 'package-lock.json', 'wrangler.jsonc', 'wrangler.toml'
]);

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function slugify(value = '') {
  return String(value).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function getManifestFilename(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item.file === 'string') return item.file;
  throw new Error('Each recipes/index.json entry must be a filename or an object containing a file property.');
}

async function readJson(filename) {
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}

// Reads one recipe in the site's format: { name, sub, text, categories, id, scaleOptions }
// "text" is split into sections by ALL-CAPS heading lines (INGREDIENTS, DRY MIX, METHOD, NOTES ...).
const METHOD_RE = /^(METHOD|INSTRUCTIONS|DIRECTIONS|STEPS|PREPAR|HOW TO)/;
const INGREDIENT_RE = /INGREDIENT|\bMIX\b/;

function titleCase(h) {
  return h.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

function normalizeRecipe(data, manifestId) {
  const raw = String(data.text || '').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');
  const sections = [];
  let current = null;
  let source = '';
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[A-Z][A-Z &/,'-]{2,40}$/.test(trimmed)) {
      current = { heading: trimmed, lines: [] };
      sections.push(current);
    } else if (/^Source:/i.test(trimmed)) {
      source = trimmed;
    } else {
      if (!current) { current = { heading: '', lines: [] }; sections.push(current); }
      current.lines.push(trimmed);
    }
  }
  sections.forEach((sec, i) => {
    if (METHOD_RE.test(sec.heading)) sec.kind = 'method';
    else if (INGREDIENT_RE.test(sec.heading) || (i === 0 && sec.heading)) sec.kind = 'ingredients';
    else sec.kind = 'text';
    sec.title = titleCase(sec.heading);
    if (sec.kind === 'method') sec.lines = sec.lines.map(l => l.replace(/^\d+[.)]\s+/, ''));
  });
  const ofKind = k => sections.filter(x => x.kind === k).flatMap(x => x.lines);
  return {
    id: data.id || manifestId || slugify(data.name || ''),
    title: data.name || data.title || '',
    description: data.sub || data.description || '',
    categories: toList(data.categories),
    scaleOptions: Array.isArray(data.scaleOptions) && data.scaleOptions.length ? data.scaleOptions : [0.5, 1, 2, 3],
    sections,
    ingredients: ofKind('ingredients'),
    steps: ofKind('method'),
    source,
    cal: data.cal,
    p: data.p,
    na: data.na,
    images: recipeImages(data)
  };
}

function toList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function recipeImages(recipe) {
  const imgs = [
    ...toList(recipe.images), ...toList(recipe.image),
    ...toList(recipe.photo), ...toList(recipe.photos), ...toList(recipe.imageUrl)
  ]
    .map(i => (typeof i === 'string' ? i : i && (i.url || i.src)))
    .filter(Boolean);
  return [...new Set(imgs)];
}

function absoluteUrl(u) {
  if (/^https?:\/\//i.test(u)) return u;
  return SITE_ORIGIN + '/' + String(u).replace(/^\.?\//, '');
}

// ---------- Validation ----------
function validateRecipes(recipes) {
  const errors = [];
  const seen = new Map();
  for (const { file, data, manifestId } of recipes) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      errors.push(`${file}: recipe must be a JSON object.`);
      continue;
    }
    const r = normalizeRecipe(data, manifestId);
    if (!r.title.trim()) errors.push(`${file}: missing "name".`);
    if (!r.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.id)) {
      errors.push(`${file}: invalid or missing recipe id "${r.id}" (use lowercase letters, numbers, hyphens).`);
    }
    if (seen.has(r.id)) errors.push(`${file}: duplicate recipe id "${r.id}" (already used by ${seen.get(r.id)}).`);
    else seen.set(r.id, file);
    if (!r.ingredients.length) errors.push(`${file}: no ingredients found (expected an INGREDIENTS or similar section in "text").`);
    if (!r.steps.length) errors.push(`${file}: no method found (expected a METHOD section in "text").`);
  }
  return errors;
}

// ---------- Rendering ----------
const FRACTIONS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const QTY_RE = /^(About\s+)?((?:\d+\s*)?[¼½¾⅓⅔⅛⅜⅝⅞]|\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)(.*)$/;

function parseQty(text) {
  const t = text.trim();
  const uni = t.match(/^(\d+)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])$/);
  if (uni) return (uni[1] ? Number(uni[1]) : 0) + FRACTIONS[uni[2]];
  let total = 0;
  for (const part of t.split(/\s+/)) {
    if (part.includes('/')) { const [a, b] = part.split('/').map(Number); total += a / b; }
    else total += Number(part);
  }
  return total;
}

function ingredientHtml(line) {
  const m = String(line).match(QTY_RE);
  // Ranges like "10-12" are left unscaled.
  if (!m || /^\s*[–-]\s*\d/.test(m[3])) return `<li>${escapeHtml(line)}</li>`;
  const qty = parseQty(m[2]);
  if (!Number.isFinite(qty) || qty <= 0) return `<li>${escapeHtml(line)}</li>`;
  return `<li>${escapeHtml(m[1] || '')}<span class="qty" data-base="${qty}">${escapeHtml(m[2].trim())}</span>${escapeHtml(m[3])}</li>`;
}

function scaleLabel(n) {
  const map = { 0.25: '1/4x', 0.5: '1/2x', 0.75: '3/4x' };
  return map[n] || `${n}x`;
}

function recipeJsonLd(r, canonical) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: r.title,
    description: r.description,
    image: r.images.map(absoluteUrl),
    url: canonical,
    recipeIngredient: r.ingredients,
    recipeInstructions: r.steps.map(text => ({ '@type': 'HowToStep', text }))
  };
  if (r.categories.length) ld.recipeCategory = r.categories.join(', ');
  return JSON.stringify(ld).replace(/</g, '\\u003c');
}

// Your home page keeps its design inside index.html, so recipe pages reuse that exact CSS.
let SITE_CSS = '';

const EXTRA_CSS = `
.site-title{font:normal clamp(35px,6vw,54px) Georgia,serif;margin:12px 0}
.site-title a{color:#fff;text-decoration:none}
.back-link{display:inline-block;margin-bottom:14px;color:#711f58;font-weight:700;text-decoration:none}
.recipe-card{background:#fff;border:1px solid #dce0d5;border-radius:12px;padding:24px 28px;margin:12px 0}
.recipe-card h1{font:normal clamp(28px,5vw,40px) Georgia,serif;color:#711f58;margin:0 0 6px}
.recipe-card h2{font:normal 24px Georgia,serif;color:#711f58;margin:26px 0 8px}
.recipe-card li{line-height:1.7}
.recipe-card .lead{color:#657466;margin:0 0 8px}
.recipe-card .source{color:#657466;font-size:13px;margin-top:22px}
.recipe-list{line-height:1.9}
.recipe-list a{color:#711f58}
`;

function layout({ title, description, canonical, main, head = '', script = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<style>${SITE_CSS}${EXTRA_CSS}</style>
${head}
</head>
<body>
<header><a class="about-btn" href="/about.html">DAVID &amp; DONNA</a><div class="site-title"><a href="/">The Well-Seasoned Life</a></div><p>Come hungry. Stay awhile. Recipes, pantry notes, and good food from David &amp; Donna.</p></header>
<main>
${main}
<footer>The Well-Seasoned Life · Come hungry. Stay awhile.</footer>
</main>
${script}
</body>
</html>
`;
}

const UTENSIL_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><g transform="rotate(-42 24 24)"><path d="M17 6v11M13 6v11M21 6v11M13 17c0 4 2 6 4 6s4-2 4-6M17 23v19"/></g><g transform="rotate(42 24 24)"><ellipse cx="31" cy="13" rx="5.5" ry="8"/><path d="M31 21v21"/></g></svg>';

// Same scaling and comments/ratings behavior as the home page; comments are keyed by the recipe name.
const CLIENT_SCRIPT = `<script>
(function(){
  var fr={0.0625:'1/16',0.125:'⅛',0.25:'¼',0.333:'⅓',0.375:'⅜',0.5:'½',0.625:'⅝',0.667:'⅔',0.75:'¾',0.875:'⅞'};
  function fmt(n){var w=Math.floor(n+0.02),f=n-w,best='';
    for(var k in fr){if(Math.abs(f-parseFloat(k))<0.02){best=fr[k];break}}
    if(best)return (w?w+(best.length>1?' ':''):'')+best;
    if(f<0.02||f>0.98)return String(Math.round(n));
    return String(Math.round(n*100)/100);}
  var scaleBtns=document.querySelectorAll('.scale-controls button');
  scaleBtns.forEach(function(btn){
    btn.addEventListener('click',function(){
      var m=parseFloat(btn.dataset.m);
      document.querySelectorAll('.qty').forEach(function(q){q.textContent=fmt(parseFloat(q.dataset.base)*m)});
      scaleBtns.forEach(function(b){b.classList.toggle('active',b===btn)});
    });
  });
  var sec=document.getElementById('comments'); if(!sec)return;
  var API=sec.dataset.api, rid=sec.dataset.recipeId;
  var list=sec.querySelector('.comments-list'), form=sec.querySelector('form'), help=sec.querySelector('.rating-help'),
      status=sec.querySelector('.comment-status'), submit=form.querySelector('button[type=submit]'),
      buttons=[].slice.call(sec.querySelectorAll('.utensil-rating button')), rating=0;
  var svg=sec.dataset.svg;
  function set(v){rating=v;buttons.forEach(function(b,i){b.classList.toggle('selected',i<v);b.setAttribute('aria-checked',String(i+1===v))});help.textContent=v+' of 5 selected'}
  buttons.forEach(function(b,i){b.addEventListener('click',function(){set(i+1)})});
  function load(){
    fetch(API+'?recipe_id='+encodeURIComponent(rid),{cache:'no-store'}).then(function(r){return r.json().then(function(d){return [r,d]})}).then(function(x){
      var r=x[0],d=x[1]; if(!r.ok||!d.ok)throw Error(d.error);
      list.textContent='';
      if(!d.comments.length){list.textContent='No approved comments yet. Be the first to comment.';return}
      d.comments.forEach(function(c){
        var card=document.createElement('article');card.className='comment-card';
        var who=document.createElement('strong');who.textContent=c.display_name;
        var icons=document.createElement('span');icons.className='comment-rating';icons.setAttribute('aria-label',c.rating+' of 5');
        for(var i=0;i<c.rating;i++)icons.insertAdjacentHTML('beforeend',svg);
        var p=document.createElement('p');p.textContent=c.body;
        card.appendChild(who);card.appendChild(icons);card.appendChild(p);list.appendChild(card);
      });
    }).catch(function(){list.textContent='Comments could not be loaded.'});
  }
  form.addEventListener('submit',function(ev){
    ev.preventDefault();
    if(!rating){status.textContent='Choose a rating before submitting.';return}
    submit.disabled=true;status.textContent='Submitting…';
    fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipe_id:rid,display_name:form.elements.display_name.value.trim(),body:form.elements.body.value.trim(),rating:rating})})
    .then(function(r){return r.json().then(function(d){return [r,d]})}).then(function(x){
      if(!x[0].ok||!x[1].ok)throw Error(x[1].error);
      form.reset();rating=0;buttons.forEach(function(b){b.classList.remove('selected')});
      help.textContent='Choose 1 to 5 fork-and-spoon ratings.';
      status.textContent='Comment submitted. It will appear after approval.';
    }).catch(function(err){status.textContent=err.message||'Comment could not be submitted.'})
    .then(function(){submit.disabled=false});
  });
  load();
})();
</script>`;

function statsHtml(r) {
  const box = (v, l) => `<div class="stat"><b>${escapeHtml(v)}</b><span>${l}</span></div>`;
  return `<div class="stats">${box(r.cal ?? 'TBD', 'CALORIES / SERVING')}${box(r.p == null ? 'TBD' : r.p + ' g', 'PROTEIN / SERVING')}${box(r.na == null ? 'TBD' : r.na + ' mg', 'SODIUM / SERVING')}</div>`;
}

function sectionHtml(sec) {
  const h = sec.title ? `<h2>${escapeHtml(sec.title)}</h2>` : '';
  if (sec.kind === 'ingredients') return `${h}<ul>${sec.lines.map(ingredientHtml).join('')}</ul>`;
  if (sec.kind === 'method') return `${h}<ol>${sec.lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ol>`;
  return `${h}${sec.lines.map(l => `<p>${escapeHtml(l)}</p>`).join('')}`;
}

function renderRecipePage(r) {
  const canonical = `${SITE_ORIGIN}/recipes/${r.id}/`;
  const desc = r.description ? `${r.title} - ${r.description}` : `${r.title} - a recipe from The Well-Seasoned Life.`;
  const head = r.images.length
    ? `<script type="application/ld+json">${recipeJsonLd(r, canonical)}</script>` : '';
  const main = `
<a class="back-link" href="/">← Back to the Cook Book</a>
<article class="recipe-card" id="recipe-${escapeHtml(r.id)}">
  <h1>${escapeHtml(r.title)}</h1>
  ${r.description ? `<p class="lead">${escapeHtml(r.description)}</p>` : ''}
  ${r.categories.length ? `<span class="recipe-category">${r.categories.map(escapeHtml).join(' · ')}</span>` : ''}
  ${r.images[0] ? `<img src="${escapeHtml(r.images[0])}" alt="${escapeHtml(r.title)}" style="max-width:100%;border-radius:10px;margin-top:14px">` : ''}
  ${statsHtml(r)}
  <div class="scale-controls" style="margin:18px 0">
    ${r.scaleOptions.map(n => `<button type="button" data-m="${n}" class="${n === 1 ? 'active' : ''}">${scaleLabel(n)}</button>`).join('\n    ')}
  </div>
  ${r.sections.map(sectionHtml).join('\n  ')}
  ${r.source ? `<p class="source">${escapeHtml(r.source)}</p>` : ''}
  <section id="comments" class="comments-section" data-recipe-id="${escapeHtml(r.title)}" data-api="${escapeHtml(COMMENTS_API)}" data-svg="${escapeHtml(UTENSIL_SVG)}">
    <h3>Comments &amp; Ratings</h3>
    <div class="comments-list">Loading comments…</div>
    <form class="comment-form">
      <label for="cf-name">Display name</label>
      <input id="cf-name" name="display_name" required maxlength="100" placeholder="Your name">
      <label>Rating</label>
      <div class="utensil-rating" role="radiogroup">${[1, 2, 3, 4, 5].map(i => `<button type="button" role="radio" aria-label="${i} of 5">${UTENSIL_SVG}</button>`).join('')}</div>
      <p class="rating-help">Choose 1 to 5 fork-and-spoon ratings.</p>
      <label for="cf-body">Comment</label>
      <textarea id="cf-body" name="body" required maxlength="5000" rows="5" placeholder="Share your thoughts about this recipe…"></textarea>
      <button type="submit">Submit comment</button>
      <p class="comment-status" aria-live="polite"></p>
    </form>
  </section>
</article>`;
  return layout({ title: `${r.title} | The Well-Seasoned Life`, description: desc, canonical, main, head, script: CLIENT_SCRIPT });
}

function renderIndexPage(entries) {
  const main = `
<a class="back-link" href="/">← Back to the Cook Book</a>
<section class="recipe-card">
<h1>All Recipes</h1>
<ul class="recipe-list">
${entries.map(e => `  <li><a href="/recipes/${escapeHtml(e.id)}/">${escapeHtml(e.title)}</a>${e.description ? ` - ${escapeHtml(e.description)}` : ''}</li>`).join('\n')}
</ul>
</section>`;
  return layout({
    title: 'All Recipes | The Well-Seasoned Life',
    description: `Browse all ${entries.length} recipes from The Well-Seasoned Life.`,
    canonical: `${SITE_ORIGIN}/recipes/`,
    main
  });
}

function renderNotesPage(notes) {
  const cards = notes.map(n => `
<article class="recipe-card">
  <h2 style="margin-top:0">${escapeHtml(n.title || 'Untitled')}</h2>
  ${n.date ? `<p class="lead">${escapeHtml(n.date)}</p>` : ''}
  ${String(n.text || '').replace(/\r\n?/g, '\n').split(/\n+/).filter(Boolean).map(l => `<p>${escapeHtml(l)}</p>`).join('')}
</article>`).join('\n');
  const main = `
<a class="back-link" href="/">← Back to the Cook Book</a>
<h1 style="font:normal clamp(30px,5vw,44px) Georgia,serif;color:#711f58;margin:6px 0 4px">David's Kitchen Notes</h1>
<p class="lead" style="color:#604a55">Tips, tricks, and rants from the kitchen.</p>
${cards}`;
  return layout({
    title: "David's Kitchen Notes | The Well-Seasoned Life",
    description: 'Tips, tricks, and rants from David in the kitchen.',
    canonical: `${SITE_ORIGIN}/notes/`,
    main
  });
}

// ---------- Build ----------
async function copySite() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });
  for (const entry of await fs.readdir(ROOT, { withFileTypes: true })) {
    if (excludedRootNames.has(entry.name)) continue;
    // Byte-for-byte copy; food-border images are never modified.
    await fs.cp(path.join(ROOT, entry.name), path.join(DIST, entry.name), { recursive: true });
  }
}

async function main() {
  const manifest = await readJson(path.join(RECIPES_DIR, 'index.json'));
  const list = Array.isArray(manifest) ? manifest : manifest.recipes;
  if (!Array.isArray(list)) throw new Error('recipes/index.json must be an array (or an object with a "recipes" array).');

  const recipes = [];
  for (const item of list) {
    const file = getManifestFilename(item);
    if (file.includes('..') || path.isAbsolute(file)) throw new Error(`Unsafe recipe filename: ${file}`);
    let data;
    try { data = await readJson(path.join(RECIPES_DIR, file)); }
    catch (err) { throw new Error(`${file}: could not read recipe (${err.message})`); }
    recipes.push({ file, data, manifestId: (item && item.id) || '' });
  }

  const errors = validateRecipes(recipes);
  if (errors.length) {
    console.error('Validation failed:\n - ' + errors.join('\n - '));
    process.exit(1);
  }
  console.log(`Validated ${recipes.length} recipes.`);
  if (validateOnly) return;

  try {
    const home = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
    const m = home.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    SITE_CSS = m ? m[1] : '';
  } catch { SITE_CSS = ''; }
  if (!SITE_CSS) console.warn('Warning: could not read styles from index.html; recipe pages will be unstyled.');

  await copySite();

  const entries = [];
  for (const { data, manifestId } of recipes) {
    const r = normalizeRecipe(data, manifestId);
    entries.push({ id: r.id, title: r.title, description: r.description });
    const dir = path.join(DIST, 'recipes', r.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), renderRecipePage(r));
  }
  await fs.writeFile(path.join(DIST, 'recipes', 'index.html'), renderIndexPage(entries));

  let hasNotes = false;
  try {
    const notes = await readJson(path.join(ROOT, 'data', 'notes.json'));
    if (Array.isArray(notes)) {
      await fs.mkdir(path.join(DIST, 'notes'), { recursive: true });
      await fs.writeFile(path.join(DIST, 'notes', 'index.html'), renderNotesPage(notes));
      hasNotes = true;
    }
  } catch { /* no notes file yet: skip the notes page */ }

  const urls = [`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/recipes/`, `${SITE_ORIGIN}/about.html`,
    ...(hasNotes ? [`${SITE_ORIGIN}/notes/`] : []),
    ...entries.map(e => `${SITE_ORIGIN}/recipes/${e.id}/`)];
  await fs.writeFile(path.join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${escapeHtml(u)}</loc></url>`).join('\n') + `\n</urlset>\n`);
  await fs.writeFile(path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`);

  console.log(`Built ${entries.length} recipe pages into dist/.`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
