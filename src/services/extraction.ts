/* eslint-disable @typescript-eslint/ban-ts-comment */
import type { Browser, Page } from 'rebrowser-puppeteer';
import TurndownService from 'turndown';
import type { ExtractionParams, ExtractionResult, ImageMetadata, VideoMetadata, PageMetadata } from '../types';
import { ExtractionError } from '../types';
import { logger } from '../infrastructure/logger';
import { load } from 'cheerio';
import { browserPool } from '../infrastructure/connection-pool';
import { extractionCache } from '../infrastructure/cache-manager';
import { extractionRateLimiter } from '../infrastructure/rate-limiter';
import { screenshotService } from './screenshot';

// Type definitions for User-Agent Client Hints
interface NavigatorUAData {
  brands: Array<{ brand: string; version: string }>;
  mobile: boolean;
  platform: string;
  getHighEntropyValues(hints: string[]): Promise<UADataValues>;
}

interface UADataValues {
  architecture?: string;
  model?: string;
  platformVersion?: string;
  fullVersionList?: Array<{ brand: string; version: string }>;
}

// Extend Navigator type
declare global {
  interface Navigator {
    userAgentData?: NavigatorUAData;
  }
}

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

  private normalizeUrl(url: string): string {
    try {
      // Parse the URL
      let normalizedUrl = url;
      
      // Ensure URL has a protocol
      if (!normalizedUrl.startsWith('http')) {
        normalizedUrl = `https://${normalizedUrl}`;
      }
      
      const urlObj = new URL(normalizedUrl);
      
      // Remove trailing slash if it's not the root path
      if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith('/')) {
        urlObj.pathname = urlObj.pathname.slice(0, -1);
      }
      return urlObj.toString();
    } catch (error) {
      throw new ExtractionError(`Invalid URL format: ${url}`);
    }
  }

  // Enhanced headers with more realistic values and randomization
  private getRandomizedHeaders(): Record<string, string> {
    // Updated Chrome versions to match latest stable releases
    const chromeVersions = ['132.0.6834.111', '131.0.6789.100', '130.0.6756.92'];
    const selectedVersion = chromeVersions[0]; // Use latest version for better acceptance
    const platforms = ['Windows', 'Macintosh', 'X11'];
    const selectedPlatform = platforms[Math.floor(Math.random() * platforms.length)];
    const languages = ['en-US,en;q=0.9', 'en-GB,en;q=0.8,en-US;q=0.9', 'en-CA,en;q=0.9,fr-CA;q=0.8'];
    const selectedLanguage = languages[Math.floor(Math.random() * languages.length)];

    const baseHeaders = {
      'Accept-Language': selectedLanguage,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-CH-UA': `"Not_A Brand";v="99", "Google Chrome";v="${selectedVersion}", "Chromium";v="${selectedVersion}"`,
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': `"${selectedPlatform}"`,
      'Sec-CH-UA-Arch': `"${Math.random() > 0.5 ? 'x86' : 'arm'}"`,
      'Sec-CH-UA-Full-Version': `"${selectedVersion}"`,
      'Sec-CH-UA-Platform-Version': `"${Math.floor(Math.random() * 5) + 10}.0.0"`,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': `Mozilla/5.0 (${selectedPlatform === 'Windows' ? 'Windows NT 10.0; Win64; x64' : selectedPlatform === 'Macintosh' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${selectedVersion} Safari/537.36`,
      'Cache-Control': 'max-age=0',
      'Connection': 'keep-alive',
      'DNT': '0',
      'Cookie': '',
      'Referer': 'https://www.google.com/',
      'Sec-GPC': '1',
      'TE': 'Trailers',
      'Pragma': 'no-cache',
      'X-Requested-With': 'XMLHttpRequest'
    };

    // Add Reddit-specific headers if URL contains reddit.com
    if (this._currentUrl?.includes('reddit.com')) {
      return {
        ...baseHeaders,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
        'Cookie': '', // Reddit requires cookies for some content
        'Host': 'www.reddit.com',
        'Referer': 'https://www.reddit.com/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'TE': 'trailers',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': `Mozilla/5.0 (${selectedPlatform === 'Windows' ? 'Windows NT 10.0; Win64; x64' : selectedPlatform === 'Macintosh' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${selectedVersion} Safari/537.36`
      };
    }

    return baseHeaders;
  }

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
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

  private async simulateHumanBehavior(page: Page): Promise<void> {
    // Add more random delays for Reddit
    if (this._currentUrl?.includes('reddit.com')) {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 5000 + 3000));
    }

    const viewportHeight = page.viewport()?.height || 800;
    
    // Enhanced random delay with more natural variation
    const randomDelay = async () => {
      const baseDelay = Math.floor(Math.random() * 2000) + 1000;
      const microDelay = Math.random() * 500;
      await new Promise(resolve => setTimeout(resolve, baseDelay + microDelay));
    };

    // Enhanced mouse movements with bezier curves
    const moveMouseRandomly = async () => {
      const generateBezierPoints = (startX: number, startY: number, endX: number, endY: number) => {
        const controlPoint1X = startX + (Math.random() * 200 - 100);
        const controlPoint1Y = startY + (Math.random() * 200 - 100);
        const controlPoint2X = endX + (Math.random() * 200 - 100);
        const controlPoint2Y = endY + (Math.random() * 200 - 100);
        
        return { controlPoint1X, controlPoint1Y, controlPoint2X, controlPoint2Y };
      };

      const points = [];
      const numPoints = Math.floor(Math.random() * 5) + 3;
      
      for (let i = 0; i < numPoints; i++) {
        points.push({
          x: Math.floor(Math.random() * 1200) + 40,
          y: Math.floor(Math.random() * 700) + 40
        });
      }

      for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];
        const { controlPoint1X, controlPoint1Y, controlPoint2X, controlPoint2Y } = 
          generateBezierPoints(start.x, start.y, end.x, end.y);

        // Simulate bezier curve movement
        for (let t = 0; t <= 1; t += 0.05) {
          const x = Math.pow(1 - t, 3) * start.x + 
                    3 * Math.pow(1 - t, 2) * t * controlPoint1X +
                    3 * (1 - t) * Math.pow(t, 2) * controlPoint2X +
                    Math.pow(t, 3) * end.x;
          const y = Math.pow(1 - t, 3) * start.y +
                    3 * Math.pow(1 - t, 2) * t * controlPoint1Y +
                    3 * (1 - t) * Math.pow(t, 2) * controlPoint2Y +
                    Math.pow(t, 3) * end.y;
          
          await page.mouse.move(x, y);
          await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        }
      }
    };

    // Enhanced natural scrolling with variable speed and acceleration
    const scrollNaturally = async () => {
      await page.evaluate((viewportHeight) => {
        return new Promise<void>((resolve) => {
          let totalHeight = 0;
          let scrollSpeed = Math.random() * 100 + 50;
          let acceleration = (Math.random() * 2 - 1) * 0.2;
          
          const scrollInterval = setInterval(() => {
            // Update scroll speed with acceleration
            scrollSpeed = Math.max(20, Math.min(300, scrollSpeed + acceleration));
            const distance = Math.floor(scrollSpeed);
            
            window.scrollBy(0, distance);
            totalHeight += distance;
            
            // Randomly change acceleration
            if (Math.random() < 0.1) {
              acceleration = (Math.random() * 2 - 1) * 0.2;
            }
            
            // Random pauses during scrolling
            if (Math.random() < 0.15) {
              clearInterval(scrollInterval);
              setTimeout(() => {
                const newInterval = setInterval(() => {
                  scrollSpeed = Math.random() * 100 + 50;
                  const newDistance = Math.floor(scrollSpeed);
                  window.scrollBy(0, newDistance);
                  totalHeight += newDistance;
                  
                  if (totalHeight >= document.body.scrollHeight - viewportHeight) {
                    clearInterval(newInterval);
                    resolve();
                  }
                }, Math.floor(Math.random() * 200) + 100);
              }, Math.floor(Math.random() * 2000) + 500);
            }
            
            if (totalHeight >= document.body.scrollHeight - viewportHeight) {
              clearInterval(scrollInterval);
              resolve();
            }
          }, Math.floor(Math.random() * 100) + 50);
        });
      }, viewportHeight);
    };

    // Execute random behaviors with more variation
    await moveMouseRandomly();
    await randomDelay();
    await scrollNaturally();
    await randomDelay();
    await moveMouseRandomly();
    await randomDelay();
    
    // Enhanced random clicks on safe elements with natural timing
    const safeClickTargets = ['span', 'p', 'div', 'h1', 'h2', 'h3', 'article'];
    await page.evaluate((targets) => {
      const elements = document.querySelectorAll(targets.join(','));
      const visibleElements = Array.from(elements).filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 &&
               rect.top >= 0 && rect.left >= 0 &&
               rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
      });
      
      if (visibleElements.length > 0) {
        const randomElement = visibleElements[Math.floor(Math.random() * visibleElements.length)];
        const rect = randomElement.getBoundingClientRect();
        // Click with slight offset from center
        const offsetX = (Math.random() * 10 - 5);
        const offsetY = (Math.random() * 10 - 5);
        const clickX = rect.left + rect.width / 2 + offsetX;
        const clickY = rect.top + rect.height / 2 + offsetY;
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: clickX,
          clientY: clickY
        });
        randomElement.dispatchEvent(clickEvent);
      }
    }, safeClickTargets);
    
    await randomDelay();
    
    // Enhanced scroll back to top with variable speed
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        let currentSpeed = Math.random() * 100 + 50;
        const scrollInterval = setInterval(() => {
          // Gradually decrease speed as we approach top
          currentSpeed = Math.max(20, currentSpeed * 0.95);
          const distance = Math.floor(currentSpeed);
          window.scrollBy(0, -distance);
          
          if (window.scrollY <= 0) {
            clearInterval(scrollInterval);
            resolve();
          }
        }, Math.floor(Math.random() * 100) + 30);
      });
    });
  }

  private async extractImages(page: Page): Promise<ImageMetadata[]> {
    const patterns = this.EXCLUDED_IMAGE_PATTERNS.map(p => p.source);
    
    return page.evaluate(({ MIN_DIMENSION, MAX_IMAGES, PATTERNS }) => {
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
          const format = new URL(absoluteUrl).pathname.split('.').pop()?.toLowerCase();
          
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

  private async extractVideos(page: Page): Promise<VideoMetadata[]> {
    interface ExtractedVideo {
      url: string;
      title?: string;
      duration?: number;
      thumbnail?: string;
    }

    return page.evaluate(() => {
      const getAbsoluteUrl = (src: string) => new URL(src, window.location.href).href;
      
      return Array.from(document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]'))
        .map(element => {
          if (element instanceof HTMLVideoElement && element.src) {
            return {
              url: getAbsoluteUrl(element.src),
              title: element.title || undefined,
              duration: element.duration || undefined,
              thumbnail: undefined
            } as ExtractedVideo;
          }
          
          if (element instanceof HTMLIFrameElement && element.src) {
            return {
              url: getAbsoluteUrl(element.src),
              title: element.title || undefined,
              thumbnail: undefined
            } as ExtractedVideo;
          }
          
          return null;
        })
        .filter((video): video is ExtractedVideo => 
          video !== null && typeof video === 'object' && 'url' in video
        );
    });
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
      throw new ExtractionError('Rate limit exceeded');
    }

    let browser: Browser | null = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        browser = await browserPool.acquire();
        const page = await browser.newPage();

        // Configure page for better undetectability
        await page.setViewport({
          width: 1920 + Math.floor(Math.random() * 100),
          height: 1080 + Math.floor(Math.random() * 100),
          deviceScaleFactor: 1,
          hasTouch: false,
          isLandscape: true,
          isMobile: false
        });
        
        // Normalize URL and set headers
        const normalizedUrl = this.normalizeUrl(params.url);
        await page.setExtraHTTPHeaders(this.getRandomizedHeaders());

        // Enhanced browser fingerprint evasion
        await page.evaluateOnNewDocument(() => {
          // Override Object.getOwnPropertyNames for navigator
          const originalGetOwnPropertyNames = Object.getOwnPropertyNames;
          Object.getOwnPropertyNames = function(obj) {
            if (obj === navigator || obj === Object.getPrototypeOf(navigator)) {
              return [];
            }
            return originalGetOwnPropertyNames(obj);
          };

          // Override navigator.webdriver to return false
          Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', {
            get: () => false,
            configurable: true,
            enumerable: true
          });

          // Mock plugins with more realistic values
          Object.defineProperty(navigator, 'plugins', {
            get: () => {
              // Create a proper PluginArray
              const plugins = Object.create(PluginArray.prototype) as PluginArray & {
                [key: number]: Plugin;
                namedItem(name: string): Plugin | null;
                item(index: number): Plugin;
                refresh(): void;
              };

              // Define plugins
              const pluginData = [
                {
                  name: 'Chrome PDF Plugin',
                  filename: 'internal-pdf-viewer',
                  description: 'Portable Document Format',
                  mimeTypes: [{
                    type: 'application/x-google-chrome-pdf',
                    suffixes: 'pdf',
                    description: 'Portable Document Format'
                  }]
                },
                {
                  name: 'Chrome PDF Viewer',
                  filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
                  description: 'Portable Document Format',
                  mimeTypes: [{
                    type: 'application/pdf',
                    suffixes: 'pdf',
                    description: 'Portable Document Format'
                  }]
                },
                {
                  name: 'Native Client',
                  filename: 'internal-nacl-plugin',
                  description: 'Native Client',
                  mimeTypes: [
                    {
                      type: 'application/x-nacl',
                      suffixes: '',
                      description: 'Native Client Executable'
                    },
                    {
                      type: 'application/x-pnacl',
                      suffixes: '',
                      description: 'Portable Native Client Executable'
                    }
                  ]
                }
              ];

              // Add plugins to the PluginArray
              pluginData.forEach((data, index) => {
                const plugin = {
                  name: data.name,
                  filename: data.filename,
                  description: data.description,
                  length: data.mimeTypes.length
                } as Plugin;

                // Add mime types to plugin
                data.mimeTypes.forEach((mime, mimeIndex) => {
                  const mimeType = {
                    type: mime.type,
                    suffixes: mime.suffixes,
                    description: mime.description,
                    enabledPlugin: plugin
                  };
                  Object.defineProperty(plugin, mimeIndex, {
                    value: mimeType,
                    writable: false,
                    enumerable: true,
                    configurable: true
                  });
                });

                Object.defineProperty(plugins, index, {
                  value: plugin,
                  writable: false,
                  enumerable: true,
                  configurable: true
                });
              });

              // Set length
              Object.defineProperty(plugins, 'length', {
                value: pluginData.length,
                writable: false,
                enumerable: true,
                configurable: true
              });

              // Add required methods
              plugins.item = function(index: number) {
                return this[index] || null;
              };

              plugins.namedItem = function(name: string) {
                for (let i = 0; i < this.length; i++) {
                  if (this[i].name === name) {
                    return this[i];
                  }
                }
                return null;
              };

              plugins.refresh = function() {};

              return plugins;
            },
            enumerable: true,
            configurable: true
          });

          // Mock userAgentData with latest Chrome version
          const selectedVersion = '132';
          Object.defineProperty(navigator, 'userAgentData', {
            get: () => ({
              brands: [
                { brand: 'Google Chrome', version: selectedVersion },
                { brand: 'Not=A?Brand', version: '99' },
                { brand: 'Chromium', version: selectedVersion }
              ],
              mobile: false,
              platform: 'Windows',
              getHighEntropyValues: async (hints: string[]) => ({
                architecture: Math.random() > 0.5 ? 'x86' : 'arm',
                model: '',
                platformVersion: `${Math.floor(Math.random() * 5) + 10}.0.0`,
                fullVersionList: [
                  { brand: 'Google Chrome', version: `${selectedVersion}.0.6834.111` },
                  { brand: 'Not=A?Brand', version: '99.0.0.0' },
                  { brand: 'Chromium', version: `${selectedVersion}.0.6834.111` }
                ],
                ...(hints.includes('uaFullVersion') ? { uaFullVersion: `${selectedVersion}.0.6834.111` } : {}),
                ...(hints.includes('bitness') ? { bitness: '64' } : {}),
                ...(hints.includes('wow64') ? { wow64: false } : {})
              })
            }),
            enumerable: true,
            configurable: true
          });

          // Override permissions API
          const originalQuery = window.navigator.permissions.query;
          // @ts-ignore
          window.navigator.permissions.query = (parameters: PermissionDescriptor) => {
            if (parameters.name === 'notifications') {
              return Promise.resolve({ state: Notification.permission as PermissionState });
            }
            return originalQuery(parameters);
          };

          // Add WebGL support with enhanced spoofing
          const getParameter = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
            // Spoof renderer info
            if (parameter === 37445) {
              return 'Intel Open Source Technology Center';
            }
            if (parameter === 37446) {
              return 'Mesa DRI Intel(R) HD Graphics (Skylake GT2)';
            }
            return getParameter.apply(this, [parameter]);
          };
        });

        // Add random delay before navigation with jitter
        const navigationDelay = Math.floor(Math.random() * 5000) + 3000;
        await new Promise(resolve => setTimeout(resolve, navigationDelay));

        // Navigate with adaptive timeout
        const timeout = 60000; // 60 second timeout for all sites
        await page.goto(normalizedUrl, {
          waitUntil: 'networkidle0',
          timeout: timeout + Math.floor(Math.random() * 10000),
        });

        // Simulate human behavior
        await this.simulateHumanBehavior(page);

        const html = this.cleanContent(await page.content());
        const markdown = this.turndown.turndown(html);

        const [images, videos, metadata] = await Promise.all([
          params.includeImages ? this.extractImages(page) : Promise.resolve([]),
          params.includeVideos ? this.extractVideos(page) : Promise.resolve([]),
          this.extractMetadata(page),
        ]);

        const screenshot = params.screenshot ? 
          await screenshotService.capture(normalizedUrl, {
            fullPage: params.screenshot.fullPage,
            selector: params.screenshot.selector,
            format: params.screenshot.format || 'jpeg',
            quality: params.screenshot.quality || 80,
          }) : undefined;

        await page.close();

        const result = { markdown, images, videos, metadata, screenshot };
        extractionCache.set(cacheKey, result);
        logger.debug('Cached new extraction result', { url: params.url });

        return result;
      } catch (error) {
        logger.error('Extraction error:', error instanceof Error ? error : { message: String(error) });
        
        // Enhanced bot detection patterns
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
          // Exponential backoff with jitter
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
        if (browser) {
          browserPool.release(browser);
        }
      }
    }

    throw new ExtractionError('Maximum retry attempts exceeded');
  }
}

export const extractionService = new ExtractionService();