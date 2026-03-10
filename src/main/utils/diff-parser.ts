/**
 * Streaming Diff Parser for Memory-Efficient Large Diff Processing
 *
 * This module provides a streaming parser for unified diff output that can handle
 * very large diffs (10MB+) with minimal memory overhead. Instead of loading the
 * entire diff into memory, it parses chunks progressively and yields parsed
 * hunks as they become available.
 *
 * Performance Targets:
 * - < 100MB memory for 10MB diff files
 * - Load 10MB+ diffs in < 1 second
 * - Support diffs with 100k+ lines
 */

import { Transform, TransformCallback, PassThrough } from 'stream';
import type { SvnDiffFile, SvnDiffHunk, SvnDiffLine, SvnDiffResult } from '@shared/types';

/**
 * Represents a parsed diff chunk that can be rendered independently
 */
export interface DiffChunk {
  /** Index in the flattened list of chunks */
  index: number;
  /** File this chunk belongs to */
  fileIndex: number;
  /** Hunk index within the file */
  hunkIndex: number;
  /** The hunk data */
  hunk: SvnDiffHunk;
  /** File metadata */
  fileMeta: {
    oldPath: string;
    newPath: string;
    isBinary: boolean;
  };
}

/**
 * Progressive diff parsing result
 */
export interface ProgressiveDiffResult {
  /** Complete files parsed so far */
  files: SvnDiffFile[];
  /** Total number of chunks */
  totalChunks: number;
  /** Whether parsing is complete */
  isComplete: boolean;
  /** Error if parsing failed */
  error?: string;
}

/**
 * Options for streaming diff parser
 */
export interface StreamingDiffParserOptions {
  /** Maximum chunk size before yielding (default: 1000 lines) */
  chunkSize?: number;
  /** Whether to include context lines (default: true) */
  includeContext?: boolean;
  /** Callback for each chunk parsed */
  onChunk?: (chunk: DiffChunk) => void;
  /** Callback when parsing is complete */
  onComplete?: (result: SvnDiffResult) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * Line metadata for efficient line-based parsing
 */
interface LineMeta {
  type: 'added' | 'removed' | 'context' | 'header' | 'hunk' | 'separator';
  content: string;
  rawLine: string;
}

/**
 * Parse a single line of diff output
 */
function parseLine(rawLine: string): LineMeta {
  if (rawLine.startsWith('Index: ')) {
    return { type: 'header', content: rawLine.substring(7), rawLine };
  }
  if (rawLine.startsWith('=======')) {
    return { type: 'separator', content: '', rawLine };
  }
  if (rawLine.startsWith('--- ')) {
    return { type: 'header', content: rawLine.substring(4), rawLine };
  }
  if (rawLine.startsWith('+++ ')) {
    return { type: 'header', content: rawLine.substring(4), rawLine };
  }
  if (rawLine.startsWith('@@')) {
    return { type: 'hunk', content: rawLine, rawLine };
  }
  if (rawLine.startsWith('+')) {
    return { type: 'added', content: rawLine.substring(1), rawLine };
  }
  if (rawLine.startsWith('-')) {
    return { type: 'removed', content: rawLine.substring(1), rawLine };
  }
  if (rawLine.startsWith(' ')) {
    return { type: 'context', content: rawLine.substring(1), rawLine };
  }
  // Empty line or other context
  return { type: 'context', content: rawLine, rawLine };
}

/**
 * Parse hunk header line @@ -start,count +start,count @@
 */
function parseHunkHeader(
  line: string
): { oldStart: number; oldLines: number; newStart: number; newLines: number } | null {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) return null;

  return {
    oldStart: parseInt(match[1], 10),
    oldLines: match[2] ? parseInt(match[2], 10) : 1,
    newStart: parseInt(match[3], 10),
    newLines: match[4] ? parseInt(match[4], 10) : 1,
  };
}

/** Maximum line length to buffer (1MB) - prevents memory exhaustion from extremely long lines */
const MAX_LINE_LENGTH = 1024 * 1024;

/**
 * Streaming Diff Parser
 *
 * A Transform stream that parses unified diff output and emits parsed chunks.
 * Designed for memory-efficient processing of large diffs.
 *
 * @example
 * ```typescript
 * import { createReadStream } from 'fs'
 * import { StreamingDiffParser } from './diff-parser'
 *
 * const parser = new StreamingDiffParser({
 *   onChunk: (chunk) => renderChunk(chunk),
 *   onComplete: (result) => console.log('Done', result.files.length)
 * })
 *
 * createReadStream('large.diff').pipe(parser)
 * ```
 */
export class StreamingDiffParser extends Transform {
  private buffer: string = '';
  private files: SvnDiffFile[] = [];
  private currentFile: SvnDiffFile | null = null;
  private currentHunk: SvnDiffHunk | null = null;
  private oldLineNum: number = 0;
  private newLineNum: number = 0;
  private chunkCount: number = 0;
  private lineCount: number = 0;
  private isComplete: boolean = false;
  private isDestroyed: boolean = false;
  private error_: string | undefined;

