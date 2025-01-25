# Google Search MCP Server

An MCP server that provides Google search capabilities, web content extraction, and screenshot functionality with advanced bot detection avoidance.

## Features

- Google Custom Search with advanced filtering
- Web content extraction with markdown conversion
- Screenshot capture with format options
- Rate limiting and caching
- Browser instance pooling
- Bot detection avoidance using rebrowser-puppeteer

## Prerequisites

- Bun runtime v1.0 or higher
- Google API credentials (API key and Search Engine ID)

## Installation

```bash
# Install dependencies
bun install

# Build the TypeScript files
bun run build
```

## Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Google API Configuration
GOOGLE_API_KEY=your_api_key
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id

# Resource Limits
MAX_CONCURRENT_BROWSERS=3
BROWSER_TIMEOUT=30000

# Rate Limiting
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX_REQUESTS=60

# Cache Settings
SEARCH_CACHE_TTL=3600
EXTRACT_CACHE_TTL=7200
MAX_CACHE_ITEMS=1000

# Browser Pool Configuration
BROWSER_POOL_MIN=1
BROWSER_POOL_MAX=5
BROWSER_POOL_IDLE_TIMEOUT=30000

# Bot Detection Avoidance
REBROWSER_PATCHES_RUNTIME_FIX_MODE=addBinding
REBROWSER_PATCHES_SOURCE_URL=jquery.min.js
REBROWSER_PATCHES_UTILITY_WORLD_NAME=util
REBROWSER_PATCHES_DEBUG=0
```

## Bot Detection Avoidance

This server uses rebrowser-puppeteer to avoid bot detection:

1. Runtime.Enable Leak Prevention:
   - Uses the addBinding technique to avoid Runtime.Enable detection
   - Works with web workers and iframes
   - Maintains access to the main world context

2. Source URL Masking:
   - Changes Puppeteer's sourceURL to look like a legitimate script
   - Helps avoid detection of automation tools

3. Utility World Name:
   - Uses a generic utility world name
   - Prevents detection through world name patterns

4. Browser Launch Configuration:
   - Disables automation flags
   - Uses optimized Chrome arguments
   - Configures viewport and window settings

## Using with Claude Desktop

1. Make sure you have Claude Desktop installed and updated to the latest version
2. Open your Claude Desktop configuration file:
   - MacOS/Linux: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

3. Add the server configuration:

```json
{
  "mcpServers": {
    "google-search": {
      "command": "bun",
      "args": [
        "--directory",
        "/ABSOLUTE/PATH/TO/google_search_mcp",
        "start"
      ]
    }
  }
}
```

Replace `/ABSOLUTE/PATH/TO/google_search_mcp` with the absolute path to your server directory.

4. Restart Claude Desktop
5. Look for the hammer icon ![](https://mintlify.s3.us-west-1.amazonaws.com/mcp/images/claude-desktop-mcp-hammer-icon.svg) to confirm the tools are available

## Available Tools

### 1. Search Tool
```typescript
{
  name: "search",
  params: {
    query: string;
    trustedDomains?: string[];
    excludedDomains?: string[];
    resultCount?: number;
    safeSearch?: boolean;
    dateRestrict?: string;
  }
}
```

### 2. Extract Tool
```typescript
{
  name: "extract",
  params: {
    url: string;
    includeImages?: boolean;
    includeVideos?: boolean;
    preserveLinks?: boolean;
    formatCode?: boolean;
    screenshot?: {
      fullPage?: boolean;
      selector?: string;
      format?: 'png' | 'jpeg' | 'webp';
      quality?: number;
    }
  }
}
```

### 3. Screenshot Tool
```typescript
{
  name: "screenshot",
  params: {
    url: string;
    fullPage?: boolean;
    selector?: string;
    format?: 'png' | 'jpeg' | 'webp';
    quality?: number;
  }
}
```

## Troubleshooting

### Claude Desktop Integration Issues

1. Check the logs:
   ```bash
   # MacOS/Linux
   tail -n 20 -f ~/Library/Logs/Claude/mcp*.log
   
   # Windows
   type %APPDATA%\Claude\Logs\mcp*.log
   ```

2. Common issues:
   - Server not showing up: Check configuration file syntax and paths
   - Tool calls failing: Check server logs and restart Claude Desktop
   - Path issues: Ensure you're using absolute paths

For more detailed troubleshooting, refer to the [MCP debugging guide](https://modelcontextprotocol.io/docs/tools/debugging).

## Development

```bash
# Run in development mode with watch
bun run dev

# Run tests
bun test

# Run linter
bun run lint
```

## Important Notes

1. Bot Detection:
   - The bot detection avoidance features help prevent most common detection methods
   - However, additional measures like proper proxies and user agents may be needed
   - Some websites may still detect automation through other means

2. Performance:
   - Browser instances are pooled and reused
   - Idle browsers are automatically cleaned up
   - Resource limits prevent overloading

## License

MIT