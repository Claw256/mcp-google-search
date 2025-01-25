import type { Browser } from 'rebrowser-puppeteer';
import puppeteer from 'rebrowser-puppeteer';
import { logger } from './logger.js';

interface Plugin {
  name: string;
  description: string;
  filename: string;
  length: number;
}

interface PluginArray extends Array<Plugin> {
  item(index: number): Plugin | null;
  namedItem(name: string): Plugin | null;
}

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
    // Configure rebrowser patches for enhanced undetectability
    process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] = 'alwaysIsolated';
    process.env['REBROWSER_PATCHES_SOURCE_URL'] = 'app.js';
    process.env['REBROWSER_PATCHES_UTILITY_WORLD_NAME'] = 'utilityWorld';
    process.env['REBROWSER_PATCHES_ENABLE_WEBGL'] = 'true';
    process.env['REBROWSER_PATCHES_ENABLE_CANVAS'] = 'true';

    // Random viewport size within common resolutions
    const viewports = [
      { width: 1280, height: 800 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
      { width: 1440, height: 900 },
    ];
    const viewport = viewports[Math.floor(Math.random() * viewports.length)];

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
        // Additional arguments for better undetectability
        `--window-size=${viewport.width},${viewport.height}`,
        '--font-render-hinting=medium',
        '--enable-webgl',
        '--use-gl=swiftshader',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-client-side-phishing-detection',
        '--lang=en-US,en',
        // Additional stealth args
        '--disable-infobars',
        '--disable-blink-features',
        '--disable-blink-features=AutomationControlled',
        '--disable-prompt-on-repost',
        // Hardware acceleration and rendering
        '--ignore-gpu-blacklist',
        '--enable-gpu-rasterization',
        '--enable-native-gpu-memory-buffers',
      ],
      ignoreDefaultArgs: [
        '--enable-automation',
        '--enable-blink-features=IdleDetection',
      ],
      defaultViewport: {
        ...viewport,
        deviceScaleFactor: 1,
        hasTouch: false,
        isLandscape: true,
        isMobile: false,
      },
    });

    // Patch the browser context
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    
    // Set a random user agent
    await page.setUserAgent(this.getRandomUserAgent());
    
    // Enhanced stealth scripts
    await page.evaluateOnNewDocument(() => {
      // Override navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Add language plugins
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // Override permissions
      Object.defineProperty(navigator, 'permissions', {
        value: {
          query: async (): Promise<{ state: string }> => ({
            state: 'prompt',
          }),
        },
      });

      // Hardware concurrency
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
      });

      // Override memory info
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
      });

      // Add media devices
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          enumerateDevices: async () => [
            {
              deviceId: 'default',
              kind: 'audioinput',
              label: 'Default Audio Device',
              groupId: 'default',
            },
            {
              deviceId: 'default',
              kind: 'videoinput',
              label: 'Default Video Device',
              groupId: 'default',
            },
          ],
        },
      });

      // Add battery API
      Object.defineProperty(navigator, 'getBattery', {
        value: async () => ({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 1,
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
        }),
      });

      // Add plugins array
      const plugins: PluginArray = [
        {
          name: 'Chrome PDF Plugin',
          description: 'Portable Document Format',
          filename: 'internal-pdf-viewer',
          length: 1,
        },
        {
          name: 'Chrome PDF Viewer',
          description: '',
          filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
          length: 1,
        },
        {
          name: 'Native Client',
          description: '',
          filename: 'internal-nacl-plugin',
          length: 1,
        },
      ] as PluginArray;

      plugins.item = function(index: number): Plugin | null {
        return this[index] || null;
      };

      plugins.namedItem = function(name: string): Plugin | null {
        return this.find((p) => p.name === name) || null;
      };

      Object.defineProperty(navigator, 'plugins', {
        get: () => plugins,
      });

      // Add chrome runtime
      const makeError = (): Error => {
        const err = new Error('Failed to execute');
        err.toString = () => '[object Error]';
        return err;
      };

      // @ts-expect-error - Intentionally extending window.chrome
      window.chrome = {
        app: {
          InstallState: {
            DISABLED: 'disabled',
            INSTALLED: 'installed',
            NOT_INSTALLED: 'not_installed',
          },
          RunningState: {
            CANNOT_RUN: 'cannot_run',
            READY_TO_RUN: 'ready_to_run',
            RUNNING: 'running',
          },
          getDetails: makeError,
          getIsInstalled: makeError,
          installState: makeError,
          isInstalled: false,
          runningState: makeError,
        },
        runtime: {
          OnInstalledReason: {
            CHROME_UPDATE: 'chrome_update',
            INSTALL: 'install',
            SHARED_MODULE_UPDATE: 'shared_module_update',
            UPDATE: 'update',
          },
          OnRestartRequiredReason: {
            APP_UPDATE: 'app_update',
            OS_UPDATE: 'os_update',
            PERIODIC: 'periodic',
          },
          PlatformArch: {
            ARM: 'arm',
            ARM64: 'arm64',
            MIPS: 'mips',
            MIPS64: 'mips64',
            X86_32: 'x86-32',
            X86_64: 'x86-64',
          },
          PlatformNaclArch: {
            ARM: 'arm',
            MIPS: 'mips',
            MIPS64: 'mips64',
            X86_32: 'x86-32',
            X86_64: 'x86-64',
          },
          PlatformOs: {
            ANDROID: 'android',
            CROS: 'cros',
            LINUX: 'linux',
            MAC: 'mac',
            OPENBSD: 'openbsd',
            WIN: 'win',
          },
          RequestUpdateCheckStatus: {
            NO_UPDATE: 'no_update',
            THROTTLED: 'throttled',
            UPDATE_AVAILABLE: 'update_available',
          },
        },
      };

      // Override WebGL
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(
        this: WebGLRenderingContext,
        parameter: number
      ): unknown {
        // Spoof renderer info
        if (parameter === 37445) {
          return 'Intel Inc.';
        }
        if (parameter === 37446) {
          return 'Intel Iris OpenGL Engine';
        }
        // Additional WebGL parameters
        if (parameter === 33902) {
          return 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)';
        }
        if (parameter === 33901) {
          return 'Google Inc.';
        }
        if (parameter === 35724) {
          return 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)';
        }
        return getParameter.call(this, parameter);
      };

      // Touch event overrides
      const touchEventProps: PropertyDescriptorMap = {
        ontouchstart: {
          value: null,
          configurable: true,
          enumerable: true,
          writable: true,
        },
        ontouchend: {
          value: null,
          configurable: true,
          enumerable: true,
          writable: true,
        },
        ontouchmove: {
          value: null,
          configurable: true,
          enumerable: true,
          writable: true,
        },
        ontouchcancel: {
          value: null,
          configurable: true,
          enumerable: true,
          writable: true,
        },
      };
      Object.defineProperties(window, touchEventProps);
    });

    await page.close();

    this.pool.push(browser);
    return browser;
  }

  public async acquire(): Promise<Browser> {
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

    // If we have more browsers than minimum and this one is idle
    if (this.pool.length > this.minSize && !this.inUse.has(browser)) {
      setTimeout(() => {
        void this.closeBrowserIfIdle(browser);
      }, this.idleTimeout);
    }
  }

  private async closeBrowserIfIdle(browser: Browser): Promise<void> {
    // Double check it's still not in use
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