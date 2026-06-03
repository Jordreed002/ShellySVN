import { FeatureGrid } from '@/components/site/feature-grid';
import { PageHero } from '@/components/site/page-hero';

export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
      <PageHero
        eyebrow="Feature map"
        title="Capabilities that focus on real SVN friction."
        summary="The current public surface emphasizes workflows already represented in the desktop app and documented in this repo: sparse checkout, repository browsing, history, diffs, packaged binaries, and replacement-path readiness."
      />
      <FeatureGrid />
    </div>
  );
}
