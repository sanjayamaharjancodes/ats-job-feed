// Example: print the jobs that are new since the last time this script ran.
// It keeps the ids it has seen in a local JSON file. Usage: node examples/new-jobs.js greenhouse:discord lever:metabase
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fetchJobs } from '../src/index.js';

const STATE_FILE = 'seen-jobs.json';
const companies = process.argv.slice(2);
if (!companies.length) {
    console.error('Usage: node examples/new-jobs.js <company> [<company> ...]');
    process.exit(2);
}

const seen = new Set(existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : []);
const { jobs, boards } = await fetchJobs(companies, { includeDescription: false });

const fresh = jobs.filter((j) => !seen.has(j.id));
for (const j of fresh) console.log(`${j.company} | ${j.title} | ${j.location ?? ''} | ${j.jobUrl}`);

// Keep the ids of boards that failed this time, so a temporary error does not make their jobs look new later.
const failed = new Set(boards.filter((b) => b.status === 'failed' && b.boardToken).map((b) => `${b.ats}:${b.boardToken}:`));
const kept = [...seen].filter((id) => [...failed].some((prefix) => id.startsWith(prefix)));
writeFileSync(STATE_FILE, JSON.stringify([...new Set([...kept, ...jobs.map((j) => j.id)])]));

console.error(`${fresh.length} new of ${jobs.length} open jobs.`);
