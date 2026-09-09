/** Connection-only MCP probe used by management surfaces. */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Config } from './index.ts'
import { createTransport } from './transport.ts'

/** Result of a probe; no tool is registered on the Harness runtime. */
export interface McpProbeResult {
  /** Number of tools advertised by the server. */
  toolCount: number
  /** Raw MCP tool names, returned for a useful connection preview. */
  toolNames: string[]
}

/** Run an operation with a bounded wall-clock deadline. */
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
        timer.unref()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Connect, initialize, and fully discover one MCP server without registering
 * any model-facing tools. The transport is always closed before settlement.
 * @param config - MCP client transport configuration.
 * @param timeoutMs - Wall-clock budget for each protocol operation.
 * @returns The discovered tool count and raw names.
 */
export async function probeMcpServer(config: Config, timeoutMs = 10_000): Promise<McpProbeResult> {
  const client = new Client(
    { name: 'dsh-mcp-probe', version: '0.0.1' },
    { capabilities: {} },
  )
  try {
    await withTimeout(client.connect(createTransport(config)), timeoutMs, `MCP ${config.serverName} initialize`)
    const names: string[] = []
    let cursor: string | undefined
    do {
      const response = await withTimeout(
        client.request(
          { method: 'tools/list', ...(cursor === undefined ? {} : { params: { cursor } }) },
          ListToolsResultSchema,
        ),
        timeoutMs,
        `MCP ${config.serverName} tools/list`,
      )
      for (const tool of response.tools) names.push(tool.name)
      cursor = response.nextCursor
    } while (cursor !== undefined)
    return { toolCount: names.length, toolNames: names }
  } finally {
    try {
      await withTimeout(client.close(), timeoutMs, `MCP ${config.serverName} close`)
    } catch {
      // A failed probe must not be masked by a transport that was already dead.
    }
  }
}
