import type { Browser } from 'rebrowser-puppeteer';
import puppeteer from 'rebrowser-puppeteer';
import { logger } from './logger.js';

class BrowserPool {
  private pool: Browser[] = [];
  private inUse = new Set<Browser>();
  private initializationPromise: Promise<void> | null = null;

  private get maxSize(): number {
    return Number(process.env['BROWSER_POOL_MAX']) || 5;
  }

  private get minSize(): number {
    return Number(process.env['BROWSER_POOL_MIN']) || 1;
  }

  private get idleTimeout(): number {
    return Number(process.env['BROWSER_POOL_IDLE_TIMEOUT']) || 30000;
  }

  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  public async initialize(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        const initializations = Array(this.minSize)
          .fill(null)
          .map(() => this.createBrowser());

        await Promise.all(initializations);
        logger.info(`Browser pool initialized with ${this.minSize} instances`);
      } catch (error) {
        logger.error('Failed to initialize browser pool:', error instanceof Error ? error : { message: String(error) });
        throw error;
      }
    })();

    return this.initializationPromise;
  }

  private async createBrowser(): Promise<Browser> {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials'
      ],
      ignoreDefaultArgs: [
        '--enable-automation',
        '--enable-blink-features=IdleDetection'
      ],
      defaultViewport: {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        hasTouch: false,
        isLandscape: true,
        isMobile: false
      }
    });

    // Create an incognito context for better isolation
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // Set a random user agent
    await page.setUserAgent(this.getRandomUserAgent());

    // Enhanced stealth scripts
    await page.evaluateOnNewDocument(`
      // Override navigator properties
      Object.defineProperties(navigator, {
        webdriver: { get: () => undefined },
        languages: { get: () => ['en-US', 'en'] },
        permissions: { value: { query: async () => ({ state: 'prompt' }) } },
        hardwareConcurrency: { get: () => 8 },
        deviceMemory: { get: () => 8 }
      });

      // Override WebGL
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Open Source Technology Center';
        if (parameter === 37446) return 'Mesa DRI Intel(R) HD Graphics (Skylake GT2)';
        return getParameter.apply(this, [parameter]);
      };
    `);

    await page.close();
    await context.close();

    this.pool.push(browser);
    return browser;
  }

  public async acquire(): Promise<Browser> {
    const browser = this.pool.find(b => !this.inUse.has(b));

    if (browser) {
      this.inUse.add(browser);
      return browser;
    }

    if (this.pool.length < this.maxSize) {
      const newBrowser = await this.createBrowser();
      this.inUse.add(newBrowser);
      return newBrowser;
    }

    return new Promise<Browser>((resolve) => {
      const checkInterval = setInterval(() => {
        const availableBrowser = this.pool.find(b => !this.inUse.has(b));
        if (availableBrowser) {
          clearInterval(checkInterval);
          this.inUse.add(availableBrowser);
          resolve(availableBrowser);
        }
      }, 100);
    });
  }

  public release(browser: Browser): void {
    this.inUse.delete(browser);

    if (this.pool.length > this.minSize && !this.inUse.has(browser)) {
      setTimeout(() => {
        void this.closeBrowserIfIdle(browser);
      }, this.idleTimeout);
    }
  }

  private async closeBrowserIfIdle(browser: Browser): Promise<void> {
    if (!this.inUse.has(browser)) {
      try {
        await browser.close();
        this.pool = this.pool.filter(b => b !== browser);
        logger.debug('Closed idle browser instance');
      } catch (error) {
        logger.error('Error closing browser:', error instanceof Error ? error : { message: String(error) });
      }
    }
  }

  public async closeAll(): Promise<void> {
    await Promise.all(
      this.pool.map(async (browser) => {
        try {
          await browser.close();
        } catch (error) {
          logger.error('Error closing browser:', error instanceof Error ? error : { message: String(error) });
        }
      })
    );

    this.pool = [];
    this.inUse.clear();
    logger.info('All browser instances closed');
  }
}

export const browserPool = new BrowserPool();