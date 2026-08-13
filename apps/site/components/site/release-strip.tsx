import { Icon } from './icons';
import { appVersion, bundledSvnVersion } from '@/lib/shared';

/**
 * The four release facts, above the masthead.
 *
 * These previously lived in a bar fixed to the bottom of the viewport, which
 * cost 28px of every screen permanently. Static and scrolling away is the same
 * information at none of the cost.
 */
export function ReleaseStrip() {
  return (
    <div className="release-strip">
      <div className="wrap inner">
        <span className="c">
          <Icon name="shell" />
          ShellySVN <b>{appVersion}</b>
        </span>
        <span className="c g">
          <Icon name="code" />
          free · open source
        </span>
        <span className="c">
          <Icon name="disk" />
          bundles <b>svn {bundledSvnVersion}</b>
        </span>
        <span className="c g last">
          <Icon name="eye-off" />
          no telemetry
        </span>
      </div>
    </div>
  );
}
