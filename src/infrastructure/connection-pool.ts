import type { Browser, BrowserContext } from 'rebrowser-puppeteer';
import puppeteer from 'rebrowser-puppeteer';
import { logger } from './logger.js';
import { getStealthScript } from '../utils/stealth-scripts';
import { getBrowserLaunchOptions, getUserAgents } from '../utils/browser-config';

interface BrowserInstance {
  browser: Browser;
  context: BrowserContext;
}

class BrowserPool {
  private pool: BrowserInstance[] = [];
  private inUse = new Set<BrowserInstance>();
  private initializationPromise: Promise<void> | null = null;
  private persistentContext: BrowserContext | null = null;

  private get maxSize(): number {
    return Number(process.env['BROWSER_POOL_MAX']) || 5;
  }

  private get minSize(): number {
    return Number(process.env['BROWSER_POOL_MIN']) || 1;
  }

  private get idleTimeout(): number {
    return Number(process.env['BROWSER_POOL_IDLE_TIMEOUT']) || 30000;
  }

  private get cookiePersistenceEnabled(): boolean {
    return process.env['ENABLE_COOKIE_PERSISTENCE'] === 'true';
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

  private async createBrowser(): Promise<BrowserInstance> {
    const browser = await puppeteer.launch(getBrowserLaunchOptions());
    let context: BrowserContext;

    if (this.cookiePersistenceEnabled) {
      // Create or reuse persistent context
      if (!this.persistentContext) {
        this.persistentContext = await browser.createBrowserContext();
        logger.info('Created persistent browser context for cookie storage');
      }
      context = this.persistentContext;
    } else {
      // Create incognito context for isolation
      context = await browser.createBrowserContext();
    }

    // Set up initial page with stealth measures
    const page = await context.newPage();
    await page.setUserAgent(this.getRandomUserAgent());
    await page.evaluateOnNewDocument(getStealthScript());
    await page.close();

    // Only close non-persistent contexts
    if (!this.cookiePersistenceEnabled) {
      await context.close();
      context = await browser.createBrowserContext();
    }

    const instance: BrowserInstance = { browser, context };
    this.pool.push(instance);
    return instance;
  }

  public async acquire(): Promise<Browser> {
    const instance = this.pool.find(i => !this.inUse.has(i));

    if (instance) {
      this.inUse.add(instance);
      return instance.browser;
    }

    if (this.pool.length < this.maxSize) {
      const newInstance = await this.createBrowser();
      this.inUse.add(newInstance);
      return newInstance.browser;
    }

    return new Promise<Browser>((resolve) => {
      const checkInterval = setInterval(() => {
        const availableInstance = this.pool.find(i => !this.inUse.has(i));
        if (availableInstance) {
          clearInterval(checkInterval);
          this.inUse.add(availableInstance);
          resolve(availableInstance.browser);
        }
      }, 100);
    });
  }

  public release(browser: Browser): void {
    const instance = this.pool.find(i => i.browser === browser);
    if (!instance) {
      return;
    }

    this.inUse.delete(instance);

    if (this.pool.length > this.minSize && !this.inUse.has(instance)) {
      setTimeout(() => {
        void this.closeBrowserIfIdle(instance);
      }, this.idleTimeout);
    }
  }

  private async closeBrowserIfIdle(instance: BrowserInstance): Promise<void> {
    if (!this.inUse.has(instance)) {
      try {
        // Don't close the persistent context if cookie persistence is enabled
        if (!this.cookiePersistenceEnabled) {
          await instance.context.close();
        }
        await instance.browser.close();
        this.pool = this.pool.filter(i => i !== instance);
        logger.debug('Closed idle browser instance');
      } catch (error) {
        logger.error('Error closing browser:', error instanceof Error ? error : { message: String(error) });
      }
    }
  }

  public async closeAll(): Promise<void> {
    await Promise.all(
      this.pool.map(async (instance) => {
        try {
          // Close persistent context only when shutting down completely
          if (this.cookiePersistenceEnabled && this.persistentContext) {
            await this.persistentContext.close();
            this.persistentContext = null;
          }
          await instance.context.close();
          await instance.browser.close();
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