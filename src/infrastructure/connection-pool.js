import puppeteer from 'rebrowser-puppeteer';
import { logger } from './logger.js';
class BrowserPool {
    pool = [];
    inUse = new Set();
    initializationPromise = null;
    get maxSize() {
        return Number(process.env['BROWSER_POOL_MAX']) || 5;
    }
    get minSize() {
        return Number(process.env['BROWSER_POOL_MIN']) || 1;
    }
    get idleTimeout() {
        return Number(process.env['BROWSER_POOL_IDLE_TIMEOUT']) || 30000;
    }
    async initialize() {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }
        this.initializationPromise = (async () => {
            try {
                // Initialize minimum number of browsers
                const initializations = Array(this.minSize)
                    .fill(null)
                    .map(() => this.createBrowser());
                await Promise.all(initializations);
                logger.info(`Browser pool initialized with ${this.minSize} instances`);
            }
            catch (error) {
                logger.error('Failed to initialize browser pool:', error instanceof Error ? error : { message: String(error) });
                throw error;
            }
        })();
        return this.initializationPromise;
    }
    async createBrowser() {
        // Configure environment variables for rebrowser-patches
        process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] = 'addBinding';
        process.env['REBROWSER_PATCHES_SOURCE_URL'] = 'jquery.min.js';
        process.env['REBROWSER_PATCHES_UTILITY_WORLD_NAME'] = 'util';
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--hide-scrollbars',
                '--disable-notifications',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-breakpad',
                '--disable-component-extensions-with-background-pages',
                '--disable-extensions',
                '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                '--disable-ipc-flooding-protection',
                '--disable-renderer-backgrounding',
                '--enable-features=NetworkService,NetworkServiceInProcess',
                '--force-color-profile=srgb',
                '--metrics-recording-only',
                '--mute-audio',
            ],
            ignoreDefaultArgs: ['--enable-automation'],
            defaultViewport: {
                width: 1280,
                height: 800,
                deviceScaleFactor: 1,
                hasTouch: false,
                isLandscape: true,
                isMobile: false,
            },
        });
        this.pool.push(browser);
        return browser;
    }
    async acquire() {
        // Try to get an available browser from the pool
        const browser = this.pool.find(b => !this.inUse.has(b));
        if (browser) {
            this.inUse.add(browser);
            return browser;
        }
        // Create new browser if pool isn't at max capacity
        if (this.pool.length < this.maxSize) {
            const newBrowser = await this.createBrowser();
            this.inUse.add(newBrowser);
            return newBrowser;
        }
        // Wait for a browser to become available
        return new Promise((resolve) => {
            const checkInterval = setInterval(async () => {
                const availableBrowser = this.pool.find(b => !this.inUse.has(b));
                if (availableBrowser) {
                    clearInterval(checkInterval);
                    this.inUse.add(availableBrowser);
                    resolve(availableBrowser);
                }
            }, 100);
        });
    }
    async release(browser) {
        this.inUse.delete(browser);
        // If we have more browsers than minimum and this one is idle
        if (this.pool.length > this.minSize && !this.inUse.has(browser)) {
            setTimeout(async () => {
                // Double check it's still not in use
                if (!this.inUse.has(browser)) {
                    try {
                        await browser.close();
                        this.pool = this.pool.filter(b => b !== browser);
                        logger.debug('Closed idle browser instance');
                    }
                    catch (error) {
                        logger.error('Error closing browser:', error instanceof Error ? error : { message: String(error) });
                    }
                }
            }, this.idleTimeout);
        }
    }
    async closeAll() {
        await Promise.all(this.pool.map(async (browser) => {
            try {
                await browser.close();
            }
            catch (error) {
                logger.error('Error closing browser:', error instanceof Error ? error : { message: String(error) });
            }
        }));
        this.pool = [];
        this.inUse.clear();
        logger.info('All browser instances closed');
    }
}
export const browserPool = new BrowserPool();
