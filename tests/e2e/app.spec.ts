import { expect, test } from "@playwright/test";

test("visitor can open the demo library and reader", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /papers were made/i })).toBeVisible();
  await page.getByRole("link", { name: /see a sample/i }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Attention Is All You Need" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
});

test("the owner library requires valid Supabase credentials", async ({ page }) => {
  await page.goto("/library");
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2Flibrary$/);
  await page.getByLabel("Email address").fill("researcher@example.com");
  await page.getByRole("textbox", { name: "Password Show password" }).fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2Flibrary$/);
});

test("paperflow reader supports contents, larger text, and a persistent theme", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "paperflow home" })).toBeVisible();
  await expect(page).toHaveTitle(/paperflow/);
  await page.goto("/sample");
  await page.getByLabel("Reading settings").click();
  await page.getByRole("button", { name: "Large", exact: true }).click();
  await expect(page.locator(".reader-page")).toHaveAttribute("data-text-size", "large");
  await page.getByLabel("Reading settings").click();
  if (isMobile) await page.locator(".mobile-outline summary").click();
  const outline = page.getByRole("navigation", { name: isMobile ? "Mobile document contents" : "Document contents", exact: true });
  const target = outline.locator("a").nth(1);
  const href = await target.getAttribute("href");
  await target.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  if (isMobile) await expect(page.locator(".mobile-outline")).not.toHaveAttribute("open");
  const previous = await page.locator("html").getAttribute("data-theme");
  await page.getByLabel("Toggle light and dark theme").click();
  const expected = previous === "dark" ? "light" : "dark";
  await expect(page.locator("html")).toHaveAttribute("data-theme", expected);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", expected);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