  private readonly chunkSize: number;
  private readonly includeContext: boolean;
  private readonly onChunk?: (chunk: DiffChunk) => void;
  private readonly onComplete?: (result: SvnDiffResult) => void;
  private readonly onError?: (error: Error) => void;

  constructor(options: StreamingDiffParserOptions = {}) {
    super({ decodeStrings: true, encoding: 'utf8' });
    this.chunkSize = options.chunkSize ?? 1000;
    this.includeContext = options.includeContext ?? true;
    this.onChunk = options.onChunk;
    this.onComplete = options.onComplete;
    this.onError = options.onError;
  }

  /**
   * Process incoming chunk of diff data
   */
  _transform(chunk: Buffer | string, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      if (this.isDestroyed) {
        callback();
        return;
      }

      this.buffer += chunk.toString('utf8');

      // Protect against extremely long lines
      if (this.buffer.length > MAX_LINE_LENGTH) {
        // Find the last newline and truncate to it
        const lastNewline = this.buffer.lastIndexOf('\n');
        if (lastNewline > 0) {
          this.buffer = this.buffer.substring(lastNewline + 1);
        } else {
          // No newline found, truncate the buffer
          this.buffer = '';
        }
        console.warn('[StreamingDiffParser] Line exceeded maximum length, truncated');
      }

      this.processBuffer();
      callback();
    } catch (error) {
      this.error_ = (error as Error).message;
      this.onError?.(error as Error);
      callback(error as Error);
    }
  }

  /**
   * Handle end of stream
   */
  _flush(callback: TransformCallback): void {
    try {
      // Process any remaining buffer
      if (this.buffer.trim()) {
        this.buffer += '\n'; // Ensure last line is processed
        this.processBuffer();
      }

      // Finalize last hunk and file
      this.finalizeCurrentHunk();
      this.finalizeCurrentFile();

      this.isComplete = true;

      const result: SvnDiffResult = {
        files: this.files,
        hasChanges: this.files.length > 0,
        isBinary: false,
      };

      this.onComplete?.(result);
      this.push(JSON.stringify(result));
      callback();
    } catch (error) {
      this.error_ = (error as Error).message;
      this.onError?.(error as Error);
      callback(error as Error);
    }
  }

  /**
   * Process buffered data line by line
   */
  private processBuffer(): void {
    if (this.isDestroyed) return;

    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (this.isDestroyed) return;
      this.processLine(line);
      this.lineCount++;
    }
  }

  /**
   * Process a single line
   */
  private processLine(line: string): void {
    const parsed = parseLine(line);

    switch (parsed.type) {
      case 'header':
        this.handleHeader(parsed.rawLine);
        break;
      case 'separator':
        // Skip === separators
        break;
      case 'hunk':
        this.handleHunkHeader(parsed.rawLine);
        break;
      case 'added':
      case 'removed':
      case 'context':
        this.handleContentLine(parsed);
        break;
    }
  }

  /**
   * Handle header lines (Index:, ---, +++)
   */
  private handleHeader(line: string): void {
    if (line.startsWith('Index: ')) {
      // New file starts
      this.finalizeCurrentHunk();
      this.finalizeCurrentFile();

      this.currentFile = {
        oldPath: '',
        newPath: '',
        hunks: [],
      };
    } else if (line.startsWith('--- ') && this.currentFile) {
      this.currentFile.oldPath = line.substring(4).trim();
    } else if (line.startsWith('+++ ') && this.currentFile) {
      this.currentFile.newPath = line.substring(4).trim();
    }
  }

  /**
   * Handle hunk header @@ -start,count +start,count @@
   */
  private handleHunkHeader(line: string): void {
    const parsed = parseHunkHeader(line);
    if (!parsed) return;

    // Finalize previous hunk
    this.finalizeCurrentHunk();

    // Start new hunk
    this.currentHunk = {
      oldStart: parsed.oldStart,
      oldLines: parsed.oldLines,
      newStart: parsed.newStart,
      newLines: parsed.newLines,
      lines: [
        {
          type: 'hunk',
          content: line,
        },
      ],
    };

    this.oldLineNum = parsed.oldStart;
    this.newLineNum = parsed.newStart;
  }

  /**
   * Handle content lines (added, removed, context)
   */
  private handleContentLine(parsed: LineMeta): void {
    if (!this.currentHunk) return;

    // Skip context if not included
    if (!this.includeContext && parsed.type === 'context') return;

    const diffLine: SvnDiffLine = {
      type: parsed.type,
      content: parsed.content,
    };

    if (parsed.type === 'added') {
      diffLine.newLineNumber = this.newLineNum++;
    } else if (parsed.type === 'removed') {
      diffLine.oldLineNumber = this.oldLineNum++;
    } else if (parsed.type === 'context') {
      diffLine.oldLineNumber = this.oldLineNum++;
      diffLine.newLineNumber = this.newLineNum++;
    }

    this.currentHunk.lines.push(diffLine);

    // Yield chunk if chunk size reached
    if (this.currentHunk.lines.length >= this.chunkSize) {
      this.yieldChunk();
    }
  }

  /**
   * Finalize current hunk and add to current file
   */
  private finalizeCurrentHunk(): void {
    if (this.currentHunk && this.currentFile) {
      // Yield remaining lines in hunk
      if (this.currentHunk.lines.length > 0) {
        this.yieldChunk();
      }
      this.currentFile.hunks.push(this.currentHunk);
      this.currentHunk = null;
    }
  }

  /**
   * Finalize current file and add to files list
   */
  private finalizeCurrentFile(): void {
    if (this.currentFile) {
      this.files.push(this.currentFile);
      this.currentFile = null;
    }
  }

  /**
   * Yield a chunk to the callback
   */
  private yieldChunk(): void {
    if (!this.currentHunk || !this.currentFile) return;

    const chunk: DiffChunk = {
      index: this.chunkCount++,
      fileIndex: this.files.length,
      hunkIndex: this.currentFile.hunks.length,
      hunk: { ...this.currentHunk, lines: [...this.currentHunk.lines] },
      fileMeta: {
        oldPath: this.currentFile.oldPath,
        newPath: this.currentFile.newPath,
        isBinary: false,
      },
    };

    this.onChunk?.(chunk);

    // Clear processed lines to free memory
    this.currentHunk.lines = [];
  }

  /**
   * Get current parsing statistics
   */
  getStats(): { files: number; chunks: number; lines: number; isComplete: boolean } {
    return {
      files: this.files.length,
      chunks: this.chunkCount,
      lines: this.lineCount,
      isComplete: this.isComplete,
    };
  }

  /**
   * Get parsing error if any
   */
  getError(): string | undefined {
    return this.error_;
  }

  /**
   * Destroy the parser and clean up resources
   * Call this to abort parsing mid-stream
   */
  destroy(error?: Error | null): this {
    this.isDestroyed = true;
    this.buffer = '';
    this.files = [];
    this.currentFile = null;
    this.currentHunk = null;
    return super.destroy(error);
  }
}

