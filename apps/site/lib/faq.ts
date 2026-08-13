/**
 * Site FAQ. Three of these have answers we would rather not give — the
 * licence, the signing and the untested upper bound on repository size. They
 * are questions 2, 3 and 9, and they stay in.
 */
export interface FaqItem {
  question: string;
  answer: string;
}

export const faqItems: FaqItem[] = [
  {
    question: 'Is it really free?',
    answer:
      'Yes, and there is no paid tier to upgrade to. No account, no licence key, no seats, no trial period and no feature behind a wall. Commercial use is included. The source is public so you can check that there is nothing to buy.',
  },
  {
    question: 'What licence is it under?',
    answer:
      'This is not settled yet. The source is published, but there is no LICENSE file in the repository and no license field in package.json. Until one lands, nobody can say what they are permitted to do with a fork. We would rather say that here than let the word "open source" imply terms that do not exist.',
  },
  {
    question: 'Why are the builds not signed?',
    answer:
      'Signing and notarisation are a release gate for 1.1 final, not a design choice. Today macOS asks for Open Anyway on first launch and a managed Windows fleet may block the installer. If your machines are locked down, this is the blocker — not the app.',
  },
  {
    question: 'Do I need to install Subversion separately?',
    answer:
      'No. Subversion 1.14.3 is compiled into every build on every platform. Onboarding a teammate is one download, whichever operating system they were given.',
  },
  {
    question: 'Will it work with my server?',
    answer:
      'Any Subversion server from 1.6 upwards — Apache with mod_dav_svn, svnserve, VisualSVN, a hosted provider, file:// or svn+ssh://. Hooks, authentication and access rules are untouched, because this is a client and changes nothing server-side.',
  },
  {
    question: 'Can I run it alongside TortoiseSVN or the CLI?',
    answer:
      'Yes, and for now you probably should. It reads the standard working copy format, so all three can point at the same folder. Explorer overlay icons are the one thing this does not replace yet.',
  },
  {
    question: 'Does it phone home?',
    answer:
      'No. There is no analytics dependency, no crash reporter and no update ping. The only host it talks to is the SVN server you configured. Grep the source, or watch it with a proxy.',
  },
  {
    question: 'Will it convert or migrate my repository?',
    answer:
      'It cannot. There is no import step and no sidecar database — it writes standard working copies and nothing else. If you dislike it, the rollback plan is deleting the app.',
  },
  {
    question: 'How big a repository can it handle?',
    answer:
      'Sparse checkout is the answer to size rather than raw throughput: pick a depth and take the part of the tree you work on. Performance on very large working copies — the 100,000-file case — is the stated theme of 1.4.0, so today it is honest to call that untested at the top end.',
  },
  {
    question: 'Is there a CLI?',
    answer:
      'Yes. The repository ships a CLI and a standalone logic engine compiled with Bun, so scripting and CI do not have to go through the window.',
  },
  {
    question: 'What happens to my data?',
    answer:
      'It stays on your disk and on your server. There is no cloud component, no account and nowhere for it to go.',
  },
  {
    question: 'How do I report something?',
    answer:
      'GitHub issues. Filed issues flow into the roadmap directly — there is no separate support queue, and no support contract either, which is worth weighing if you need one.',
  },
];
