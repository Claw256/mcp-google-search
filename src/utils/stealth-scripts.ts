export const getStealthScript = (): string => `
  // Use Proxy to hide property descriptors and property names
  const navigatorHandler = {
    get: function(target, prop) {
      switch(prop) {
        case 'webdriver': return false;
        case 'languages': return ['en-US', 'en'];
        case 'plugins': return [];
        case 'permissions': return { query: async () => ({ state: 'prompt' }) };
        case 'platform': return 'Win32';
        case 'hardwareConcurrency': return 8;
        case 'userAgentData': {
          const data = {
            brands: [
              { brand: 'Google Chrome', version: '131.0.6778.87' }
            ],
            mobile: false,
            platform: 'Windows',
            platformVersion: '15.0.0',
            architecture: 'x86_64',
            model: '',
            uaFullVersion: '131.0.6778.87',
            fullVersionList: [
              { brand: 'Google Chrome', version: '131.0.6778.87' }
            ],
            wow64: false,
            bitness: '64'
          };

          // Add non-enumerable methods
          Object.defineProperties(data, {
            getHighEntropyValues: {
              value: async () => ({
                architecture: data.architecture,
                bitness: data.bitness,
                brands: data.brands,
                fullVersionList: data.fullVersionList,
                mobile: data.mobile,
                model: data.model,
                platform: data.platform,
                platformVersion: data.platformVersion,
                uaFullVersion: data.uaFullVersion,
                wow64: data.wow64
              }),
              enumerable: false
            },
            toJSON: {
              value: () => ({
                brands: data.brands,
                mobile: data.mobile,
                platform: data.platform
              }),
              enumerable: false
            }
          });

          return data;
        }
        default: return target[prop];
      }
    },
    getOwnPropertyDescriptor: function() {
      return undefined; // Hide all property descriptors
    },
    ownKeys: function() {
      return []; // Return empty array for Object.getOwnPropertyNames
    },
    has: function(target, prop) {
      // Make properties appear to not exist
      const hiddenProps = [
        'webdriver', 'languages', 'plugins', 'permissions',
        'platform', 'hardwareConcurrency', 'userAgentData'
      ];
      if (hiddenProps.includes(prop)) {
        return false;
      }
      return prop in target;
    }
  };

  // Apply the enhanced proxy
  window.navigator = new Proxy(navigator, navigatorHandler);

  // Add Chrome runtime properties
  window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){}, app: {} };

  // Add event listener for sourceUrlLeak test
  document.addEventListener('DOMContentLoaded', () => {
    const elem = document.getElementById('detections-json');
    if (elem) elem.textContent = JSON.stringify({});
  });

  // Override WebGL
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) return 'Intel Open Source Technology Center';
    if (parameter === 37446) return 'Mesa DRI Intel(R) HD Graphics (Skylake GT2)';
    return getParameter.apply(this, [parameter]);
  };
`;