/**
 * Parse a diff string in a single call (non-streaming)
 * Uses chunked processing internally for memory efficiency
 */
export function parseDiffStreaming(
  diffOutput: string,
  options: StreamingDiffParserOptions = {}
): Promise<SvnDiffResult> {
  return new Promise((resolve, reject) => {
    const chunks: DiffChunk[] = [];
    const files: SvnDiffFile[] = [];
    let currentFile: SvnDiffFile | null = null;

    const parser = new StreamingDiffParser({
      ...options,
      onChunk: (chunk) => {
        chunks.push(chunk);

        // Track files
        if (!currentFile || currentFile.oldPath !== chunk.fileMeta.oldPath) {
          if (currentFile) {
            files.push(currentFile);
          }
          currentFile = {
            oldPath: chunk.fileMeta.oldPath,
            newPath: chunk.fileMeta.newPath,
            hunks: [],
          };
        }

        // Add hunk to current file
        currentFile.hunks.push(chunk.hunk);

        options.onChunk?.(chunk);
      },
      onComplete: (result) => {
        if (currentFile) {
          files.push(currentFile);
        }
        resolve({
          ...result,
          files: files.length > 0 ? files : result.files,
        });
      },
      onError: (error) => {
        reject(error);
        options.onError?.(error);
      },
    });

    parser.write(diffOutput);
    parser.end();
  });
}

/**
 * Create a flattened array of hunks from a diff result
 * Useful for virtualized rendering
 */
export function flattenDiffHunks(result: SvnDiffResult): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  let index = 0;

  for (let fileIndex = 0; fileIndex < result.files.length; fileIndex++) {
    const file = result.files[fileIndex];

    for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
      const hunk = file.hunks[hunkIndex];

      chunks.push({
        index: index++,
        fileIndex,
        hunkIndex,
        hunk,
        fileMeta: {
          oldPath: file.oldPath,
          newPath: file.newPath,
          isBinary: file.isBinary ?? false,
        },
      });
    }
  }

  return chunks;
}

/**
 * Estimate memory size of a diff result
 */
export function estimateDiffSize(result: SvnDiffResult): number {
  let size = 64; // Base object overhead

  for (const file of result.files) {
    size += file.oldPath.length * 2 + file.newPath.length * 2 + 64;

    for (const hunk of file.hunks) {
      size += 32; // Hunk metadata

      for (const line of hunk.lines) {
        size += line.content.length * 2 + 32; // Line object
      }
    }
  }

  return size;
}

/**
 * Create a pass-through stream for diff data
 * Useful for piping diff output to multiple consumers
 */
export function createDiffStream(): PassThrough {
  return new PassThrough({ encoding: 'utf8' });
}

export default StreamingDiffParser;
