import express, { type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { apiKeyAuth } from '../auth/apikey.js';
import { createMcpServer } from './mcp-server.js';
import { version } from './version.js';
import { logger } from '../util/logger.js';
import type { MachineAdapter } from '../core/adapter.js';

/**
 * Build the Express app.
 *
 * - GET /health and GET /version are unauthenticated and expose no secrets.
 * - POST /mcp is the MCP Streamable HTTP endpoint, protected by the API key.
 *
 * Stateless mode: a new McpServer + transport is created per request and closed
 * when the response finishes, so the server never depends on a client's MCP
 * session handling.
 */
export function createApp(adapter: MachineAdapter) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'claw-pc', version });
  });

  app.get('/version', (_req: Request, res: Response) => {
    res.json({ version });
  });

  app.post('/mcp', apiKeyAuth, async (req: Request, res: Response) => {
    const reqId = req.headers['x-request-id'] ?? cryptoRandomId();
    const log = logger.child({ reqId, tool: 'mcp' });
    const server = createMcpServer(adapter);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error({ err }, 'mcp request failed');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // MCP over Streamable HTTP is POST-only in stateless mode; reject others clearly.
  app.get('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST for MCP.' },
      id: null,
    });
  });

  return app;
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
