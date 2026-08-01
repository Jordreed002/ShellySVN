import fallbackReleasesData from '@/data/releases.snapshot.json';
import { gitConfig } from './shared';
import type { SiteArtifact, SiteRelease } from './types';

const fallbackReleases = fallbackReleasesData as SiteRelease[];

type GitHubAsset = {
  browser_download_url: string;
  digest?: string;
  name: string;
  size?: number;
};

type GitHubRelease = {
  assets: GitHubAsset[];
  body?: string;
  html_url: string;
  prerelease: boolean;
  published_at?: string;
  tag_name: string;
};

function parseArtifact(asset: GitHubAsset): SiteArtifact | null {
  const name = asset.name;
  const checksumSha256 = asset.digest?.replace(/^sha256:/, '');

  if (name.endsWith('.dmg')) {
    return {
      platform: 'macOS',
      arch: name.includes('arm64') ? 'Apple Silicon' : 'Intel',
      label: 'Disk image',
      fileName: name,
      downloadUrl: asset.browser_download_url,
      sizeBytes: asset.size,
      checksumSha256,
    };
  }

  if (
    name === 'ShellySVN.Setup.0.1.0.exe' ||
    /^ShellySVN\.Setup\..+\.exe$/.test(name) ||
    /^ShellySVN-.+-x64-setup\.exe$/i.test(name)
  ) {
    return {
      platform: 'Windows',
      arch: 'x64',
      label: 'Installer',
      fileName: name,
      downloadUrl: asset.browser_download_url,
      sizeBytes: asset.size,
      checksumSha256,
    };
  }

  if (name === 'ShellySVN.exe') {
    return {
      platform: 'Windows',
      arch: 'x64',
      label: 'Portable executable',
      fileName: name,
      downloadUrl: asset.browser_download_url,
      sizeBytes: asset.size,
      checksumSha256,
    };
  }

  if (name.endsWith('.AppImage')) {
    return {
      platform: 'Linux',
      arch: 'x64',
      label: 'AppImage',
      fileName: name,
      downloadUrl: asset.browser_download_url,
      sizeBytes: asset.size,
      checksumSha256,
    };
  }

  if (name.endsWith('.deb')) {
    return {
      platform: 'Linux',
      arch: 'x64',
      label: 'Debian package',
      fileName: name,
      downloadUrl: asset.browser_download_url,
      sizeBytes: asset.size,
      checksumSha256,
    };
  }

  if (name.endsWith('.rpm')) {
    return {
      platform: 'Linux',
      arch: 'x64',
      label: 'RPM package',
      fileName: name,
      downloadUrl: asset.browser_download_url,
      sizeBytes: asset.size,
      checksumSha256,
    };
  }

  if (name.endsWith('.tar.gz') && !name.includes('source')) {
    return {
      platform: 'Linux',
      arch: 'x64',
      label: 'Portable tarball',
      fileName: name,
      downloadUrl: asset.browser_download_url,
      sizeBytes: asset.size,
      checksumSha256,
    };
  }

  return null;
}

function normalizeRelease(release: GitHubRelease): SiteRelease {
  const version = release.tag_name.replace(/^v/, '');

  return {
    version,
    tag: release.tag_name,
    publishedAt: release.published_at ?? new Date(0).toISOString(),
    channel: release.prerelease ? 'preview' : 'stable',
    notesUrl: release.html_url,
    bodyMd: release.body,
    artifacts: release.assets
      .map(parseArtifact)
      .filter((artifact): artifact is SiteArtifact => artifact !== null),
  };
}

export async function getSiteReleases(): Promise<SiteRelease[]> {
  const url = `https://api.github.com/repos/${gitConfig.user}/${gitConfig.repo}/releases?per_page=6`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ShellySVN-site-build',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`GitHub releases request failed with status ${response.status}`);
    }

    const releases = (await response.json()) as GitHubRelease[];
    const normalized = releases
      .map(normalizeRelease)
      .filter((release) => release.artifacts.length > 0);
    return normalized.length > 0 ? normalized : fallbackReleases;
  } catch {
    return fallbackReleases;
  }
}

export async function getLatestRelease(): Promise<SiteRelease | undefined> {
  const releases = await getSiteReleases();
  return releases[0];
}
