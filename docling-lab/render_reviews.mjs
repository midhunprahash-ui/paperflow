// Optional local visual QA using the parent repository's Playwright installation.
import {chromium} from 'playwright';
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const run=process.argv[2] || 'baseline';
const browser=await chromium.launch({headless:true});
try {
  for(const name of await readdir(path.join(root,'outputs',run))){
    const dir=path.join(root,'outputs',run,name);
    try{JSON.parse(await readFile(path.join(dir,'quality.json'),'utf8'))}catch{continue}
    const page=await browser.newPage({viewport:{width:1600,height:1100}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(dir,'review.html')).href);
    await page.evaluate(()=>document.fonts.ready);
    await mkdir(path.join(dir,'screenshots'),{recursive:true});
    await page.screenshot({path:path.join(dir,'screenshots','first-page.png')});
    const inlineImages=await page.locator('article img.inline-source').evaluateAll(images=>images.map(i=>({src:i.getAttribute('src'),width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height,loaded:i.complete&&i.naturalWidth>0})));
    if(inlineImages.length){
      const inline=JSON.parse(await readFile(path.join(dir,'inline-content.json'),'utf8'));
      const sourcePage=inline.blocks.find(b=>b.source_crops.length).page;
      await page.locator(`#source-${sourcePage}`).evaluate(e=>e.scrollIntoView({block:'start'}));
      await page.locator('article img.inline-source').first().scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(dir,'screenshots','inline-first.png')});
    }
    const broken=await page.locator('article img').evaluateAll(images=>images.filter(i=>i.complete && !i.naturalWidth).map(i=>i.getAttribute('src')));
    const brokenOutline=await page.locator('header details a').evaluateAll(links=>links.filter(a=>!document.getElementById(a.getAttribute('href').slice(1))).map(a=>a.textContent));
    if(name==='camera-ready'){
      await page.locator('#source-4').scrollIntoViewIfNeeded();
      await page.getByRole('heading',{name:/Mathematical Formalisms/}).scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(dir,'screenshots','math.png')});
      await page.locator('#source-3').scrollIntoViewIfNeeded();
      await page.locator('article strong').filter({hasText:'The final curated dataset includes five groups'}).scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(dir,'screenshots','dataset.png')});
      await page.locator('#source-6').scrollIntoViewIfNeeded();
      await page.locator('article li').filter({hasText:'Komati, N.'}).scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(dir,'screenshots','references.png')});
      if(await page.locator('.source-inline').count()){
        for(const [id,sourcePage,label] of [['102',4,'input'],['112',4,'arrows'],['123',5,'loss']]){
          await page.locator(`#source-${sourcePage}`).evaluate(e=>e.scrollIntoView({block:'start'}));
          await page.locator(`[data-block-id="#/texts/${id}"]`).evaluate(e=>e.scrollIntoView({block:'start'}));
          await page.screenshot({path:path.join(dir,'screenshots',`inline-${label}.png`)});
        }
      }
    }
    await writeFile(path.join(dir,'browser-check.json'),JSON.stringify({errors,broken_images:broken,broken_outline:brokenOutline,inline_images:inlineImages},null,2));
    console.log(name,{errors:errors.length,broken_images:broken.length,broken_outline:brokenOutline.length});
    await page.close();
  }
} finally {await browser.close()}
