import { XMLParser } from 'fast-xml-parser'
import type { SvnStatusResult, SvnStatusEntry, SvnLogResult, SvnLogEntry, SvnLogPath, SvnInfoResult, SvnStatusChar } from './types'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  parseAttributeValue: true
})

/**
 * Parse SVN status XML output
 */
export function parseSvnStatusXml(xml: string, basePath: string): SvnStatusResult {
  const parsed = parser.parse(xml)
  const target = parsed.status?.target
  
  if (!target) {
    return { path: basePath, entries: [], revision: 0 }
  }
  
  // Handle single entry (not in array)
  const entriesRaw = target.entry 
    ? (Array.isArray(target.entry) ? target.entry : [target.entry])
    : []
  
  const entries: SvnStatusEntry[] = entriesRaw.map((entry: Record<string, unknown>) => {
    const status = entry['wc-status'] as Record<string, unknown>
    const path = String(entry.path || '')
    const item = String(status?.item || ' ')
    const props = String(status?.props || ' ')
    const commit = status?.commit as Record<string, unknown> | undefined
    
    return {
      path,
      status: item as SvnStatusChar,
      revision: commit?.revision ? Number(commit.revision) : undefined,
      author: commit?.author ? String(commit.author) : undefined,
      date: commit?.date ? String(commit.date) : undefined,
      isDirectory: false, // Will be determined by file system check
      propsStatus: props !== ' ' ? (props as SvnStatusChar) : undefined
    }
  })
  
  return {
    path: basePath,
    entries,
    revision: parsed.status?.target?.revision || 0
  }
}

/**
 * Parse SVN log XML output
 */
export function parseSvnLogXml(xml: string): SvnLogResult {
  const parsed = parser.parse(xml)
  const logEntries = parsed.log?.logentry
  
  if (!logEntries) {
    return { entries: [], startRevision: 0, endRevision: 0 }
  }
  
  const entriesRaw = Array.isArray(logEntries) ? logEntries : [logEntries]
  
  const entries: SvnLogEntry[] = entriesRaw.map((entry: Record<string, unknown>) => {
    const paths = entry.paths?.path
    const pathsRaw = paths 
      ? (Array.isArray(paths) ? paths : [paths])
      : []
    
    const parsedPaths: SvnLogPath[] = pathsRaw.map((p: Record<string, unknown>) => ({
      action: String(p.action || 'M') as 'A' | 'D' | 'M' | 'R',
      path: String(p['#text'] || p['_'] || ''),
      copyFromPath: p['copyfrom-path'] ? String(p['copyfrom-path']) : undefined,
      copyFromRev: p['copyfrom-rev'] ? Number(p['copyfrom-rev']) : undefined
    }))
    
    return {
      revision: Number(entry.revision || 0),
      author: String(entry.author || 'unknown'),
      date: String(entry.date || ''),
      message: String(entry.msg || ''),
      paths: parsedPaths
    }
  })
  
  const revisions = entries.map(e => e.revision)
  
  return {
    entries,
    startRevision: revisions.length > 0 ? Math.min(...revisions) : 0,
    endRevision: revisions.length > 0 ? Math.max(...revisions) : 0
  }
}

/**
 * Parse SVN info XML output
 */
export function parseSvnInfoXml(xml: string): SvnInfoResult {
  const parsed = parser.parse(xml)
  const info = parsed.info
  
  if (!info) {
    throw new Error('Failed to parse SVN info XML')
  }
  
  const entry = info.entry || {}
  const repository = entry.repository || {}
  const commit = entry.commit || {}
  
  return {
    path: String(entry.path || ''),
    url: String(repository.url || ''),
    repositoryRoot: String(repository.root || ''),
    repositoryUuid: String(repository.uuid || ''),
    revision: Number(entry.revision || 0),
    nodeKind: String(entry.kind || 'unknown') as 'file' | 'dir',
    lastChangedAuthor: String(commit.author || ''),
    lastChangedRevision: Number(commit.revision || 0),
    lastChangedDate: String(commit.date || ''),
    workingCopyRoot: info['wc-root-abspath'] ? String(info['wc-root-abspath']) : undefined
  }
}
