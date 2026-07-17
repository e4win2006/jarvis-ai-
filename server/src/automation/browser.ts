import { chromium } from 'playwright';

export async function runBrowserAutomation(
  url: string,
  action: 'extract' | 'screenshot' | 'click' | 'fill' = 'extract',
  selector: string = 'body',
  textToFill: string = ''
): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Add custom User-Agent to avoid detection on simple scrapers
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (action === 'extract') {
      // Default to returning body content
      if (selector === 'body') {
        const text = await page.innerText('body');
        return text.replace(/\s+/g, ' ').trim().slice(0, 4000);
      } else {
        const elements = await page.$$(selector);
        const contents = [];
        for (const el of elements.slice(0, 10)) {
          const innerText = await el.innerText();
          if (innerText.trim()) {
            contents.push(innerText.trim());
          }
        }
        return contents.join('\n\n') || `No contents found matching selector: ${selector}`;
      }
    } else if (action === 'fill') {
      await page.waitForSelector(selector, { timeout: 10000 });
      await page.fill(selector, textToFill);
      await page.press(selector, 'Enter');
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      const text = await page.innerText('body');
      return text.replace(/\s+/g, ' ').trim().slice(0, 4000);
    } else if (action === 'click') {
      await page.waitForSelector(selector, { timeout: 10000 });
      await page.click(selector);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      const text = await page.innerText('body');
      return text.replace(/\s+/g, ' ').trim().slice(0, 4000);
    } else if (action === 'screenshot') {
      const buffer = await page.screenshot({ fullPage: false });
      return `data:image/png;base64,${buffer.toString('base64')}`;
    }

    return 'Browser action completed.';
  } catch (e: any) {
    return `Browser automation failed: ${e.message}`;
  } finally {
    await browser.close();
  }
}
