import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: appName,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    /**
     * The site has no light theme — global.css declares `color-scheme: dark`
     * and a single dark token set. Fumadocs renders a light/dark toggle in the
     * sidebar by default, which did nothing but claim otherwise. Disabled until
     * a `.light` token set exists.
     */
    themeSwitch: { enabled: false },
  };
}
