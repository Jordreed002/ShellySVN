/**
 * SVN XML Parser with improved error handling
 * 
 * This module provides robust XML parsing for SVN command output
 * with comprehensive error handling and validation.
 */

import { XMLParser } from 'fast-xml-parser'
import type { SvnStatusResult, SvnStatusEntry, SvnLogResult, SvnLogEntry, SvnLogPath, SvnInfoResult, SvnStatusChar } from './types'

/**
 * Parser error class for specific XML parsing errors
 */
export class SvnXmlParseError extends Error {
  constructor(
    message: string,
    public readonly xml?: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'SvnXmlParseError'
  }
}

/**
 * XML parser configuration
 */
const createParser = () => new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  parseAttributeValue: true,
  isArray: (name) => ['entry', 'logentry', 'path', 'paths'].includes(name)
})

/**
 * Safe string extraction from parsed XML
 */
function safeString(value: unknown, defaultValue = ''): string {
  if (value === null || value === undefined) return defaultValue
  return String(value)
}

/**
 * Safe number extraction from parsed XML
 */
function safeNumber(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined) return defaultValue
  const num = Number(value)
  return isNaN(num) ? defaultValue : num
}

/**
 * Validate status character
 */
function isValidStatusChar(char: string): char is SvnStatusChar {
  return [' ', 'A', 'C', 'D', 'I', 'M', 'R', 'X', '?', '!', '~'].includes(char)
}

/**
 * Parse SVN status XML output with robust error handling
 */
