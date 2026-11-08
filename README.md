# well-seasoned-life
The Well-Seasoned Life website

## Pre-rendered recipe pages

Requires Node.js 22 or later. The searchable home cookbook, Pantry, public editor,
comments/rating service, and original border artwork remain in place.

```sh
npm install
npm run validate
npm test
npm run build
npx wrangler deploy
```

Cloudflare Workers Builds settings:
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

Wrangler serves `dist` and retains the existing editor Worker, ASSETS binding,
and `/api/editor/*` routing. Keep the existing `GITHUB_TOKEN` and `EDITOR_KEY`
Worker secrets in Cloudflare; do not put credentials in files. The Worker source,
configuration, tests, scripts, dotfiles and dependency files are excluded from
public assets. The browser editor files remain public as before.

The build reads `recipes/index.json` (filenames or `{id,file}` objects), validates
all records before changing output, rejects duplicate IDs/files, mismatched IDs,
unsafe paths, invalid image URLs and unlisted recipes, and generates:
- `dist/recipes/{id}/index.html` with complete initial HTML and canonical metadata
- `dist/recipes/index.html` with links to every recipe
- `dist/sitemap.xml` and `dist/robots.txt`

Use `image` (URL string) or `images` (array of URL strings) to include real recipe
photos. Recipe JSON-LD is emitted only for recipes with an image. No placeholder
photos, ratings or nutrition are invented. Relative photo URLs resolve from the
site root. Change the ORIGIN constant in `scripts/build-recipes.mjs` if the public
domain changes. Comments retain recipe-name identifiers so existing threads
remain attached. Individual-page scaling changes ingredient amounts only,
including mixed fractions and ranges; instructions and per-serving nutrition
stay unchanged. No recipe JSON or border image is rewritten by the build.

New public static asset formats must be added to `publicTypes` in the build
script. Recipe pages reuse the cookbook's CSS and comments/rating implementation;
the build fails if those source hooks cannot be found after a future refactor.
