#!/usr/bin/env node
// Command line: ats-job-feed [options] <company> [<company> ...]
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fetchJobs } from '../src/index.js';

const HELP = `ats-job-feed: open jobs from Greenhouse, Lever, Ashby and Workable job boards, in one schema.

Usage:
  ats-job-feed [options] <company> [<company> ...]

A company is an ATS board URL (https://jobs.lever.co/metabase), an ats:token pair (greenhouse:discord),
a careers-page URL (https://www.figma.com/careers/) or a bare company name ("Hugging Face").

Options:
  -f, --file <path>        read companies from a file, one per line (lines starting with # are skipped)
      --format <fmt>       json (default), ndjson or csv
      --no-description     leave out job descriptions (smaller and faster)
      --title <words>      keep jobs whose title contains any of these comma-separated words
      --location <words>   keep jobs whose location contains any of these comma-separated words
      --remote             keep remote jobs only
      --days <n>           keep jobs posted in the last n days
  -h, --help               show this help

Jobs go to standard output. The per-board report goes to standard error.
The exit code is 1 when every board failed, otherwise 0.`;

const CSV_FIELDS = ['id', 'ats', 'boardToken', 'company', 'title', 'location', 'remote', 'department', 'employmentType',
    'salary', 'postedAt', 'updatedAt', 'jobUrl', 'applyUrl', 'description'];

export function toCsv(jobs) {
    const cell = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [CSV_FIELDS.join(','), ...jobs.map((j) => CSV_FIELDS.map((f) => cell(j[f])).join(','))].join('\r\n');
}

const list = (s) => (s ? s.split(',').map((w) => w.trim()).filter(Boolean) : []);

export async function main(argv, { out = process.stdout, err = process.stderr, fetchJobsFn = fetchJobs } = {}) {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                file: { type: 'string', short: 'f' },
                format: { type: 'string', default: 'json' },
                'no-description': { type: 'boolean', default: false },
                title: { type: 'string' },
                location: { type: 'string' },
                remote: { type: 'boolean', default: false },
                days: { type: 'string' },
                help: { type: 'boolean', short: 'h', default: false },
            },
        });
    } catch (e) {
        err.write(`${e.message}\n\n${HELP}\n`);
        return 2;
    }
    const { values, positionals } = parsed;
    if (values.help) {
        out.write(`${HELP}\n`);
        return 0;
    }
    if (!['json', 'ndjson', 'csv'].includes(values.format)) {
        err.write(`Unknown format "${values.format}". Use json, ndjson or csv.\n`);
        return 2;
    }
    const days = values.days === undefined ? undefined : Number(values.days);
    if (days !== undefined && !(days > 0)) {
        err.write('--days needs a number above 0.\n');
        return 2;
    }
    const companies = [...positionals];
    if (values.file) {
        const lines = readFileSync(values.file, 'utf8').split(/\r?\n/).map((l) => l.trim());
        companies.push(...lines.filter((l) => l && !l.startsWith('#')));
    }
    if (!companies.length) {
        err.write(`Give at least one company.\n\n${HELP}\n`);
        return 2;
    }

    const { jobs, boards } = await fetchJobsFn(companies, {
        includeDescription: !values['no-description'],
        titleKeywords: list(values.title),
        locationKeywords: list(values.location),
        remoteOnly: values.remote,
        postedWithinDays: days,
        onBoard: (b) => err.write(b.status === 'ok'
            ? `ok       ${b.ats}:${b.boardToken}  ${b.jobsFound} jobs${b.resolvedBy ? `  (guessed from "${b.input}"; ATS company name: ${b.atsCompanyName ?? 'not published'})` : ''}\n`
            : `${b.status.padEnd(8)} ${b.input}  ${b.error}\n`),
    });

    if (values.format === 'csv') out.write(`${toCsv(jobs)}\r\n`);
    else if (values.format === 'ndjson') out.write(jobs.map((j) => `${JSON.stringify(j)}\n`).join(''));
    else out.write(`${JSON.stringify(jobs, null, 2)}\n`);

    const ok = boards.filter((b) => b.status === 'ok').length;
    err.write(`${jobs.length} jobs from ${ok} of ${boards.length} entries.\n`);
    return ok === 0 ? 1 : 0;
}

// Run only when started as a program (also through an npm bin link), not when imported by the tests.
const startedAsProgram = () => {
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
};
if (startedAsProgram()) process.exitCode = await main(process.argv.slice(2));
