import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {scaleIngredients} from '../scripts/recipe-scaling.mjs';
const root = process.cwd();
const run = (cwd, ...args) => spawnSync(process.execPath,[path.join(root,'scripts/build-recipes.mjs'),...args],{cwd,encoding:'utf8'});
test('ingredient scaling handles mixed fractions, unicode and ranges without changing method or nutrition',()=>{
 const original='INGREDIENTS\n1 3/4 lb chicken\n½ tsp salt\n1-2 tbsp water\nAbout 1 lb salmon\n\nMETHOD\n1. Bake at 400 F for 20 minutes\nNUTRITION\n312 calories';
 assert.equal(scaleIngredients(original,2),'INGREDIENTS\n3.5 lb chicken\n1 tsp salt\n2-4 tbsp water\nAbout 2 lb salmon\n\nMETHOD\n1. Bake at 400 F for 20 minutes\nNUTRITION\n312 calories');
 assert.equal(scaleIngredients(original,1),original);
});
test('build preserves public data and artwork and produces crawlable recipe HTML', async()=>{
 assert.equal(run(root).status,0);
 for(const file of ['food-border-left.webp','food-border-right.webp','data/pantry.json','recipes/index.json'])assert.deepEqual(await fs.readFile('dist/'+file),await fs.readFile(file));
 const manifest=JSON.parse(await fs.readFile('recipes/index.json'));
 for(const item of manifest){
 const record=JSON.parse(await fs.readFile('recipes/'+item.file));
 const html=await fs.readFile('dist/recipes/'+item.id+'/index.html','utf8');
 assert.ok(html.includes(record.name));assert.match(html,/rel="canonical"/);assert.match(html,/data-scale="0.25"/);assert.match(html,/falling-king-6c41/);assert.match(html,/recipe_id:e.name/);
 assert.ok(html.includes(record.text.split('\n')[0]));
 assert.equal(html.includes('application/ld+json'),Boolean(record.image||record.images?.length));
 }
 await assert.rejects(fs.stat('dist/editor/worker.mjs'));
 await assert.rejects(fs.stat('dist/package.json'));
 assert.match(await fs.readFile('dist/index.html','utf8'),/data\/pantry.json/);
});
test('invalid and duplicate IDs fail before touching output; image JSON-LD is safe', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wsl-build-'));
 try{
 await fs.mkdir(path.join(dir,'recipes'));await fs.mkdir(path.join(dir,'dist'));await fs.writeFile(path.join(dir,'dist/keep'),'existing');
 await fs.copyFile('index.html',path.join(dir,'index.html'));
 const record={name:'Test </script>',sub:'Description',text:'INGREDIENTS\n1 cup water\nMETHOD\n1. Stir.',categories:[],image:'/test.jpg'};
 for(const f of ['one','two'])await fs.writeFile(path.join(dir,'recipes',f+'.json'),JSON.stringify(record));
 const manifest=[{id:'same',file:'one.json'},{id:'same',file:'two.json'}];
 await fs.writeFile(path.join(dir,'recipes/index.json'),JSON.stringify(manifest));
 const duplicate=run(dir,'--validate-only');assert.equal(duplicate.status,1);assert.match(duplicate.stderr,/Duplicate recipe ID/);
 assert.equal(await fs.readFile(path.join(dir,'dist/keep'),'utf8'),'existing');
 manifest[1].id='two';await fs.writeFile(path.join(dir,'recipes/index.json'),JSON.stringify(manifest));
 await fs.mkdir(path.join(dir,'scripts'));await fs.copyFile('scripts/recipe-scaling.mjs',path.join(dir,'scripts/recipe-scaling.mjs'));
 assert.equal(run(dir).status,0);
 const html=await fs.readFile(path.join(dir,'dist/recipes/same/index.html'),'utf8');
 const schema=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
 assert.equal(schema.name,record.name);assert.deepEqual(schema.recipeIngredient,['1 cup water']);assert.equal(schema.image[0],'https://the-well-seasoned-life.dking63.workers.dev/test.jpg');
 record.image='javascript:alert(1)';await fs.writeFile(path.join(dir,'recipes/one.json'),JSON.stringify(record));assert.equal(run(dir,'--validate-only').status,1);
 manifest[0].file='../outside.json';await fs.writeFile(path.join(dir,'recipes/index.json'),JSON.stringify(manifest));assert.equal(run(dir,'--validate-only').status,1);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
