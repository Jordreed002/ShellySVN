export type SiteArtifact = {
  arch: string;
  checksumSha256?: string;
  downloadUrl: string;
  fileName: string;
  label: string;
  platform: string;
  sizeBytes?: number;
};

export type SiteRelease = {
  artifacts: SiteArtifact[];
  bodyMd?: string;
  channel: 'preview' | 'stable';
  notesUrl: string;
  publishedAt: string;
  tag: string;
  version: string;
};

export type FeatureEntry = {
  audience: string;
  slug: string;
  status: 'available' | 'preview' | 'planned';
  summary: string;
  title: string;
};