export function parseSvnStatusXml(xml: string, basePath: string): SvnStatusResult {
  if (!xml || xml.trim() === '') {
    return { path: basePath, entries: [], revision: 0 }
  }

  try {
    const parser = createParser()
    const parsed = parser.parse(xml)
    const target = parsed.status?.target
    
    if (!target) {
      console.warn('parseSvnStatusXml: No target element found in XML')
      return { path: basePath, entries: [], revision: 0 }
    }
    
    // Handle both array and single entry
    const entriesRaw = target.entry || []
    const entriesArray = Array.isArray(entriesRaw) ? entriesRaw : [entriesRaw]
    
    const entries: SvnStatusEntry[] = entriesArray
      .filter((entry: Record<string, unknown>) => entry != null)
      .map((entry: Record<string, unknown>) => {
        const status = entry['wc-status'] as Record<string, unknown> | undefined
        const path = safeString(entry.path)
        const item = safeString(status?.item, ' ')
        const props = safeString(status?.props, ' ')
        const commit = status?.commit as Record<string, unknown> | undefined
        const lock = status?.lock as Record<string, unknown> | undefined
        
        // Validate status character
        const validStatus = isValidStatusChar(item) ? item : ' '
        
        return {
          path,
          status: validStatus,
          revision: safeNumber(commit?.revision),
          author: safeString(commit?.author),
          date: safeString(commit?.date),
          isDirectory: false, // Will be determined by file system check
          propsStatus: props !== ' ' && isValidStatusChar(props) ? props : undefined,
          lock: lock ? {
            owner: safeString(lock.owner),
            comment: safeString(lock.comment),
            date: safeString(lock['creation-date'])
          } : undefined
        }
      })
    
    return {
      path: basePath,
      entries,
      revision: safeNumber(parsed.status?.target?.revision)
    }
  } catch (error) {
    throw new SvnXmlParseError(
      'Failed to parse SVN status XML',
      xml,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * Parse SVN log XML output with robust error handling
 */
export function parseSvnLogXml(xml: string): SvnLogResult {
  if (!xml || xml.trim() === '') {
    return { entries: [], startRevision: 0, endRevision: 0 }
  }

  try {
    const parser = createParser()
    const parsed = parser.parse(xml)
    const logEntries = parsed.log?.logentry
    
    if (!logEntries || (Array.isArray(logEntries) && logEntries.length === 0)) {
      return { entries: [], startRevision: 0, endRevision: 0 }
    }
    
    const entriesArray = Array.isArray(logEntries) ? logEntries : [logEntries]
    
    const entries: SvnLogEntry[] = entriesArray
      .filter((entry: Record<string, unknown>) => entry != null)
      .map((entry: Record<string, unknown>) => {
        const paths = entry.paths?.path || []
        const pathsArray = Array.isArray(paths) ? paths : [paths]
        
        const parsedPaths: SvnLogPath[] = pathsArray
          .filter((p: Record<string, unknown>) => p != null)
          .map((p: Record<string, unknown>) => ({
            action: (safeString(p.action, 'M') || 'M') as 'A' | 'D' | 'M' | 'R',
            path: safeString(p['#text'] || p['_'] || p.path),
            copyFromPath: p['copyfrom-path'] ? safeString(p['copyfrom-path']) : undefined,
            copyFromRev: p['copyfrom-rev'] ? safeNumber(p['copyfrom-rev']) : undefined
          }))
        
        return {
          revision: safeNumber(entry.revision),
          author: safeString(entry.author, 'unknown'),
          date: safeString(entry.date),
          message: safeString(entry.msg || entry.message),
          paths: parsedPaths
        }
      })
    
    // Sort by revision descending
    entries.sort((a, b) => b.revision - a.revision)
    
    const revisions = entries.map(e => e.revision)
    
    return {
      entries,
      startRevision: revisions.length > 0 ? Math.min(...revisions) : 0,
      endRevision: revisions.length > 0 ? Math.max(...revisions) : 0
    }
  } catch (error) {
    throw new SvnXmlParseError(
      'Failed to parse SVN log XML',
      xml,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * Parse SVN info XML output with robust error handling
 */
export function parseSvnInfoXml(xml: string): SvnInfoResult {
  if (!xml || xml.trim() === '') {
    throw new SvnXmlParseError('Empty XML input for SVN info')
  }

  try {
    const parser = createParser()
    const parsed = parser.parse(xml)
    const info = parsed.info
    
    if (!info) {
      throw new SvnXmlParseError('No info element found in XML')
    }
    
    const entry = (info.entry || info) as Record<string, unknown>
    const repository = (entry.repository || {}) as Record<string, unknown>
    const commit = (entry.commit || {}) as Record<string, unknown>
    
    // Validate node kind
    const nodeKindRaw = safeString(entry.kind, 'unknown')
    const nodeKind: 'file' | 'dir' = nodeKindRaw === 'file' || nodeKindRaw === 'dir' 
      ? nodeKindRaw 
      : 'dir'
    
    return {
      path: safeString(entry.path),
      url: safeString(repository.url),
      repositoryRoot: safeString(repository.root),
      repositoryUuid: safeString(repository.uuid),
      revision: safeNumber(entry.revision),
      nodeKind,
      lastChangedAuthor: safeString(commit.author),
      lastChangedRevision: safeNumber(commit.revision),
      lastChangedDate: safeString(commit.date),
      workingCopyRoot: info['wc-root-abspath'] ? safeString(info['wc-root-abspath']) : undefined
    }
  } catch (error) {
    if (error instanceof SvnXmlParseError) {
      throw error
    }
    throw new SvnXmlParseError(
      'Failed to parse SVN info XML',
      xml,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * Parse SVN list XML output
 */
export function parseSvnListXml(xml: string): { path: string; entries: Array<{ name: string; path: string; kind: 'file' | 'dir'; size?: number; revision: number; author: string; date: string }> } {
  if (!xml || xml.trim() === '') {
    return { path: '', entries: [] }
  }

  try {
    const parser = createParser()
    const parsed = parser.parse(xml)
    const list = parsed.list
    
    if (!list) {
      return { path: '', entries: [] }
    }
    
    const entriesRaw = list.entry || []
    const entriesArray = Array.isArray(entriesRaw) ? entriesRaw : [entriesRaw]
    
    const entries = entriesArray
      .filter((entry: Record<string, unknown>) => entry != null)
      .map((entry: Record<string, unknown>) => {
        const commit = (entry.commit || {}) as Record<string, unknown>
        
        return {
          name: safeString(entry.name),
          path: safeString(entry.path),
          kind: safeString(entry.kind, 'file') === 'dir' ? 'dir' : 'file' as 'file' | 'dir',
          size: entry.size !== undefined ? safeNumber(entry.size) : undefined,
          revision: safeNumber(commit.revision),
          author: safeString(commit.author),
          date: safeString(commit.date)
        }
      })
    
    return {
      path: safeString(list.path),
      entries
    }
  } catch (error) {
    throw new SvnXmlParseError(
      'Failed to parse SVN list XML',
      xml,
      error instanceof Error ? error : undefined
    )
  }
}

export default {
  parseSvnStatusXml,
  parseSvnLogXml,
  parseSvnInfoXml,
  parseSvnListXml,
  SvnXmlParseError
}
