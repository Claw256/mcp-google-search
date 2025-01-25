import TurndownService from 'turndown';
import { ExtractionError } from '../types';
import { logger } from '../infrastructure/logger';
import cheerio from 'cheerio';
import { browserPool } from '../infrastructure/connection-pool';
import { extractionCache } from '../infrastructure/cache-manager';
import { extractionRateLimiter } from '../infrastructure/rate-limiter';
import { screenshotService } from './screenshot';
class ExtractionService {
    turndown;
    constructor() {
        this.turndown = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
        });
        this.configureTurndown();
    }
    configureTurndown() {
        this.turndown.addRule('codeBlocks', {
            filter: ['pre', 'code'],
            replacement: (_content, node) => {
                const element = node;
                const language = element.className?.replace('language-', '') || '';
                return `\n\`\`\`${language}\n${_content}\n\`\`\`\n`;
            },
        });
        this.turndown.addRule('images', {
            filter: ['img'],
            replacement: (_content, node) => {
                const element = node;
                const alt = element.alt || '';
                const src = element.src || '';
                return src ? `![${alt}](${src})` : '';
            },
        });
    }
    async extractImages(page) {
        const images = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('img')).map(img => ({
                url: img.src || '',
                alt: img.alt || '',
                width: img.naturalWidth,
                height: img.naturalHeight,
                format: img.src.split('.').pop()?.split('?')[0].toLowerCase() || undefined,
            }));
        });
        return images
            .filter((img) => !!img.url)
            .map(img => ({
            url: img.url,
            alt: img.alt || undefined,
            width: img.width || undefined,
            height: img.height || undefined,
            format: img.format,
        }));
    }
    async extractVideos(page) {
        const videos = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]')).map(element => {
                if (element instanceof HTMLVideoElement) {
                    return {
                        url: element.src || '',
                        title: element.title || '',
                        duration: element.duration || undefined,
                        thumbnail: '',
                    };
                }
                else if (element instanceof HTMLIFrameElement) {
                    return {
                        url: element.src || '',
                        title: element.title || '',
                        thumbnail: '',
                    };
                }
                return null;
            });
        });
        return videos
            .filter((video) => video !== null && typeof video === 'object' && 'url' in video && !!video.url)
            .map(video => ({
            url: video.url,
            title: video.title || undefined,
            duration: video.duration,
            thumbnail: video.thumbnail || undefined,
        }));
    }
    async extractMetadata(page) {
        const title = await page.title();
        const metadata = await page.evaluate(() => {
            const getMetaContent = (name) => {
                const element = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
                return element?.getAttribute('content') || undefined;
            };
            return {
                description: getMetaContent('description') || getMetaContent('og:description'),
                author: getMetaContent('author'),
                publishDate: getMetaContent('article:published_time'),
                modifiedDate: getMetaContent('article:modified_time'),
                keywords: getMetaContent('keywords')?.split(',').map(k => k.trim()),
            };
        });
        return {
            title,
            ...metadata,
        };
    }
    cleanContent(html) {
        const $ = cheerio.load(html);
        // Remove unwanted elements
        $('script, style, iframe, nav, footer, header, aside, .ads, #comments').remove();
        // Clean attributes from remaining elements
        $('*').each((_, element) => {
            const $element = $(element);
            const attributes = $element.attr() || {};
            Object.keys(attributes).forEach(attr => {
                if (!['src', 'href', 'alt', 'title'].includes(attr)) {
                    $element.removeAttr(attr);
                }
            });
        });
        return $.html();
    }
    async extract(params) {
        const cacheKey = JSON.stringify(params);
        const cachedResult = extractionCache.get(cacheKey);
        if (cachedResult) {
            logger.debug('Returning cached extraction result', { url: params.url });
            return cachedResult;
        }
        // Check rate limit
        const canProceed = extractionRateLimiter.acquire(params.url);
        if (!canProceed) {
            throw new ExtractionError('Rate limit exceeded');
        }
        let browser = null;
        try {
            browser = await browserPool.acquire();
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 800 });
            await page.goto(params.url, {
                waitUntil: 'networkidle0',
                timeout: 30000,
            });
            // Extract content
            let html = await page.content();
            html = this.cleanContent(html);
            const markdown = this.turndown.turndown(html);
            // Extract additional content based on params
            const [images, videos, metadata] = await Promise.all([
                params.includeImages ? this.extractImages(page) : Promise.resolve([]),
                params.includeVideos ? this.extractVideos(page) : Promise.resolve([]),
                this.extractMetadata(page),
            ]);
            // Take screenshot if requested
            let screenshot = undefined;
            if (params.screenshot) {
                screenshot = await screenshotService.capture(params.url, {
                    fullPage: params.screenshot.fullPage,
                    selector: params.screenshot.selector,
                    format: params.screenshot.format || 'jpeg',
                    quality: params.screenshot.quality || 80,
                });
            }
            await page.close();
            const result = {
                markdown,
                images,
                videos,
                metadata,
                screenshot,
            };
            extractionCache.set(cacheKey, result);
            logger.debug('Cached new extraction result', { url: params.url });
            return result;
        }
        catch (error) {
            logger.error('Extraction error:', error instanceof Error ? error : { message: String(error) });
            throw new ExtractionError(error instanceof Error ? error.message : 'Unknown extraction error');
        }
        finally {
            if (browser !== null) {
                browserPool.release(browser);
            }
        }
    }
}
export const extractionService = new ExtractionService();
