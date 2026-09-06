import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';import {parseEnv} from 'node:util';import {randomBytes} from 'node:crypto';import {createClient} from '@supabase/supabase-js';import {createServerClient} from '@supabase/ssr';import {chromium,expect} from '@playwright/test';
const e=parseEnv(readFileSync('.env.local','utf8'));if(new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname!=='vhwnkwhiwnaqalngwjnl.supabase.co')throw Error('Wrong project');
const admin=createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});const check=r=>{if(r.error)throw Error(r.error.message);return r.data};
const marker='sidebar-review-'+Date.now(),password=randomBytes(24).toString('base64url');
const user=check(await admin.auth.admin.createUser({email:marker+'@paperflow.test',password,email_confirm:true,user_metadata:{full_name:'Alexandra Morgan Researcher'},app_metadata:{verification:marker}})).user;
const jar=new Map();const client=createServerClient(e.NEXT_PUBLIC_SUPABASE_URL,e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:cs=>cs.forEach(c=>jar.set(c.name,c.value))}});
mkdirSync('tmp/sidebar-verification',{recursive:true});
let browser;
try{
 check(await client.auth.signInWithPassword({email:user.email,password}));
 browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:960}});
 await context.addCookies([...jar].map(([name,value])=>({name,value,domain:'localhost',path:'/',sameSite:'Lax'})));
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://localhost:3001/library');
 const sidebar=page.getByRole('complementary',{name:'Library sidebar'}),toggle=sidebar.locator('.sidebar-toggle');
 await expect(toggle).toBeVisible();await page.evaluate(()=>document.fonts.ready);
 await expect(sidebar.locator('.brand')).toHaveText('/paperflow');
 await expect(sidebar.locator('.brand svg')).toHaveCount(0);
 // Measure every animation frame. The fixed icon anchors and footer must not move.
 const motion=await page.evaluate(async()=>{
  const bar=document.querySelector('.workspace-sidebar'),main=document.querySelector('.workspace-main');
  const selectors=['.sidebar-toggle svg','.sidebar-link svg','.profile-trigger .avatar'];
  const sample=()=>({width:bar.getBoundingClientRect().width,mainX:main.getBoundingClientRect().x,scrollLeft:bar.scrollLeft,points:selectors.map(selector=>{const r=bar.querySelector(selector).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})});
  const baseline=sample(),frames=[];
  for(let cycle=0;cycle<12;cycle++){
   bar.querySelector('.sidebar-toggle').click();const start=performance.now();
   while(performance.now()-start<310){await new Promise(requestAnimationFrame);frames.push(sample());}
  }
  // Reverse an in-flight transition repeatedly without waiting for completion.
  for(let cycle=0;cycle<20;cycle++){
   bar.querySelector('.sidebar-toggle').click();const start=performance.now();
   while(performance.now()-start<35){await new Promise(requestAnimationFrame);frames.push(sample());}
  }
  const start=performance.now();while(performance.now()-start<310){await new Promise(requestAnimationFrame);frames.push(sample());}
  return {baseline,frames,final:sample()};
 });
 const drift=Math.max(...motion.frames.flatMap(frame=>frame.points.map((point,i)=>Math.max(Math.abs(point.x-motion.baseline.points[i].x),Math.abs(point.y-motion.baseline.points[i].y)))));
 const panelGap=Math.max(...motion.frames.map(frame=>Math.abs(frame.mainX-frame.width)));
 expect(drift).toBeLessThanOrEqual(0.75);expect(panelGap).toBeLessThanOrEqual(1);expect(motion.final.width).toBe(236);
 expect(motion.frames.every(frame=>frame.width>=75.9&&frame.width<=236.1&&frame.scrollLeft===0)).toBe(true);
 expect(motion.frames.filter(frame=>frame.width>80&&frame.width<230).length).toBeGreaterThan(20);
 const viewports=[];
 for(const width of [1440,1024,768,641]){
  await page.setViewportSize({width,height:720});
  for(const collapsed of [true,false]){
   await toggle.click();await expect(sidebar).toHaveAttribute('data-collapsed',String(collapsed));
   await expect.poll(()=>sidebar.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(collapsed?76:236);
   const trigger=sidebar.getByRole('button',{name:/Open profile menu/});await trigger.focus();
   expect(await sidebar.evaluate(el=>el.scrollLeft)).toBe(0);
   const bounds=await sidebar.locator('footer').boundingBox();expect(Math.abs(720-bounds.y-bounds.height-18)).toBeLessThan(1);
   await trigger.click();const profile=page.getByRole('dialog',{name:'Your profile'});await expect(profile).toBeVisible();
   const box=await profile.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
   await page.keyboard.press('Escape');await expect(profile).not.toBeVisible();await expect(trigger).toBeFocused();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   viewports.push({width,collapsed,footerBottomGap:720-bounds.y-bounds.height});
  }
 }
 await page.setViewportSize({width:1440,height:960});await page.screenshot({animations:'disabled',path:'tmp/sidebar-verification/expanded.png'});
 await toggle.click();await expect.poll(()=>sidebar.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(76);await page.screenshot({animations:'disabled',path:'tmp/sidebar-verification/collapsed.png'});
 for(const width of [640,390,320]){
  await page.setViewportSize({width,height:844});
  expect(await page.locator('.workspace-main').evaluate(el=>el.getBoundingClientRect().x)).toBe(0);
  const open=page.getByLabel('Open sidebar'),drawer=page.getByRole('dialog',{name:'Library menu'});
  for(let cycle=0;cycle<3;cycle++){
   await open.click();await expect(drawer).toBeVisible();await drawer.getByRole('button',{name:/Open profile menu/}).click();const profile=page.getByRole('dialog',{name:'Your profile'});await expect(profile).toBeVisible();
   if(width===390&&cycle===0)await page.screenshot({animations:'disabled',path:'tmp/sidebar-verification/mobile-profile.png'});
   await page.keyboard.press('Escape');await expect(profile).not.toBeVisible();await expect(drawer).toBeVisible();await page.keyboard.press('Escape');await expect(drawer).not.toBeVisible();await expect(open).toBeFocused();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 // Resizing with a menu open must release the native dialog's focus trap.
 await page.getByLabel('Open sidebar').click();await page.setViewportSize({width:1440,height:500});await expect(page.getByRole('dialog',{name:'Library menu'})).not.toBeVisible();
 await expect(toggle).toBeVisible();await page.emulateMedia({reducedMotion:'reduce'});await toggle.click();
 const duration=await sidebar.evaluate(el=>getComputedStyle(el).transitionDuration);expect(duration.split(',').every(value=>parseFloat(value)<=0.001)).toBe(true);
 const trigger=sidebar.getByRole('button',{name:/Open profile menu/});await trigger.click();const profile=page.getByRole('dialog',{name:'Your profile'});await expect(profile.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();await profile.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL('http://localhost:3001/');
 await page.goto('http://localhost:3001/library');await expect(page).toHaveURL(/auth.*sign-in/);expect(errors).toEqual([]);
 const report={animationFrames:motion.frames.length,normalToggles:12,rapidReversals:20,maxIconDriftPx:drift,maxContentGapPx:panelGap,desktopViewports:viewports,mobileWidths:[640,390,320],mobileMenuCycles:9,reducedMotion:true,logout:true,errors};
 writeFileSync('tmp/sidebar-verification/report.json',JSON.stringify(report,null,2));console.log(report);
}finally{await browser?.close();await client.auth.signOut();const verified=check(await admin.auth.admin.getUserById(user.id)).user;if(verified.app_metadata.verification!==marker)throw Error('Cleanup guard');check(await admin.auth.admin.deleteUser(user.id));console.log('Temporary sidebar test account removed.');}
