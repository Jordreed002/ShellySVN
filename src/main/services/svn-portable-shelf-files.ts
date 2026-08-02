import { sep } from 'node:path';

export interface PortableShelfFile {
  relativePath: string;
  status: string;
  kind: 'file' | 'directory';
}

export function collapseNestedFiles(files: PortableShelfFile[]): PortableShelfFile[] {
  return files.filter(
    (file, index) =>
      !files.some(
        (parent, parentIndex) =>
          parentIndex !== index &&
          parent.kind === 'directory' &&
          file.relativePath.startsWith(`${parent.relativePath}${sep}`)
      )
  );
}
