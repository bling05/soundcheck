import type { Lesson } from '../types';

export const LIVE_PROBES_LESSONS = {
  'live-probes:reflected-xss': {
    whatItIs:
      "Your page takes text from its address, like a search term, and puts it into the page as HTML instead of plain text. That means anyone can build a link to your site with their own code in it, and it runs in the browser of whoever opens the link, as if your site wrote it. It's called cross-site scripting, or XSS.",
    whyAiToolsProduceIt:
      'Frameworks like React escape text automatically, but AI tools reach for dangerouslySetInnerHTML, innerHTML, or raw template output when they want formatting, like highlighting the search term, and that skips the protection.',
    howItIsExploited:
      "Someone sends a victim a link to your site with a script hidden in it. When the victim opens it, the script runs as your site: it can read what's on the page, act as the signed-in user, or show a fake login form.",
    realCase: {
      summary:
        'In 2019, Check Point researchers found an XSS flaw on an old Epic Games page. Combined with another flaw, it meant a Fortnite player who clicked a link could have their account taken over.',
      source: 'Check Point Research',
      url: 'https://research.checkpoint.com/2019/hacking-fortnite/',
    },
    owasp: ['A03:2021 Injection'],
    cwe: ['CWE-79'],
  },
  'live-probes:sql-error': {
    whatItIs:
      "When we added a quote mark to one of your page's parameters, the page showed a database error. That usually means the text is pasted straight into a database query, so a visitor's text can change the query itself. It's the classic sign of SQL injection.",
    whyAiToolsProduceIt:
      'Joining strings is the quickest way to write a query that works, and AI tools sometimes do it, especially in raw SQL or when adding a search or sort feature. Showing the raw error also makes debugging easier, so it gets left on.',
    howItIsExploited:
      'Attackers send carefully written text in the parameter to make your database run their own query, and use it to read tables they should never see, like users and passwords, or to change data. Tools that do this automatically are free and widely used.',
    realCase: {
      summary:
        "In 2015, attackers used SQL injection on old TalkTalk web pages to take data from 156,959 customer accounts, including bank details. The UK's privacy regulator fined TalkTalk £400,000.",
      source: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/2015_TalkTalk_data_breach',
    },
    owasp: ['A03:2021 Injection'],
    cwe: ['CWE-89', 'CWE-209'],
  },
  'live-probes:path-traversal': {
    whatItIs:
      'One of your pages reads a file named in its address. By adding "../" to the name, we got it to return one of the server\'s own system files instead. That means anyone can read any file the server can, which often includes settings files with passwords and keys. It\'s called path traversal.',
    whyAiToolsProduceIt:
      'Serving a file by name from a parameter is a quick way to build downloads or page templates, and it works in every normal test. Checking that the name stays inside one folder is an extra step that is easy to leave out.',
    howItIsExploited:
      'Attackers ask for files like your .env or config files with "../" paths and collect the passwords and keys inside, then use them to get into your database, cloud account, or other services.',
    realCase: {
      summary:
        'In 2021, Fortinet warned that an attacker had published VPN login details for 87,000 of its devices, collected through an old flaw (CVE-2018-13379) on devices that were never updated.',
      source: 'Fortinet',
      url: 'https://www.fortinet.com/blog/psirt-blogs/malicious-actor-discloses-fortigate-ssl-vpn-credentials',
    },
    owasp: ['A01:2021 Broken Access Control'],
    cwe: ['CWE-22'],
  },
  'live-probes:open-api': {
    whatItIs:
      "One of your API addresses returns a list of people, with details like email addresses, to anyone who asks. No sign-in is needed. Your app's pages may hide it, but anyone can call the address directly.",
    whyAiToolsProduceIt:
      'AI tools often build an API route to feed an admin page or a list, and protect the page instead of the route. The page asks you to sign in, so it looks protected, but the data comes from an address anyone can open.',
    howItIsExploited:
      "Someone notices the address in your site's network requests, or simply tries common ones like /api/users, and downloads the whole list. It takes seconds and no special tools.",
    realCase: {
      summary:
        "In 2022, an attacker pulled Optus customers' personal details from an Optus API. Australia's communications regulator alleges a coding error had left the API's access controls open to bypass.",
      source: 'iTnews',
      url: 'https://www.itnews.com.au/news/optus-breach-allegedly-enabled-by-access-control-coding-error-608985',
    },
    owasp: ['A01:2021 Broken Access Control'],
    cwe: ['CWE-306', 'CWE-200'],
  },
  'live-probes:open-signup': {
    whatItIs:
      'Your Supabase project lets anyone create an account, and the account works right away, without confirming an email address. That\'s fine for many apps, but it means a rule that allows "any signed-in user" really allows anyone.',
    whyAiToolsProduceIt:
      'Turning off email confirmation makes testing faster, and AI tools and tutorials often suggest it. It tends to stay off when the app goes live.',
    howItIsExploited:
      'Someone signs up with a made-up email, then uses the account to read or change anything your rules allow signed-in users to. They can also create accounts in bulk to spam or abuse free features.',
    owasp: ['A07:2021 Identification and Authentication Failures'],
    cwe: ['CWE-287'],
  },
} satisfies Record<`live-probes:${string}`, Lesson>;
