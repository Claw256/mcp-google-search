import { execSync } from 'child_process';
import { existsSync } from 'fs';

const findChromeExecutable = (): string | undefined => {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env['CHROME_PATH']
  ];

  for (const path of paths) {
    if (path && existsSync(path)) {
      return path;
    }
  }

  try {
    // Try to find Chrome using registry on Windows
    const regQuery = 'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve';
    const output = execSync(regQuery, { encoding: 'utf8' });
    const match = output.match(/REG_SZ\s+(.+)$/m);
    if (match && match[1] && existsSync(match[1].trim())) {
      return match[1].trim();
    }
  } catch (error) {
    // Ignore registry query errors
  }

  return undefined;
};

export const getBrowserLaunchOptions = () => ({
  headless: true,
  executablePath: findChromeExecutable(),
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
    '--disable-site-isolation-trials',
    '--disable-features=BlockInsecurePrivateNetworkRequests',
    '--disable-features=IsolateOrigins',
    '--disable-features=site-per-process',
    '--disable-features=OptimizeDataConsumption',
    '--disable-features=EnableDnsOverHttps',
    '--disable-features=NetworkService',
    '--disable-features=NetworkServiceInProcess',
    '--disable-features=TrustTokens',
    '--disable-features=TrustTokenOperationFetchHeaders',
    '--disable-features=TrustTokenOperationRedeem',
    '--disable-features=TrustTokenOperationIssuance',
    '--disable-features=TrustTokenOperationSigning',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--disable-features=CookieDeprecationMessages',
    '--disable-features=CrossOriginOpenerPolicyReporting',
    '--disable-features=CrossOriginOpenerPolicyReportOnly',
    '--disable-features=CrossOriginEmbedderPolicy',
    '--disable-features=CrossOriginResourcePolicy',
    '--disable-features=FetchMetadata',
    '--disable-features=WebAssemblyStreaming',
    '--disable-features=WebAssemblyTiering',
    '--disable-features=WebAssemblyBaseline',
    '--disable-features=WebAssemblyOptimization',
    '--disable-features=WebAssemblyLazyCompilation',
    '--disable-features=WebAssemblyDynamicTiering',
    '--disable-features=WebAssemblyGarbageCollection',
    '--disable-features=WebAssemblyTrapHandler',
    '--disable-features=WebAssemblySimd',
    '--disable-features=WebAssemblyThreads',
    '--disable-features=WebAssemblyBulkMemory',
    '--disable-features=WebAssemblyReferenceTypes',
    '--disable-features=WebAssemblyMultiValue',
    '--disable-features=WebAssemblyExceptions',
    '--disable-features=WebAssemblyTailCall',
    '--disable-features=WebAssemblySignExtensions',
    '--disable-features=WebAssemblyNontrapping',
    '--disable-features=WebAssemblyDebugger',
    '--disable-features=WebAssemblyTier',
    '--disable-features=WebAssemblyTierUp',
    '--disable-features=WebAssemblyTierDown',
    '--disable-features=WebAssemblyTierWarmup',
    '--disable-features=WebAssemblyTierLazy',
    '--disable-features=WebAssemblyTierEager',
    '--disable-features=WebAssemblyTierBackground',
    '--disable-features=WebAssemblyTierForeground',
    '--disable-features=WebAssemblyTierOptimized',
    '--disable-features=WebAssemblyTierBaseline',
    '--disable-features=WebAssemblyTierDebug',
    '--disable-features=WebAssemblyTierProfile',
    '--disable-features=WebAssemblyTierWasm',
    '--disable-features=WebAssemblyTierAsmjs',
    '--disable-features=WebAssemblyTierNone'
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

export const getUserAgents = () => [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.87 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.87 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.87 Safari/537.36'
];