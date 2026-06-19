import { chromium } from "playwright";

const TOKEN = process.env.GPH_SEED_TOKEN ?? "demo-token";
const URL = process.env.GPH_WEB_URL ?? "http://localhost:5273";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });

await page.goto(URL, { waitUntil: "networkidle" });

// Token gate -> enter token.
await page.fill('input[placeholder="API 토큰"]', TOKEN);
await page.getByRole("button", { name: "접속" }).click();

// Wait for leaderboard rows.
await page.waitForSelector("text=Ghost Project Hunter");
await page.waitForTimeout(1200);
await page.screenshot({ path: "shot-active.png", fullPage: true });

// Switch to Most Haunted tab.
await page.getByRole("button", { name: /Most Haunted/ }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: "shot-ghost.png", fullPage: true });

// Open a project detail.
await page.locator("button", { hasText: "buried-saas" }).first().click();
await page.waitForTimeout(1000);
await page.screenshot({ path: "shot-detail.png", fullPage: true });

await browser.close();
console.log("screenshots written");
