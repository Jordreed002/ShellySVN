import { PageHero } from '@/components/site/page-hero';

const items = [
  {
    question: 'Is ShellySVN production-ready today?',
    answer:
      'The public site keeps a preview label on purpose. Packaged builds exist, but the project still tracks final production-release gates such as signing, notarization, and release-candidate verification.',
  },
  {
    question: 'What platforms are available?',
    answer:
      'The repo and releases currently target Windows x64, macOS Intel, macOS Apple Silicon, and Linux x64 packaging where artifacts are published.',
  },
  {
    question: 'Why emphasize sparse checkout so heavily?',
    answer:
      'Because it is one of the clearest strengths already represented in the codebase and README. Large repositories are painful without a selective working-copy story.',
  },
  {
    question: 'Does the public site expose internal engineering specs?',
    answer:
      'No. Contributor and engineering records stay in-repo. The public docs are curated for users and evaluators instead of mirroring `.spec` directly.',
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
      <PageHero
        eyebrow="FAQ"
        title="Straight answers about scope, maturity, and rollout."
        summary="This first site release is intentionally conservative: it tells evaluators what exists, what is preview-only, and where to dig deeper in the docs."
      />
      <div className="space-y-4">
        {items.map((item) => (
          <article key={item.question} className="section-frame rounded-3xl p-6">
            <h2 className="text-2xl">{item.question}</h2>
            <p className="mt-4 text-sm leading-7 text-stone-700">{item.answer}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
