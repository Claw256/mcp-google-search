import type { Browser } from 'rebrowser-puppeteer';
import puppeteer from 'rebrowser-puppeteer';
import { logger } from './logger.js';
import { getStealthScript } from '../utils/stealth-scripts';
import { getBrowserLaunchOptions, getUserAgents } from '../utils/browser-config';

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
    const userAgents = getUserAgents();
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
    const browser = await puppeteer.launch(getBrowserLaunchOptions());

    // Create an incognito context for better isolation
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // Set a random user agent
    await page.setUserAgent(this.getRandomUserAgent());

    // Apply stealth scripts
    await page.evaluateOnNewDocument(getStealthScript());

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