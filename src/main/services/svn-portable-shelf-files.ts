export interface PortableShelfFile {
  relativePath: string;
  status: string;
  kind: 'file' | 'directory';
}

export function collapseNestedFiles(files: PortableShelfFile[]): PortableShelfFile[] {
  return files.filter(
    (file, index) =>
      !files.some(
        (parent, parentIndex) => {
          if (parentIndex === index || parent.kind !== 'directory') return false;
          // Shelves may be created on one OS and restored on another.
          const filePath = file.relativePath.replace(/\\/g, '/');
          const parentPrefix = `${parent.relativePath.replace(/\\/g, '/')}/`;
          return filePath.startsWith(parentPrefix);
        }
      )
  );
}
