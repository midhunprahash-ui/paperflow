import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';import {parseEnv} from 'node:util';import {randomBytes} from 'node:crypto';import {createClient} from '@supabase/supabase-js';import {createServerClient} from '@supabase/ssr';import {chromium,expect} from '@playwright/test';
const e=parseEnv(readFileSync('.env.local','utf8'));if(new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname!=='vhwnkwhiwnaqalngwjnl.supabase.co')throw Error('Wrong project');
const admin=createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});const check=r=>{if(r.error)throw Error(r.error.message);return r.data};
const marker='workspace-review-'+Date.now(),password=randomBytes(24).toString('base64url');
const user=check(await admin.auth.admin.createUser({email:marker+'@paperflow.test',password,email_confirm:true,user_metadata:{full_name:'Alexandra Morgan Researcher with a very long family name'},app_metadata:{verification:marker}})).user;
const jar=new Map();const client=createServerClient(e.NEXT_PUBLIC_SUPABASE_URL,e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:cs=>cs.forEach(c=>jar.set(c.name,c.value))}});
mkdirSync('tmp/workspace-verification',{recursive:true});
const base=process.env.CHECK_BASE || 'http://localhost:3008';
let browser;
try {
 check(await client.auth.signInWithPassword({email:user.email,password}));
 browser=await chromium.launch();const context=await browser.newContext();
 await context.addCookies([...jar].map(([name,value])=>({name,value,url:base,sameSite:'Lax'})));
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/library');
 for (const width of [1440,768,390,320]) {
  await page.setViewportSize({width,height:900});
  const trigger=page.getByRole('button',{name:/Open profile menu/});await expect(trigger).toBeVisible();
  await expect(page.locator('.workspace-sidebar,.workspace-mobilebar')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const bounds=await trigger.boundingBox();expect(bounds.x).toBeLessThan(25);expect(bounds.width).toBeLessThanOrEqual(220);expect(900-bounds.y-bounds.height).toBeLessThan(30);
  await trigger.click();const dialog=page.getByRole('dialog',{name:'Your profile'});await expect(dialog).toBeVisible();await expect(dialog.getByRole('heading')).toHaveText(user.user_metadata.full_name);
  await page.screenshot({path:`tmp/workspace-verification/profile-${width}.png`});
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
 }
 await page.getByRole('button',{name:'Toggle light and dark theme'}).click();await expect(page.locator('[data-sonner-toast][data-type="info"]').first()).toBeVisible();
 await page.getByRole('button',{name:/Open profile menu/}).click();await page.getByRole('dialog',{name:'Your profile'}).getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(base+'/');
 await page.goto(base+'/library');await expect(page).toHaveURL(/auth.*sign-in/);expect(errors).toEqual([]);
 const report={widths:[1440,768,390,320],profileDialog:true,logout:true,themeToast:true,errors};writeFileSync('tmp/workspace-verification/report.json',JSON.stringify(report,null,2));console.log(report);
} finally {
 await browser?.close();await client.auth.signOut();const verified=check(await admin.auth.admin.getUserById(user.id)).user;if(verified.app_metadata.verification!==marker)throw Error('Cleanup guard');check(await admin.auth.admin.deleteUser(user.id));console.log('Temporary workspace test account removed.');
}
