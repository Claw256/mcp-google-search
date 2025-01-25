import sharp from 'sharp';
import { browserPool } from '../infrastructure/connection-pool';
import { logger } from '../infrastructure/logger';
class ScreenshotService {
    async setupPage(page, options) {
        await page.setViewport({
            width: options.width || 1280,
            height: options.height || 800,
            deviceScaleFactor: 1,
        });
    }
    async processScreenshot(buffer, options) {
        let image = sharp(buffer);
        // Convert to specified format
        switch (options.format) {
            case 'jpeg':
                image = image.jpeg({ quality: options.quality || 80 });
                break;
            case 'webp':
                image = image.webp({ quality: options.quality || 80 });
                break;
            case 'png':
            default:
                image = image.png({ quality: options.quality || 80 });
        }
        // Resize if dimensions specified
        if (options.width || options.height) {
            image = image.resize(options.width, options.height, {
                fit: 'inside',
                withoutEnlargement: true,
            });
        }
        return image.toBuffer();
    }
    async capture(url, options = {}) {
        let browser = null;
        try {
            browser = await browserPool.acquire();
            const page = await browser.newPage();
            await this.setupPage(page, options);
            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: 30000,
            });
            // Wait for selector if specified
            if (options.selector) {
                await page.waitForSelector(options.selector, { timeout: 5000 });
            }
            // Take screenshot
            const screenshotBuffer = await page.screenshot({
                fullPage: options.fullPage,
                type: options.format || 'png',
                clip: options.selector
                    ? await page.$eval(options.selector, (element) => {
                        const { x, y, width, height } = element.getBoundingClientRect();
                        return { x, y, width, height };
                    })
                    : undefined,
            });
            // Process the screenshot
            const processedBuffer = await this.processScreenshot(Buffer.from(screenshotBuffer), options);
            // Get metadata
            const metadata = await sharp(processedBuffer).metadata();
            await page.close();
            return {
                buffer: processedBuffer,
                metadata: {
                    width: metadata.width || 0,
                    height: metadata.height || 0,
                    format: metadata.format || 'unknown',
                    size: processedBuffer.length,
                },
            };
        }
        catch (error) {
            logger.error('Screenshot error:', error instanceof Error ? error : { message: String(error) });
            throw new Error(`Failed to capture screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        finally {
            if (browser !== null) {
                browserPool.release(browser);
            }
        }
    }
    async captureMultiple(urls, options = {}) {
        const results = new Map();
        const errors = new Map();
        // Process URLs in parallel with concurrency limit
        const concurrency = 3;
        for (let i = 0; i < urls.length; i += concurrency) {
            const batch = urls.slice(i, i + concurrency);
            const promises = batch.map(async (url) => {
                try {
                    const result = await this.capture(url, options);
                    results.set(url, result);
                }
                catch (error) {
                    errors.set(url, error instanceof Error ? error.message : 'Unknown error');
                }
            });
            await Promise.all(promises);
        }
        // Log errors if any
        if (errors.size > 0) {
            logger.warn('Some screenshots failed:', Object.fromEntries(errors));
        }
        return results;
    }
}
export const screenshotService = new ScreenshotService();
