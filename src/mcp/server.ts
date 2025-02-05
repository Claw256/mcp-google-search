import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { logger } from '../infrastructure/logger.js';
import { browserPool } from '../infrastructure/connection-pool.js';
import { searchService } from '../services/search.js';
import { extractionService } from '../services/extraction.js';
class GoogleSearchMcpServer {
  private server: McpServer;
  private isShuttingDown: boolean;

  constructor() {
    this.server = new McpServer({
      name: 'google-search-mcp',
      version: '1.0.0',
    });

    this.isShuttingDown = false;
    this.setupTools();
  }

  private setupTools(): void {
    // Search tool
    this.server.tool(
      'search',
      {
        query: z.string().describe('Search query'),
        trustedDomains: z.array(z.string()).optional().describe('List of trusted domains'),
        excludedDomains: z.array(z.string()).optional().describe('List of domains to exclude'),
        resultCount: z.number().min(1).max(10).optional().describe('Number of results to return (1-10)'),
        safeSearch: z.boolean().optional().describe('Enable safe search'),
        dateRestrict: z.string().regex(/^[dmy][1-9][0-9]*$/).optional()
          .describe('Date restriction (e.g., "d[number]" for days, "m[number]" for months)'),
      },
      async (params) => {
        if (this.isShuttingDown) {
          return {
            content: [{ type: 'text', text: 'Server is shutting down' }],
            isError: true,
          };
        }

        try {
          const results = await searchService.search(params);
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
          };
        } catch (error) {
          logger.error('Search error:', error instanceof Error ? error : { message: String(error) });
          return {
            content: [{ type: 'text', text: error instanceof Error ? error.message : 'Unknown error' }],
            isError: true,
          };
        }
      }
    );

    // Extract tool
    this.server.tool(
      'extract',
      {
        url: z.string().describe('URL to extract content from'),
        includeImages: z.boolean().optional().describe('Include image metadata'),
        includeVideos: z.boolean().optional().describe('Include video metadata'),
        preserveLinks: z.boolean().optional().describe('Preserve links in markdown'),
        formatCode: z.boolean().optional().describe('Format code blocks')
      },
      async (params) => {
        if (this.isShuttingDown) {
          return {
            content: [{ type: 'text', text: 'Server is shutting down' }],
            isError: true,
          };
        }

        try {
          const results = await extractionService.extract(params);
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
          };
        } catch (error) {
          logger.error('Extraction error:', error instanceof Error ? error : { message: String(error) });
          return {
            content: [{ type: 'text', text: error instanceof Error ? error.message : 'Unknown error' }],
            isError: true,
          };
        }
      }
    );

  }

  public async start(transport: StdioServerTransport): Promise<void> {
    try {
      // Initialize browser pool
      await browserPool.initialize();
      logger.info('Browser pool initialized');

      // Connect to transport
      await this.server.connect(transport);
      logger.info('Google Search MCP server started');

      // Handle shutdown signals
      const cleanup = async (signal: string): Promise<void> => {
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
        } catch (error) {
          logger.error('Error during shutdown:', error instanceof Error ? error : { message: String(error) });
          process.exit(1);
        }
      };

      process.on('SIGINT', () => void cleanup('SIGINT'));
      process.on('SIGTERM', () => void cleanup('SIGTERM'));
      process.on('uncaughtException', (error: Error) => {
        logger.error('Uncaught exception:', error);
        void cleanup('uncaughtException');
      });
      process.on('unhandledRejection', (reason: unknown) => {
        logger.error('Unhandled rejection:', reason instanceof Error ? reason : { message: String(reason) });
        void cleanup('unhandledRejection');
      });
    } catch (error) {
      logger.error('Failed to start server:', error instanceof Error ? error : { message: String(error) });
      throw error;
    }
  }
}

export const mcpServer = new GoogleSearchMcpServer();