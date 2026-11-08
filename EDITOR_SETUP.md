# Recipe editor installation

Prepared for dking63-gif/well-seasoned-life, branch main.

## What is included

- editor.html and editor/style.css: recipe editing interface.
- editor/app.mjs and editor/format.mjs: site-native imports, exports, paste formatting, drafts, preview and save controls.
- editor/worker.mjs: same-origin authenticated GitHub save service.
- wrangler.jsonc: retains the existing Worker name, adds the service entry point and ASSETS binding.
- .assetsignore: prevents publishing server source, tests, and setup documents as website assets.
- tests/editor.test.mjs: local checks.

No recipe files, pantry files, public homepage or comments service are changed.

## Installation

1. Copy the included files into the existing repository root, keeping their directories. Merge .assetsignore with an existing file if one has since been added. Review the wrangler.jsonc change against the current version before replacing it.
2. Configure these secrets on the **the-well-seasoned-life** Worker using Cloudflare's secure dashboard or Wrangler's interactive secret commands:
   - GITHUB_TOKEN: a fine-grained GitHub token restricted to this repository with Contents read/write permission. Keep it on the server only.
   - EDITOR_KEY: a unique, randomly generated high-entropy editor key (at least 32 random bytes). This is the key entered into the editor login dialog. Do not reuse a normal account password.
   Do not place either secret in source files, GitHub commits, chat messages or download packages. Secrets on a separate existing editor Worker are not automatically available to this Worker.
3. Merge the files to main and run the existing Cloudflare deployment. This now deploys a Worker with static assets, rather than static assets alone. If the dashboard's existing build configuration differs, review its deploy command; standard Wrangler deployment reads the included configuration.
4. Open https://the-well-seasoned-life.dking63.workers.dev/editor.html and select Connect live saving. Enter only the editor key, never the GitHub token.
5. Select an existing recipe, change it, preview it and click Save to website. GitHub receives the commit. The public site updates after the existing Cloudflare Git deployment completes. Verify a real publish after deployment before relying on the editor.

Anyone may load the interface and public recipes. Authentication protects repository writes; the interface itself is not an access-controlled private page. Keys are held only in page memory. No delete-recipe endpoint is provided.

## Editing behavior

Current format: name, sub, categories, text, optional cal/p/servings, and additional recipe-specific fields preserved as-is. The recipe index determines IDs and filenames; do not infer filenames from titles when updating existing recipes.

Pasted ingredient rows are explicitly inserted into the INGREDIENTS section. The rest of the complete recipe remains ordinary editable text. Whole recipes can be pasted directly into Complete recipe text; enter the recipe name and categories separately. This version does not automatically extract whole recipes into every field.

Nutrition is not calculated. Existing detailed nutrition_estimate fields are preserved, not recomputed when ingredients change. Update those estimates separately when necessary. The public recipe scaler is unchanged; its existing limitations with historical fractions, ranges, and nutrition text remain. New pasted fractions are normalized to decimals so ordinary ingredient quantities work with its current parser.

Drafts use browser storage and are not synced between devices. Download recipe makes a site-native JSON backup. Save draft does not publish.

Concurrent edits are detected using the GitHub branch head. Save a draft, reload and reapply changes if another commit has occurred. A new recipe and the manifest are added in one commit. Existing filename aliases are retained.

## Validation performed

Run from the repository root:

    node --test tests/editor.test.mjs
    node --check editor/app.mjs

Verified fraction parsing, ambiguous-line preservation, lossless round trips for all nine current recipes, ingredient section replacement, authentication and origin rejection, atomic manifest updates and existing filename mappings. Browser interaction and real Cloudflare/GitHub publishing have not been verified in this session. No changes have been pushed or deployed.
