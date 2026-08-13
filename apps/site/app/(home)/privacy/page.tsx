import { Band } from '@/components/site/band';
import { Icon } from '@/components/site/icons';
import { PageHero } from '@/components/site/page-hero';
import { appVersion } from '@/lib/shared';

export const metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <>
      <PageHero
        eyebrow="Privacy"
        title="Privacy"
        summary="The short version: this application does not collect anything, because there is nothing in it that collects."
      />

      <Band tight>
        <div className="longform">
          <h2>The application</h2>
          <p>
            ShellySVN is a desktop client. It has no account system, no server component of its own
            and no cloud storage. The only network host it contacts is{' '}
            <strong>the Subversion server you configure</strong>.
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>What</th>
                  <th>Collected</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Usage analytics</td>
                  <td>
                    <strong>None.</strong> No analytics dependency is present in the build.
                  </td>
                </tr>
                <tr>
                  <td>Crash reports</td>
                  <td>
                    <strong>None.</strong> Crashes are not transmitted anywhere.
                  </td>
                </tr>
                <tr>
                  <td>Update pings</td>
                  <td>
                    <strong>None</strong> in {appVersion}. Auto-update is a 1.1 goal and will be
                    documented here before it ships.
                  </td>
                </tr>
                <tr>
                  <td>Account or identity</td>
                  <td>
                    <strong>None.</strong> There is nothing to sign in to.
                  </td>
                </tr>
                <tr>
                  <td>Repository contents</td>
                  <td>
                    <strong>Never leaves your machine or your server.</strong>
                  </td>
                </tr>
                <tr>
                  <td>Credentials</td>
                  <td>
                    Stored by the operating system keychain on your own device, never transmitted
                    anywhere except to your server.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="callout ok">
            <Icon name="check" />
            <div>
              <p>
                <b>You can verify this rather than trust it.</b> The source is public — grep it for
                an analytics SDK and you will not find one. Or run the app behind a proxy and watch
                what it opens.
              </p>
            </div>
          </div>

          <h2>This website</h2>
          <p>
            The site is statically hosted. It sets no cookies, embeds no third-party trackers and
            runs no analytics. Fonts are served from Google Fonts, which means your browser makes a
            request to <code>fonts.gstatic.com</code> — that is the only third-party request the
            site makes, and it is a candidate for self-hosting.
          </p>

          <h2>Downloads</h2>
          <p>
            Release artifacts are hosted on GitHub. Downloading one is a request to GitHub and is
            subject to their logging, which we neither control nor receive.
          </p>

          <h2>If this changes</h2>
          <p>
            Auto-update is on the roadmap for the 1.1 line, and it necessarily involves contacting a
            server to ask whether a newer build exists. When that ships, this page will say exactly
            what is sent, it will be documented before release rather than after, and it will be
            possible to turn off.
          </p>
          <div className="callout warn">
            <Icon name="warn" />
            <div>
              <p>
                <b>This is a plain-English statement, not a legal document.</b> The project has no{' '}
                <code>LICENSE</code> file yet either. If you need a formal privacy policy or terms
                of use for a procurement process, neither exists at this stage.
              </p>
            </div>
          </div>
        </div>
      </Band>
    </>
  );
}
