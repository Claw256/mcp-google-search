/* eslint-disable @typescript-eslint/ban-ts-comment */
import type { Browser, Page } from 'rebrowser-puppeteer';
import TurndownService from 'turndown';
import type { ExtractionParams, ExtractionResult, ImageMetadata, VideoMetadata, PageMetadata } from '../types';
import { ExtractionError, RateLimitError } from '../types';
import { logger } from '../infrastructure/logger';
import { load } from 'cheerio';
import { browserPool } from '../infrastructure/connection-pool';
import { extractionCache } from '../infrastructure/cache-manager';
import { extractionRateLimiter } from '../infrastructure/rate-limiter';
import { screenshotService } from './screenshot';

class ExtractionService {
  private readonly turndown: TurndownService;
  private _currentUrl?: string;
  private readonly MIN_IMAGE_DIMENSION = 200;
  private readonly MAX_IMAGES = 5;
  private readonly EXCLUDED_IMAGE_PATTERNS = [
    /logo/i,
    /avatar/i,
    /icon/i,
    /banner/i,
    /background/i,
  ];

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      linkStyle: 'referenced',
      fence: '```'
    });
    this.configureTurndown();
  }

  private configureTurndown(): void {
    this.turndown.addRule('codeBlocks', {
      filter: ['pre', 'code'],
      replacement: (_content: string, node: unknown) => {
        const element = node as HTMLElement;
        const language = element.className?.replace('language-', '') || '';
        return `\n\`\`\`${language}\n${_content}\n\`\`\`\n`;
      },
    });

    this.turndown.addRule('images', {
      filter: ['img'],
      replacement: (_content: string, node: unknown) => {
        const element = node as HTMLImageElement;
        const alt = element.alt || '';
        const src = element.src || '';
        return src ? `![${alt}](${src})` : '';
      },
    });
  }



  private async setupPage(page: Page): Promise<void> {
    await page.setJavaScriptEnabled(true);
    await page.setDefaultTimeout(60000);
    await page.setDefaultNavigationTimeout(60000);

    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false
    });

    // Apply stealth scripts
    await page.evaluateOnNewDocument(`
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [] });
      Object.defineProperty(navigator, 'permissions', { value: { query: () => Promise.resolve({ state: 'prompt' }) } });
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      
      window.chrome = {
        runtime: {},
        loadTimes: function(){},
        csi: function(){},
        app: {}
      };
      
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    `);
  }

  private async extractVideos(page: Page): Promise<VideoMetadata[]> {

    const videos = await page.evaluate(() => {
      const getAbsoluteUrl = (src: string) => new URL(src, window.location.href).href;
      
      return Array.from(document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]'))
        .map(element => {
          if (element instanceof HTMLVideoElement && element.src) {
            return {
              url: getAbsoluteUrl(element.src),
              title: element.title || undefined,
              duration: element.duration || undefined,
              thumbnail: undefined
            };
          }
          
          if (element instanceof HTMLIFrameElement && element.src) {
            return {
              url: getAbsoluteUrl(element.src),
              title: element.title || undefined,
              thumbnail: undefined
            };
          }
          
          return null;
        })
        .filter((video) => video !== null);
    });

    return videos as VideoMetadata[];
  }

  private async extractMetadata(page: Page): Promise<PageMetadata> {
    return page.evaluate(() => {
      const getMetaContent = (name: string): string | undefined => {
        const element = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
        const content = element?.getAttribute('content');
        return content || undefined;
      };

      return {
        title: document.title,
        description: getMetaContent('description') || getMetaContent('og:description'),
        author: getMetaContent('author'),
        publishDate: getMetaContent('article:published_time'),
        modifiedDate: getMetaContent('article:modified_time'),
        keywords: getMetaContent('keywords')?.split(',').map(k => k.trim()),
      };
    });
  }

  private cleanContent(html: string): string {
    const $ = load(html);
    $('script, style, iframe, nav, footer, header, aside, .ads, #comments').remove();
    
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

  public async extract(params: ExtractionParams): Promise<ExtractionResult> {
    this._currentUrl = params.url;
    const cacheKey = JSON.stringify(params);
    const cachedResult = extractionCache.get<ExtractionResult>(cacheKey);

    if (cachedResult) {
      logger.debug('Returning cached extraction result', { url: params.url });
      return cachedResult;
    }

    if (!extractionRateLimiter.acquire(params.url)) {
      throw new RateLimitError();
    }

    let browser: Browser | null = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      let context: Awaited<ReturnType<Browser['createBrowserContext']>> | null = null;
      let page: Page | null = null;
      
      try {
        browser = await browserPool.acquire();
        context = await browser.createBrowserContext();
        page = await context.newPage();

        await this.setupPage(page);

        // Add random delay before navigation
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

        const response = await page.goto(params.url, {
          waitUntil: 'networkidle0',
          timeout: 60000
        });

        if (!response) {
          throw new ExtractionError('Failed to get response from page');
        }

        const status = response.status();
        if (status >= 400) {
          throw new ExtractionError(`HTTP error: ${status}`);
        }

        // Wait for content
        await page.waitForFunction(() => document.body !== null && document.readyState === 'complete');

        const html = await page.content();
        const cleanedHtml = this.cleanContent(html);
        
        // Configure turndown based on params
        if (!params.preserveLinks) {
          this.turndown.addRule('links', { filter: ['a'], replacement: (content) => content });
        }
        
        const markdown = this.turndown.turndown(cleanedHtml).trim();

        const [images, videos, metadata] = await Promise.all([
          params.includeImages ? this.extractImages(page) : Promise.resolve([]),
          params.includeVideos ? this.extractVideos(page) : Promise.resolve([]),
          this.extractMetadata(page),
        ]);

        const screenshot = params.screenshot ? 
          await screenshotService.capture(params.url, {
            fullPage: params.screenshot.fullPage,
            selector: params.screenshot.selector,
            format: params.screenshot.format || 'jpeg',
            quality: params.screenshot.quality || 80,
          }) : undefined;

        const result = { markdown, images, videos, metadata, screenshot };
        extractionCache.set(cacheKey, result);

        return result;
      } catch (error) {
        logger.error('Extraction error:', error instanceof Error ? error : { message: String(error) });
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        const botDetectionPatterns = [
          'ERR_TOO_MANY_REDIRECTS',
          'status code 403',
          'status code 429',
          'captcha',
          'Access Denied',
          'blocked',
          'security check',
          'challenge',
          'suspicious',
          'automated',
          'bot',
          'cloudflare'
        ];

        const isBotDetection = botDetectionPatterns.some(pattern => 
          errorMessage.toLowerCase().includes(pattern.toLowerCase())
        );

        if (isBotDetection && retryCount < maxRetries - 1) {
          retryCount++;
          const backoffDelay = Math.floor(Math.random() * 5000) + (Math.pow(2, retryCount) * 1000);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        }

        if (isBotDetection) {
          throw new ExtractionError('Bot detection triggered - please try again later');
        }
        
        throw new ExtractionError(
          error instanceof Error ? error.message : 'Unknown extraction error'
        );
      } finally {
        try {
          if (page) {
            await page.close().catch(() => {});
          }
          if (context) {
            await context.close().catch(() => {});
          }
          if (browser) {
            browserPool.release(browser);
          }
        } catch (cleanupError) {
          logger.error('Error during cleanup:', cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)));
        }
      }
    }

    throw new ExtractionError('Maximum retry attempts exceeded');
  }

  private async extractImages(page: Page): Promise<ImageMetadata[]> {
    const patterns = this.EXCLUDED_IMAGE_PATTERNS.map(p => p.source);
    
    interface EvaluateParams {
      MIN_DIMENSION: number;
      MAX_IMAGES: number;
      PATTERNS: string[];
    }
    return page.evaluate(({ MIN_DIMENSION, MAX_IMAGES, PATTERNS }: EvaluateParams) => {
      const isRelevantImage = (img: HTMLImageElement): boolean => {
        if (img.naturalWidth < MIN_DIMENSION && img.naturalHeight < MIN_DIMENSION) {
          return false;
        }

        const imgIdentifiers = [
          img.alt?.toLowerCase() || '',
          img.src.toLowerCase(),
          img.className?.toLowerCase() || '',
          img.id?.toLowerCase() || ''
        ].join(' ');
        
        return !PATTERNS.some(pattern => new RegExp(pattern, 'i').test(imgIdentifiers));
      };

      return Array.from(document.querySelectorAll('img'))
        .filter(isRelevantImage)
        .slice(0, MAX_IMAGES)
        .map(img => {
          const absoluteUrl = new URL(img.src, window.location.href).href;
          const format = absoluteUrl.split('.').pop()?.toLowerCase() || undefined;
          
          return {
            url: absoluteUrl,
            alt: img.alt || undefined,
            width: img.naturalWidth || undefined,
            height: img.naturalHeight || undefined,
            format: format || undefined
          };
        });
    }, {
      MIN_DIMENSION: this.MIN_IMAGE_DIMENSION,
      MAX_IMAGES: this.MAX_IMAGES,
      PATTERNS: patterns
    });
  }
}

export const extractionService = new ExtractionService();