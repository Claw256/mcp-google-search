import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ErrorCode, McpError, } from '@modelcontextprotocol/sdk/types.js';
import { searchService } from '../services/search.js';
import { extractionService } from '../services/extraction.js';
import { screenshotService } from '../services/screenshot.js';
import { logger } from '../infrastructure/logger.js';
import { browserPool } from '../infrastructure/connection-pool.js';
function isSearchParams(args) {
    if (!args || typeof args !== 'object') {
        return false;
    }
    const params = args;
    return typeof params.query === 'string' &&
        (!params.trustedDomains || Array.isArray(params.trustedDomains)) &&
        (!params.excludedDomains || Array.isArray(params.excludedDomains)) &&
        (!params.resultCount || typeof params.resultCount === 'number') &&
        (!params.safeSearch || typeof params.safeSearch === 'boolean') &&
        (!params.dateRestrict || typeof params.dateRestrict === 'string');
}
function isExtractionParams(args) {
    if (!args || typeof args !== 'object') {
        return false;
    }
    const params = args;
    return typeof params.url === 'string' &&
        (!params.includeImages || typeof params.includeImages === 'boolean') &&
        (!params.includeVideos || typeof params.includeVideos === 'boolean') &&
        (!params.preserveLinks || typeof params.preserveLinks === 'boolean') &&
        (!params.formatCode || typeof params.formatCode === 'boolean') &&
        (!params.screenshot || typeof params.screenshot === 'object');
}
function isScreenshotRequest(args) {
    if (!args || typeof args !== 'object') {
        return false;
    }
    const params = args;
    return typeof params.url === 'string' &&
        (!params.fullPage || typeof params.fullPage === 'boolean') &&
        (!params.selector || typeof params.selector === 'string') &&
        (!params.format || ['png', 'jpeg', 'webp'].includes(params.format)) &&
        (!params.quality || (typeof params.quality === 'number' && params.quality >= 1 && params.quality <= 100));
}
class GoogleSearchMcpServer {
    server;
    isShuttingDown;
    constructor() {
        this.server = new Server({
            name: 'google-search-mcp',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.isShuttingDown = false;
        this.setupRequestHandlers();
        this.setupErrorHandler();
    }
    setupRequestHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, () => ({
            tools: [
                {
                    name: 'search',
                    description: 'Perform a Google Custom Search with advanced filtering options',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Search query' },
                            trustedDomains: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'List of trusted domains',
                            },
                            excludedDomains: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'List of domains to exclude',
                            },
                            resultCount: {
                                type: 'number',
                                description: 'Number of results to return (1-10)',
                                minimum: 1,
                                maximum: 10,
                            },
                            safeSearch: {
                                type: 'boolean',
                                description: 'Enable safe search',
                            },
                            dateRestrict: {
                                type: 'string',
                                description: 'Date restriction (e.g., "d[number]" for days, "m[number]" for months)',
                                pattern: '^[dmy][1-9][0-9]*$',
                            },
                        },
                        required: ['query'],
                    },
                },
                {
                    name: 'extract',
                    description: 'Extract and process content from a webpage',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', description: 'URL to extract content from' },
                            includeImages: {
                                type: 'boolean',
                                description: 'Include image metadata',
                            },
                            includeVideos: {
                                type: 'boolean',
                                description: 'Include video metadata',
                            },
                            preserveLinks: {
                                type: 'boolean',
                                description: 'Preserve links in markdown',
                            },
                            formatCode: {
                                type: 'boolean',
                                description: 'Format code blocks',
                            },
                            screenshot: {
                                type: 'object',
                                properties: {
                                    fullPage: { type: 'boolean', description: 'Capture full page' },
                                    selector: { type: 'string', description: 'CSS selector for element capture' },
                                    format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Image format' },
                                    quality: { type: 'number', minimum: 1, maximum: 100, description: 'Image quality' },
                                },
                            },
                        },
                        required: ['url'],
                    },
                },
                {
                    name: 'screenshot',
                    description: 'Capture screenshots of webpages or elements',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', description: 'URL to capture' },
                            fullPage: {
                                type: 'boolean',
                                description: 'Capture full page',
                            },
                            selector: {
                                type: 'string',
                                description: 'CSS selector for element capture',
                            },
                            format: {
                                type: 'string',
                                enum: ['png', 'jpeg', 'webp'],
                                description: 'Image format',
                            },
                            quality: {
                                type: 'number',
                                minimum: 1,
                                maximum: 100,
                                description: 'Image quality',
                            },
                        },
                        required: ['url'],
                    },
                },
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            if (this.isShuttingDown) {
                throw new McpError(ErrorCode.InternalError, 'Server is shutting down');
            }
            const { name, arguments: toolArgs = {} } = request.params;
            const timer = logger.startTimer();
            try {
                switch (name) {
                    case 'search': {
                        if (!isSearchParams(toolArgs)) {
                            throw new McpError(ErrorCode.InvalidParams, 'Invalid search parameters');
                        }
                        const results = await searchService.search(toolArgs);
                        const duration = timer();
                        logger.info('Search completed', { duration, query: toolArgs.query });
                        return {
                            result: results,
                            _meta: { duration },
                        };
                    }
                    case 'extract': {
                        if (!isExtractionParams(toolArgs)) {
                            throw new McpError(ErrorCode.InvalidParams, 'Invalid extraction parameters');
                        }
                        const results = await extractionService.extract(toolArgs);
                        const duration = timer();
                        logger.info('Extraction completed', { duration, url: toolArgs.url });
                        return {
                            result: results,
                            _meta: { duration },
                        };
                    }
                    case 'screenshot': {
                        if (!isScreenshotRequest(toolArgs)) {
                            throw new McpError(ErrorCode.InvalidParams, 'Invalid screenshot parameters');
                        }
                        const { url, ...options } = toolArgs;
                        const results = await screenshotService.capture(url, options);
                        const duration = timer();
                        logger.info('Screenshot captured', { duration, url });
                        return {
                            result: results,
                            _meta: { duration },
                        };
                    }
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            }
            catch (error) {
                const duration = timer();
                logger.error('Tool execution error:', {
                    tool: name,
                    duration,
                    error: error instanceof Error ? error : { message: String(error) },
                });
                if (error instanceof McpError) {
                    throw error;
                }
                throw new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : 'Unknown error');
            }
        });
    }
    setupErrorHandler() {
        this.server.onerror = (error) => {
            logger.error('MCP Server error:', error);
        };
    }
    async start() {
        try {
            // Initialize browser pool
            await browserPool.initialize();
            logger.info('Browser pool initialized');
            // Connect to transport
            const transport = new StdioServerTransport();
            await this.server.connect(transport);
            logger.info('Google Search MCP server started');
            // Handle shutdown signals
            const cleanup = async (signal) => {
                if (this.isShuttingDown) {
                    return;
                }
                this.isShuttingDown = true;
                logger.info(`Received ${signal}, shutting down...`);
                try {
                    await browserPool.closeAll();
                    await this.server.close();
                    logger.info('Server shutdown complete');
                    process.exit(0);
                }
                catch (error) {
                    logger.error('Error during shutdown:', error instanceof Error ? error : { message: String(error) });
                    process.exit(1);
                }
            };
            process.on('SIGINT', () => void cleanup('SIGINT'));
            process.on('SIGTERM', () => void cleanup('SIGTERM'));
            process.on('uncaughtException', (error) => {
                logger.error('Uncaught exception:', error);
                void cleanup('uncaughtException');
            });
            process.on('unhandledRejection', (reason) => {
                logger.error('Unhandled rejection:', reason instanceof Error ? reason : { message: String(reason) });
                void cleanup('unhandledRejection');
            });
        }
        catch (error) {
            logger.error('Failed to start server:', error instanceof Error ? error : { message: String(error) });
            throw error;
        }
    }
}
export const mcpServer = new GoogleSearchMcpServer();
