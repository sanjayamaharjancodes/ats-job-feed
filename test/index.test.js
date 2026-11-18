import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchJobs, jobFilter } from '../src/index.js';
import { HttpError } from '../src/http.js';
import { main, toCsv } from '../bin/ats-job-feed.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const GH = 'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true';
const WK = 'https://www.workable.com/api/accounts/huggingface?details=false';
const ASHBY = 'https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true';

const fakeGet = (routes) => async (url) => {
    if (!(url in routes)) throw new HttpError(404, url);
    return { url, body: routes[url] };
};
const routes = () => ({
    [GH]: fixture('greenhouse-discord.json'),
    [WK]: fixture('workable-huggingface.json'),
    [ASHBY]: fixture('ashby-linear.json'),
});

test('fetchJobs: reads several ATSs into one list with unique ids and a row per entry', async () => {
    const { jobs, boards } = await fetchJobs(['greenhouse:discord', 'workable:huggingface', 'ashby:linear'],
        { get: fakeGet(routes()), includeDescription: false });
    assert.equal(boards.length, 3);
    assert.ok(boards.every((b) => b.status === 'ok'));
    assert.equal(jobs.length, boards.reduce((n, b) => n + b.jobsFound, 0));
    assert.equal(new Set(jobs.map((j) => j.id)).size, jobs.length);
    assert.deepEqual([...new Set(jobs.map((j) => j.ats))].sort(), ['ashby', 'greenhouse', 'workable']);
    assert.ok(jobs.every((j) => j.description === null));
});

test('fetchJobs: a failing board is reported and does not stop the others', async () => {
    const { jobs, boards } = await fetchJobs(['lever:nosuchboard12345', 'greenhouse:discord'], { get: fakeGet(routes()) });
    const failed = boards.find((b) => b.input === 'lever:nosuchboard12345');
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /HTTP 404/);
    assert.equal(boards.find((b) => b.input === 'greenhouse:discord').status, 'ok');
    assert.equal(jobs.length, 2);
});

test('fetchJobs: the same board entered twice is read once (Greenhouse ignores case)', async () => {
    let hits = 0;
    const get = async (url) => {
        hits++;
        return fakeGet(routes())(url);
    };
    const { jobs, boards } = await fetchJobs(['greenhouse:discord', 'https://boards.greenhouse.io/Discord'], { get });
    assert.equal(hits, 1);
    assert.equal(jobs.length, 2);
    assert.deepEqual(boards.map((b) => b.status).sort(), ['ok', 'skipped']);
});

test('fetchJobs: filters are applied and jobsFound counts only matching jobs', async () => {
    const all = await fetchJobs(['greenhouse:discord'], { get: fakeGet(routes()) });
    const title = all.jobs[0].title;
    const some = await fetchJobs(['greenhouse:discord'], { get: fakeGet(routes()), titleKeywords: [title.toUpperCase()] });
    assert.ok(some.jobs.length >= 1 && some.jobs.length <= all.jobs.length);
    assert.ok(some.jobs.every((j) => j.title.toLowerCase().includes(title.toLowerCase())));
    assert.equal(some.boards[0].jobsFound, some.jobs.length);
    const none = await fetchJobs(['greenhouse:discord'], { get: fakeGet(routes()), titleKeywords: ['no such title zzz'] });
    assert.equal(none.jobs.length, 0);
    assert.equal(none.boards[0].status, 'ok');
});

test('fetchJobs: a bare name is probed on every ATS and flagged as a guess', async () => {
    const { jobs, boards } = await fetchJobs(['Discord'], { get: fakeGet(routes()) });
    assert.equal(jobs.length, 2);
    assert.equal(boards[0].resolvedBy, 'name-probe');
    assert.equal(boards[0].atsCompanyName, 'Discord');
});

test('fetchJobs: empty and non-string entries are ignored; a non-array is rejected', async () => {
    const { jobs, boards } = await fetchJobs(['', '   ', null, 42], { get: fakeGet(routes()) });
    assert.deepEqual([jobs, boards], [[], []]);
    await assert.rejects(fetchJobs('greenhouse:discord'), TypeError);
});

test('fetchJobs: onBoard is called once per report row', async () => {
    const seen = [];
    const { boards } = await fetchJobs(['greenhouse:discord', 'lever:nosuchboard12345'], { get: fakeGet(routes()), onBoard: (b) => seen.push(b) });
    assert.equal(seen.length, boards.length);
});

test('jobFilter: remote, location and posting-date filters', () => {
    const now = Date.parse('2026-11-18T00:00:00Z');
    const job = { title: 'Data Engineer', location: 'Berlin; Remote', remote: true, postedAt: '2026-11-10T00:00:00.000Z' };
    assert.ok(jobFilter({}, now)(job));
    assert.ok(jobFilter({ remoteOnly: true, locationKeywords: ['berlin'], postedWithinDays: 10 }, now)(job));
    assert.ok(!jobFilter({ postedWithinDays: 5 }, now)(job));
    assert.ok(!jobFilter({ remoteOnly: true }, now)({ ...job, remote: false }));
    assert.ok(!jobFilter({ postedWithinDays: 30 }, now)({ ...job, postedAt: null })); // undated jobs are left out
});

test('toCsv: quotes commas, quotes and line breaks', () => {
    const csv = toCsv([{ id: 'a:b:1', title: 'Engineer, "Data"', description: 'line 1\nline 2', remote: false, salary: null }]);
    const [header, ...rest] = csv.split('\r\n');
    assert.ok(header.startsWith('id,ats,boardToken,company,title'));
    assert.match(rest.join('\r\n'), /"Engineer, ""Data"""/);
    assert.match(rest.join('\r\n'), /"line 1\nline 2"/);
});

function capture() {
    const chunks = [];
    return { write: (s) => chunks.push(s), text: () => chunks.join('') };
}

test('cli: prints JSON jobs to stdout and the board report to stderr', async () => {
    const out = capture();
    const err = capture();
    const fetchJobsFn = (companies, opts) => fetchJobs(companies, { ...opts, get: fakeGet(routes()) });
    const code = await main(['--no-description', 'greenhouse:discord'], { out, err, fetchJobsFn });
    assert.equal(code, 0);
    const jobs = JSON.parse(out.text());
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].description, null);
    assert.match(err.text(), /ok\s+greenhouse:discord\s+2 jobs/);
    assert.match(err.text(), /2 jobs from 1 of 1 entries/);
});

test('cli: exit code 1 when every board failed, 2 on bad usage', async () => {
    const fetchJobsFn = (companies, opts) => fetchJobs(companies, { ...opts, get: fakeGet({}) });
    assert.equal(await main(['lever:nosuchboard12345'], { out: capture(), err: capture(), fetchJobsFn }), 1);
    assert.equal(await main([], { out: capture(), err: capture(), fetchJobsFn }), 2);
    assert.equal(await main(['--format', 'xml', 'greenhouse:discord'], { out: capture(), err: capture(), fetchJobsFn }), 2);
    assert.equal(await main(['--days', '0', 'greenhouse:discord'], { out: capture(), err: capture(), fetchJobsFn }), 2);
});

test('cli: ndjson writes one job per line', async () => {
    const out = capture();
    const fetchJobsFn = (companies, opts) => fetchJobs(companies, { ...opts, get: fakeGet(routes()) });
    await main(['--format', 'ndjson', 'greenhouse:discord'], { out, err: capture(), fetchJobsFn });
    const lines = out.text().trim().split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines.every((l) => JSON.parse(l).id.startsWith('greenhouse:discord:')));
});
