# ats-job-feed

Open jobs from **Greenhouse, Lever, Ashby and Workable** job boards, in one schema.

Many companies publish their open jobs through their applicant tracking system (ATS). Each of these four ATSs serves
a company's postings from a public job-board API, the same one embedded careers pages read. `ats-job-feed` reads those
APIs and returns one object per job with the same fields for every ATS: title, company, location, remote flag,
department, employment type, salary where published, dates, links and a plain-text description.

- Node.js 20 or later. No dependencies.
- No login, API key, browser or proxy.
- A library and a command-line tool.
- MIT licence.

*Not affiliated with or endorsed by Greenhouse, Lever, Ashby or Workable.*

## Install

```bash
git clone https://github.com/sanjayamaharjancodes/ats-job-feed.git
cd ats-job-feed
```

There is nothing else to install. To use it as a library in another project:

```bash
npm install github:sanjayamaharjancodes/ats-job-feed
```

The package is not published on the npm registry, so install it from GitHub as shown.

## Command line

Run these from the cloned folder:

```bash
# Three companies, three ways to name them
node bin/ats-job-feed.js greenhouse:discord https://jobs.lever.co/metabase "Hugging Face"

# Remote engineering jobs posted in the last 14 days, as CSV
node bin/ats-job-feed.js --remote --title engineer --days 14 --format csv -f companies.txt > jobs.csv
```

Jobs go to standard output as JSON (`--format json`, the default), one JSON object per line (`ndjson`) or CSV.
A one-line report per company goes to standard error:

```text
ok       greenhouse:discord  26 jobs
ok       lever:metabase  9 jobs
failed   lever:nosuchboard12345  HTTP 404 for https://api.lever.co/v0/postings/nosuchboard12345?mode=json
35 jobs from 2 of 3 entries.
```

Run `node bin/ats-job-feed.js --help` for every option.

## Library

```js
import { fetchJobs } from 'ats-job-feed';

const { jobs, boards } = await fetchJobs(
    ['greenhouse:discord', 'https://jobs.ashbyhq.com/linear', 'https://www.figma.com/careers/'],
    { titleKeywords: ['engineer'], remoteOnly: false, includeDescription: true },
);

console.log(jobs.length, jobs[0]);
console.log(boards); // one report row per entry: status, jobsFound, error
```

| Option | Default | What it does |
|---|---|---|
| `includeDescription` | `true` | Adds the plain-text job description. Turn it off for smaller, faster output. |
| `titleKeywords` | `[]` | Keep jobs whose title contains at least one of these words (not case-sensitive). |
| `locationKeywords` | `[]` | Keep jobs whose location contains at least one of these words. |
| `remoteOnly` | `false` | Keep only jobs marked remote. |
| `postedWithinDays` | none | Keep jobs posted in the last N days. Jobs without a posting date are left out. |
| `get` | built-in client | Your own `get(url, options)` function, for tests or a custom HTTP client. |
| `onBoard` | none | Called with each report row as soon as its board is done. |

A board that fails (for example a wrong name) is reported in `boards` with `status: "failed"`. The others carry on.

## How to name a company

| Form | Example | Notes |
|---|---|---|
| ATS board URL | `https://jobs.lever.co/palantir` | No detection requests are needed. |
| `ats:token` | `greenhouse:stripe` | The fastest and most precise form. |
| Careers-page URL | `https://www.figma.com/careers/` | The page is loaded once and searched for a link to, or an embed of, one of the four ATSs. A redirect to an ATS board is followed. |
| Bare name | `Hugging Face` | The name is tried on all four ATSs (`huggingface`, `hugging-face`) and the board with the most open jobs wins. This is a guess: the report row carries `resolvedBy: "name-probe"` and the company name the ATS publishes. |

| ATS | Board URL forms recognised | Explicit form |
|---|---|---|
| Greenhouse | `boards.greenhouse.io/{token}`, `job-boards.greenhouse.io/{token}`, the embed script | `greenhouse:{token}` |
| Lever | `jobs.lever.co/{site}`, EU accounts `jobs.eu.lever.co/{site}` | `lever:{site}` (US accounts) |
| Ashby | `jobs.ashbyhq.com/{name}` | `ashby:{name}` |
| Workable | `apply.workable.com/{account}`, `{account}.workable.com` | `workable:{account}` |

Greenhouse and Ashby ignore letter case in board names, so `ashby:PineCone` and `jobs.ashbyhq.com/pinecone` are one
board and are read once. Lever and Workable names are case-sensitive and are used as given.

## Output

One object per job. A Greenhouse job (description shortened):

```json
{
    "id": "greenhouse:discord:8917177002",
    "ats": "greenhouse",
    "boardToken": "discord",
    "company": "Discord",
    "title": "Associate Commercial Counsel",
    "location": "San Francisco Bay Area or Remote (U.S.)",
    "remote": true,
    "department": "Legal",
    "employmentType": null,
    "salary": null,
    "postedAt": "2026-11-03T16:27:16.000Z",
    "updatedAt": "2026-11-03T16:31:51.000Z",
    "jobUrl": "https://job-boards.greenhouse.io/discord/jobs/8917177002",
    "applyUrl": "https://job-boards.greenhouse.io/discord/jobs/8917177002",
    "description": "Discord has a highly engaged community of millions of daily active users ..."
}
```

