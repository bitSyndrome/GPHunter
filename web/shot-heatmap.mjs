import { chromium } from "playwright";

const TOKEN = process.env.GPH_SEED_TOKEN ?? "demo-token";
const URL = process.env.GPH_WEB_URL ?? "http://localhost:5273";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.fill('input[placeholder="API 토큰"]', TOKEN);
await page.getByRole("button", { name: "접속" }).click();
await page.waitForSelector("text=최근 30일 기여도");
await page.waitForTimeout(1000);
await page.screenshot({ path: "shot-heatmap.png", fullPage: true });
await browser.close();
console.log("heatmap screenshot written");
