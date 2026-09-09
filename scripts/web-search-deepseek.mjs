#!/usr/bin/env node

/**
 * Standalone fallback for the model-facing web_search tool.
 *
 * It uses the same DeepSeek Anthropic Messages endpoint and native
 * web_search_20250305 server tool as packages/web/web-search-deepseek, but does
 * not require the DSH web runtime or the platform web_search balance.
 *
 * Usage:
 *   node scripts/web-search-deepseek.mjs "DeepSeek latest news"
 *   node scripts/web-search-deepseek.mjs --json --max-results 5 "A股今日行情"
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { load } from 'js-yaml'

const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic/v1'
const DEFAULT_MODEL = 'deepseek-v4-flash'
const DEFAULT_API_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_MAX_USES = 5
const DEFAULT_MAX_RESULTS = 8
const REQUEST_TIMEOUT_MS = 60_000

function usage() {
  console.error('Usage: node scripts/web-search-deepseek.mjs [--json] [--max-results N] [--max-uses N] <query>')
}

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function parseArgs(argv) {
  let json = false
  let maxResults = DEFAULT_MAX_RESULTS
  let maxUses = DEFAULT_MAX_USES
  const queryParts = []

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--json') {
      json = true
    } else if (argument === '--max-results') {
      maxResults = positiveInteger(argv[++index], '--max-results')
    } else if (argument === '--max-uses') {
      maxUses = positiveInteger(argv[++index], '--max-uses')
    } else if (argument === '--help' || argument === '-h') {
      usage()
      process.exit(0)
    } else {
      queryParts.push(argument)
    }
  }

  const query = queryParts.join(' ').trim()
  if (query.length === 0) throw new Error('query must be a non-empty string')
  return { json, maxResults, maxUses, query }
}

async function readApiKey() {
  if (typeof process.env.DEEPSEEK_API_KEY === 'string' && process.env.DEEPSEEK_API_KEY.length > 0) {
    return process.env.DEEPSEEK_API_KEY
  }

  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const filename = join(dshHome, '.credentials.yaml')
  try {
    const document = load(await readFile(filename, 'utf8'))
    if (typeof document === 'object' && document !== null && !Array.isArray(document)) {
      const value = document.DEEPSEEK_API_KEY
      if (typeof value === 'string' && value.length > 0) return value
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`cannot read DSH credentials: ${String(error)}`, { cause: error })
  }

  throw new Error('DEEPSEEK_API_KEY is not available in the environment or DSH credentials file')
}

function citationSnippets(blocks) {
  const snippets = new Map()
  for (const block of blocks) {
    if (block?.type !== 'text' || !Array.isArray(block.citations)) continue
    for (const citation of block.citations) {
      if (typeof citation?.url !== 'string' || citation.url.length === 0) continue
      if (typeof citation.cited_text !== 'string' || citation.cited_text.length === 0) continue
      if (!snippets.has(citation.url)) snippets.set(citation.url, citation.cited_text)
    }
  }
  return snippets
}

function parseResponse(payload, maxResults) {
  const blocks = Array.isArray(payload?.content) ? payload.content : []
  const resultBlocks = blocks.filter(block => block?.type === 'web_search_tool_result')
  if (resultBlocks.length === 0) {
    throw new Error('DeepSeek returned no web_search_tool_result blocks; native search may not have been triggered')
  }

  const snippets = citationSnippets(blocks)
  const seen = new Set()
  const sources = []
  for (const block of resultBlocks) {
    if (!Array.isArray(block.content)) continue
    for (const item of block.content) {
      if (item?.type !== 'web_search_result' || typeof item.url !== 'string' || item.url.length === 0 || seen.has(item.url)) continue
      seen.add(item.url)
      sources.push({
        url: item.url,
        ...(typeof item.title === 'string' && item.title.length > 0 ? { title: item.title } : {}),
        ...(snippets.has(item.url) ? { snippet: snippets.get(item.url) } : {}),
        ...(typeof item.page_age === 'string' && item.page_age.length > 0 ? { publishedAt: item.page_age } : {}),
      })
    }
  }

  const answer = blocks
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text.trim())
    .filter(Boolean)
    .join('\n\n')
  const truncated = sources.length > maxResults
  return {
    ...(answer.length > 0 ? { answer } : {}),
    sources: sources.slice(0, maxResults),
    truncated,
  }
}

async function search({ maxResults, maxUses, query }) {
  const apiKey = await readApiKey()
  const baseURL = process.env.DEEPSEEK_SEARCH_BASE_URL ?? DEFAULT_BASE_URL
  const model = process.env.DEEPSEEK_SEARCH_MODEL ?? DEFAULT_MODEL
  const maxTokens = positiveInteger(process.env.DEEPSEEK_SEARCH_MAX_TOKENS ?? DEFAULT_MAX_TOKENS, 'DEEPSEEK_SEARCH_MAX_TOKENS')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseURL.replace(/\/$/u, '')}/messages`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'x-api-key': apiKey,
        authorization: `Bearer ${apiKey}`,
        'anthropic-version': DEFAULT_API_VERSION,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'deepseek-harness-web-search-fallback/0.1.0',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: `Perform a web search for the query: ${query}` }],
        }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      let detail = ''
      try {
        const error = await response.json()
        detail = typeof error?.error === 'string' ? error.error : error?.error?.message ?? error?.message ?? ''
      } catch {
        // Keep the HTTP status when the provider returns a non-JSON error body.
      }
      throw new Error(`DeepSeek API error (HTTP ${response.status})${detail ? `: ${detail}` : ''}`)
    }

    return parseResponse(await response.json(), maxResults)
  } finally {
    clearTimeout(timeout)
  }
}

function formatMarkdown(result) {
  const parts = []
  if (result.answer) parts.push(result.answer)
  if (result.sources.length > 0) {
    parts.push(`Sources:\n${result.sources.map(source => {
      const label = source.title || new URL(source.url).hostname
      const metadata = [source.snippet, source.publishedAt ? `(${source.publishedAt})` : ''].filter(Boolean).join(' ')
      return `- [${label}](${source.url})${metadata ? ` — ${metadata}` : ''}`
    }).join('\n')}`)
  } else if (!result.answer) {
    parts.push('No results found.')
  }
  if (result.truncated) parts.push(`(Showing the first ${result.sources.length} sources; reduce the query scope or increase --max-results.)`)
  return `${parts.join('\n\n')}\n`
}

try {
  const options = parseArgs(process.argv.slice(2))
  const result = await search(options)
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatMarkdown(result))
} catch (error) {
  console.error(`web-search-deepseek: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