| Field | Notes |
|---|---|
| `id` | `ats:boardToken:atsJobId`. The same job keeps the same id from run to run, so you can compare two runs to find new and closed jobs. |
| `company` | As published by the ATS. Lever and Ashby publish none, so it is the name you entered, or the board token. |
| `location` | Several locations are joined with `; `. Workable lists a job once per location; the entries are merged into one job. |
| `remote` | Lever, Ashby and Workable publish a workplace or remote field; hybrid counts as not remote. Greenhouse has no such field, so it is `true` when the location text contains the word "remote". |
| `employmentType` | For example `Full-time`. Greenhouse does not publish it, so it is `null` there. |
| `salary` | A display string, where published: Lever's salary range (`CAD 35-38 per-hour-wage`) or Ashby's compensation summary (`$240K - $320K`). Otherwise `null`. |
| `postedAt` | ISO 8601: Greenhouse first published, Lever created, Ashby published, Workable published (a date only). |
| `updatedAt` | Greenhouse only. |
| `description` | Plain text with line breaks and `- ` bullets. `null` when descriptions are off. |

The library outputs no recruiter or hiring-manager names, emails or phone numbers as fields. Descriptions are passed
through as the employer wrote them.

## The four endpoints

| ATS | One GET per company board | Vendor documentation |
|---|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | <https://developers.greenhouse.io/job-board.html> |
| Lever | `https://api.lever.co/v0/postings/{site}?mode=json` (EU: `api.eu.lever.co`) | <https://github.com/lever/postings-api> |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true` | <https://developers.ashbyhq.com/docs/public-job-posting-api> |
| Workable | `https://www.workable.com/api/accounts/{account}?details=true` | <https://help.workable.com/hc/en-us/articles/115012771647> |

Each call returns the whole board, so every run downloads every open job of every company it checks.

## Politeness

These endpoints serve real careers pages, so the built-in client limits itself:

- at most 4 requests at a time to each host;
- a 60-second timeout per request;
- up to 4 retries on HTTP 429, 5xx and network errors, waiting for `Retry-After` when the server sends it (capped at
  60 seconds), otherwise 1, 2, 4 and 8 seconds, each plus up to 1 second of random jitter;
- a plain user agent, `ats-job-feed/0.1`.

Please keep these limits if you pass your own `get`.

## Hosted version

The same adapters run as a hosted, pay-per-use Actor on the Apify Store:
[Greenhouse, Lever, Ashby & Workable Jobs Scraper](https://apify.com/scaleturn/career-site-job-feed?utm_source=github&utm_medium=readme&utm_campaign=mk-launch).

| | This library | Hosted Actor |
|---|---|---|
| Reads the four ATSs into one schema | yes | yes |
| ATS detection from a URL or a company name | yes | yes |
| Title, location, remote and date filters | yes | yes |
| Runs on | your machine | Apify's platform |
| Only-new-jobs mode with saved state between runs | no (compare `id`s yourself) | yes |
| Closed-job notices | no | yes |
| Schedules, webhooks, integrations (Make, Zapier, n8n, Google Sheets), API, MCP server for AI agents | no | yes |
| Price | free | USD 2 per 1,000 jobs returned, USD 1 per 1,000 company boards checked, plus Apify's start fee |

Use the library when you want the code in your own pipeline. Use the Actor when you want a scheduled feed of new jobs
without running anything yourself.

## Limits

- **Only these four ATSs.** Workday, SmartRecruiters, iCIMS, Taleo, SuccessFactors, Teamtailor and others are not
  supported. Neither are LinkedIn, Indeed or other job sites.
- **It reads the companies you list.** It does not search all jobs on the web by keyword.
- **Careers-page detection reads one page as plain HTML.** If the page builds its job list with JavaScript from
  another source, nothing is found. Use the ATS board URL or `ats:token` instead.
- **Bare names are a best guess.** Another company can own the same name on a different ATS. Check the report row.
- **Lever EU accounts** are reached only through a `jobs.eu.lever.co` URL. Greenhouse boards hosted in its EU region
  are not covered.
- **Ashby postings marked unlisted** are left out, to match the public board.
- **The ATS APIs can change.** If a vendor changes or withdraws its public API, that adapter fails until it is updated.

How these public APIs behave at scale (dead boards, failures and rate limits per ATS, from a crawl of 30,928 board
addresses on 18-19 Nov 2026, with a CSV) is measured in the
[ATS job posting API crawl report](https://scrapetools.scaleturn.com/ats-job-posting-api-crawl-data.html?utm_source=github&utm_medium=readme&utm_campaign=rx-001).

## Tests

```bash
npm test
```

42 tests run against recorded responses from each ATS, with no network access: field mapping for every adapter,
Lever postings whose plain-text description is empty, Workable's per-location duplicates, board detection from URLs
and careers pages, letter case, filters, retries, timeouts, the per-host request limit and the command-line tool.

## Using the data

The library reads only the public job-board endpoints the ATS vendors publish for showing open jobs. How you use the
data is your responsibility: follow each vendor's terms and the laws that apply to you. This is not legal advice.

## About

Published by [MakeYeti](https://x.com/makeyeti), an independent product studio. The code was written with AI coding
agents and is checked by the test suite above. Issues and pull requests are welcome; see
[CONTRIBUTING.md](CONTRIBUTING.md).

Licence: [MIT](LICENSE).
