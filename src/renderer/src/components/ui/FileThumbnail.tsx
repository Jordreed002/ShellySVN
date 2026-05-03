import { useState, useEffect } from 'react';
import {
  File,
  FileCode,
  FileImage,
  FileText,
  FileArchive,
  FileSpreadsheet,
  FileJson,
  Folder,
} from 'lucide-react';
import { isImageFile } from '../../hooks/useThumbnails';

interface FileThumbnailProps {
  filePath: string;
  isDirectory: boolean;
  size?: number;
  className?: string;
  showPreview?: boolean;
}

const thumbnailCache = new Map<string, string | null>();
const thumbnailRequests = new Map<string, Promise<string | null>>();
const MAX_THUMBNAIL_CACHE_ENTRIES = 300;

function rememberThumbnail(filePath: string, data: string | null) {
  if (thumbnailCache.size >= MAX_THUMBNAIL_CACHE_ENTRIES) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (oldestKey) thumbnailCache.delete(oldestKey);
  }
  thumbnailCache.set(filePath, data);
}

function readThumbnail(filePath: string): Promise<string | null> {
  if (thumbnailCache.has(filePath)) {
    return Promise.resolve(thumbnailCache.get(filePath) ?? null);
  }

  const pending = thumbnailRequests.get(filePath);
  if (pending) return pending;

  const request = window.api.fs
    .readImageAsBase64(filePath)
    .then((result) => {
      const data = result.success && result.data ? result.data : null;
      rememberThumbnail(filePath, data);
      return data;
    })
    .catch(() => {
      rememberThumbnail(filePath, null);
      return null;
    })
    .finally(() => {
      thumbnailRequests.delete(filePath);
    });

  thumbnailRequests.set(filePath, request);
  return request;
}

// File type to icon mapping
function getFileIcon(filename: string, isDirectory: boolean) {
  if (isDirectory) return Folder;

  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    // Images
    png: FileImage,
    jpg: FileImage,
    jpeg: FileImage,
    gif: FileImage,
    webp: FileImage,
    ico: FileImage,
    svg: FileImage,
    bmp: FileImage,
    // Code
    js: FileCode,
    jsx: FileCode,
    ts: FileCode,
    tsx: FileCode,
    py: FileCode,
    rb: FileCode,
    go: FileCode,
    rs: FileCode,
    java: FileCode,
    c: FileCode,
    cpp: FileCode,
    h: FileCode,
    cs: FileCode,
    swift: FileCode,
    kt: FileCode,
    php: FileCode,
    vue: FileCode,
    svelte: FileCode,
    // Data
    json: FileJson,
    xml: FileJson,
    yaml: FileJson,
    yml: FileJson,
    toml: FileJson,
    // Documents
    md: FileText,
    txt: FileText,
    pdf: FileText,
    doc: FileText,
    docx: FileText,
    rtf: FileText,
    // Spreadsheets
    csv: FileSpreadsheet,
    xls: FileSpreadsheet,
    xlsx: FileSpreadsheet,
    // Archives
    zip: FileArchive,
    tar: FileArchive,
    gz: FileArchive,
    rar: FileArchive,
    '7z': FileArchive,
  };

  return iconMap[ext] || File;
}

export function FileThumbnail({
  filePath,
  isDirectory,
  size = 16,
  className = '',
  showPreview = true,
}: FileThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const filename = filePath.split(/[/\\]/).pop() || filePath;
  const Icon = getFileIcon(filename, isDirectory);
  const isImage = isImageFile(filename);

  // Load thumbnail for images
  useEffect(() => {
    if (!isImage || !showPreview || isDirectory) {
      setThumbnailUrl(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const cached = thumbnailCache.get(filePath);
    if (cached !== undefined) {
      setThumbnailUrl(cached);
      setError(cached === null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);

    void readThumbnail(filePath).then((data) => {
      if (cancelled) return;
      setThumbnailUrl(data);
      setError(data === null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, isImage, showPreview, isDirectory]);

  // For directories or non-image files, show icon
  if (isDirectory || !isImage || !showPreview) {
    return (
      <Icon
        className={`${className} ${isDirectory ? 'text-accent' : 'text-text-muted'}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // Loading state
  if (loading) {
    return (
      <div
        className={`animate-pulse bg-bg-tertiary rounded ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // Error state - fall back to icon
  if (error || !thumbnailUrl) {
    return (
      <FileImage className={`text-text-muted ${className}`} style={{ width: size, height: size }} />
    );
  }

  // Show thumbnail
  return (
    <img
      src={thumbnailUrl}
      alt={filename}
      className={`rounded-sm object-contain ${className}`}
      style={{ width: size, height: size }}
      loading="lazy"
    />
  );
}
