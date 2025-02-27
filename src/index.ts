#!/usr/bin/env node
import { config } from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { mcpServer } from './mcp/server.js';
import { logger } from './infrastructure/logger.js';
import { browserPool } from './infrastructure/connection-pool.js';

// Load environment variables
config();

// Verify required environment variables
const requiredEnvVars = [
  'GOOGLE_API_KEY',
  'GOOGLE_SEARCH_ENGINE_ID',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  try {
    // Initialize browser pool
    await browserPool.initialize();
    logger.info('Browser pool initialized');

    // Start the MCP server with stdio transport
    const transport = new StdioServerTransport();
    await mcpServer.start(transport);

    // Log startup message
    logger.info('Google Search MCP server started successfully');
    logger.info('Available tools:');
    logger.info('- search: Perform Google Custom Search with advanced filtering');
    logger.info('- extract: Extract and process content from webpages');

  } catch (error) {
    logger.error('Failed to start server:', error instanceof Error ? error : { message: String(error) });
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled rejection:', reason instanceof Error ? reason : { message: String(reason) });
  process.exit(1);
});

// Start the server
main().catch((error: unknown) => {
  logger.error('Fatal error:', error instanceof Error ? error : { message: String(error) });
  process.exit(1);
});