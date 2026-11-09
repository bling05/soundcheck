import type { Lesson, RealCase } from '../types';

const OWASP = ['A08:2021 Software and Data Integrity Failures'];
const CWE = ['CWE-1357', 'CWE-829'];

const WHY_AI_TOOLS_PRODUCE_IT =
  "AI tools predict package names that sound right, and sometimes the package doesn't exist. They tend to invent the same names again and again, so attackers can guess them, publish packages under those names, and wait for someone to install them. This is called slopsquatting.";

const HUGGINGFACE_CLI: RealCase = {
  summary:
    "In 2024, a researcher at Lasso Security noticed AI models kept recommending a Python package called huggingface-cli that didn't exist. The researcher published an empty package under that name as a test, and it was downloaded more than 15,000 times in three months. Alibaba's instructions for one of its projects told people to install it.",
  source: 'The Register',
  url: 'https://www.theregister.com/2024/03/28/ai_bots_hallucinate_software_packages/',
};

export const SLOPSQUATTING_LESSONS = {
  'slopsquatting:missing-package': {
    whatItIs:
      "Your project lists a package that doesn't exist on the public registry. If an AI tool made the name up, anyone can publish a package with that name, and the next time you or your hosting runs the install, it downloads their code and runs it. If it's a private package from your own company's registry, this is expected.",
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited:
      'An attacker publishes a package under the made-up name with code that runs during install. It can read your keys and passwords, send them away, or change your code. Installing is all it takes: nobody has to import it.',
    realCase: HUGGINGFACE_CLI,
    owasp: OWASP,
    cwe: CWE,
  },
  'slopsquatting:malware-package': {
    whatItIs:
      "Your project uses a package that's known malware. Either npm took it down and left a harmless placeholder under the name, or it's listed in OSV.dev, a public database of malicious packages, and may still be up for anyone to install. Any copy that was installed ran the malware.",
    whyAiToolsProduceIt:
      'Malware packages often have names one letter away from popular ones, like crossenv instead of cross-env. AI tools and people both make that kind of slip, and AI tools sometimes suggest names attackers have already claimed.',
    howItIsExploited:
      'The malware runs as soon as the package is installed. It usually looks for keys, passwords, and tokens on the computer or build server and sends them to the attacker.',
    realCase: {
      summary:
        'In 2017, npm found a package called crossenv, named to look like the popular cross-env, that sent the settings of every computer that installed it, including any passwords and keys, to its author. npm removed it and about 40 others from the same author.',
      source: 'npm',
      url: 'https://blog.npmjs.org/post/163723642530/crossenv-malware-on-the-npm-registry',
    },
    owasp: OWASP,
    cwe: ['CWE-506', 'CWE-1357'],
  },
  'slopsquatting:new-package': {
    whatItIs:
      "Your project lists a package that was published only recently and that hardly anyone downloads. Most new packages are fine, but this is also exactly what a package published under a made-up name looks like, so it's worth a look.",
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited:
      "Attackers publish packages under names AI tools tend to invent, then wait. Code in the package runs when it's installed and can steal keys and passwords from the computer or build server.",
    realCase: HUGGINGFACE_CLI,
    owasp: OWASP,
    cwe: CWE,
  },
  'slopsquatting:lookalike-package': {
    whatItIs:
      "Your project uses a package whose name is one typo away from a popular package, and hardly anyone downloads it. It may be a harmless small package, or it may be a fake that copies a popular name so people install it by mistake. That's called typosquatting.",
    whyAiToolsProduceIt:
      'AI tools write package names from memory, and a name that is almost right looks right. People make the same slips when typing install commands, which is exactly what typosquatters count on.',
    howItIsExploited:
      'An attacker publishes a package with a name like the popular one, often copying its description so it looks real, and adds code that runs when it is installed. That code usually steals keys and passwords from the computer or build server.',
    realCase: {
      summary:
        'In 2017, npm found a package called crossenv, named to look like the popular cross-env, that sent the settings of every computer that installed it, including any passwords and keys, to its author. npm removed it and about 40 others from the same author.',
      source: 'npm',
      url: 'https://blog.npmjs.org/post/163723642530/crossenv-malware-on-the-npm-registry',
    },
    owasp: OWASP,
    cwe: ['CWE-1357', 'CWE-829'],
  },
} satisfies Record<`slopsquatting:${string}`, Lesson>;
