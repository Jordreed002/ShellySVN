import { PageHero } from '@/components/site/page-hero';

const roadmap = [
  {
    title: 'Desktop workflow parity',
    body: 'Continue hardening the replacement-critical SVN operations that matter for teams moving from older desktop clients: checkout, update, commit, sparse checkout, repository browsing, and conflict handling.',
  },
  {
    title: 'Release qualification',
    body: 'Finish release-candidate validation work such as code signing, notarization, and target-machine verification so public messaging can move beyond preview positioning.',
  },
  {
    title: 'Shell integration readiness',
    body: 'Keep Explorer and Finder helper flows explicit and gated until packaged helper delivery is fully validated, rather than implying that parity is already finished.',
  },
];

export default function RoadmapPage() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
      <PageHero
        eyebrow="Roadmap"
        title="The public path stays narrow and honest."
        summary="The roadmap page summarizes what the repo already signals internally: focus on daily SVN workflows, keep release maturity explicit, and avoid overpromising shell parity before the delivery chain is truly closed."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        {roadmap.map((item) => (
          <article key={item.title} className="section-frame rounded-3xl p-6">
            <h2 className="text-2xl">{item.title}</h2>
            <p className="mt-4 text-sm leading-7 text-stone-700">{item.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
