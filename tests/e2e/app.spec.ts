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
