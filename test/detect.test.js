import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardFromUrl, boardsInHtml, resolveEntry, tokenVariants } from '../src/detect.js';
import { HttpError } from '../src/http.js';

const html = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('boardFromUrl: ATS board, embed and API URLs', () => {
    const cases = {
        'https://boards.greenhouse.io/stripe': { ats: 'greenhouse', token: 'stripe' },
        'https://job-boards.greenhouse.io/reddit/jobs/8275952': { ats: 'greenhouse', token: 'reddit' },
        'https://boards.greenhouse.io/embed/job_board/js?for=figma': { ats: 'greenhouse', token: 'figma' },
        'https://boards-api.greenhouse.io/v1/boards/discord/jobs': { ats: 'greenhouse', token: 'discord' },
        'https://jobs.lever.co/palantir/61eaa54c-e1b7-4064-afad-f7df3d48d652': { ats: 'lever', token: 'palantir' },
        'https://jobs.eu.lever.co/leverdemo': { ats: 'lever', token: 'leverdemo', eu: true },
        'https://api.lever.co/v0/postings/zoox?mode=json': { ats: 'lever', token: 'zoox' },
        'https://jobs.ashbyhq.com/notion/05e14247-17c4-4e98-9a13-53828a4e2f13': { ats: 'ashby', token: 'notion' },
        'https://jobs.ashbyhq.com/linear/embed?version=2': { ats: 'ashby', token: 'linear' },
        'https://apply.workable.com/huggingface/': { ats: 'workable', token: 'huggingface' },
        'https://apply.workable.com/api/v1/widget/accounts/huggingface?details=true': { ats: 'workable', token: 'huggingface' },
        'https://www.workable.com/api/accounts/blueground': { ats: 'workable', token: 'blueground' },
        'https://epignosis.workable.com/jobs/6210600': { ats: 'workable', token: 'epignosis' },
        '//jobs.lever.co/spotify': { ats: 'lever', token: 'spotify' },
    };
    for (const [url, expected] of Object.entries(cases)) assert.deepEqual(boardFromUrl(url), expected, url);
});

test('boardFromUrl: non-board URLs are rejected', () => {
    for (const url of ['https://apply.workable.com/j/81B46579FE', 'https://www.workable.com/', 'https://help.workable.com/x',
        'https://careers.smartrecruiters.com/Wix2', 'https://boards.greenhouse.io/', 'https://example.com/careers', 'not a url']) {
        assert.equal(boardFromUrl(url), null, url);
    }
});

test('board tokens: Greenhouse and Ashby ignore case, so the token is lower-cased; Lever and Workable keep it', () => {
    assert.deepEqual(boardFromUrl('https://boards.greenhouse.io/Discord'), { ats: 'greenhouse', token: 'discord' });
    assert.deepEqual(boardFromUrl('https://jobs.ashbyhq.com/PineCone'), { ats: 'ashby', token: 'pinecone' });
    assert.deepEqual(boardFromUrl('https://jobs.lever.co/Palantir'), { ats: 'lever', token: 'Palantir' });
    assert.deepEqual(boardFromUrl('https://apply.workable.com/HuggingFace'), { ats: 'workable', token: 'HuggingFace' });
});

test('malformed percent-escapes in a URL do not throw', () => {
    assert.equal(boardFromUrl('https://www.example.fr/carri%E8res'), null);
    assert.equal(boardFromUrl('https://jobs.ashbyhq.com/%s/embed'), null);
    const page = '<a href="https://jobs.ashbyhq.com/%s/embed">x</a><a href="https://jobs.lever.co/acme">y</a>';
    assert.deepEqual(boardsInHtml(page), [{ ats: 'lever', token: 'acme' }]);
});

test('boardsInHtml: recorded careers pages', () => {
    assert.deepEqual(boardsInHtml(html('careers-figma.html')), [{ ats: 'greenhouse', token: 'figma' }]);
    assert.deepEqual(boardsInHtml(html('careers-palantir.html')), [{ ats: 'lever', token: 'palantir' }]);
    assert.deepEqual(boardsInHtml(html('careers-epignosis.html')), [{ ats: 'workable', token: 'epignosis' }]);
});

test('boardsInHtml: script embeds and JSON-escaped URLs', () => {
    const page = '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>'
        + '{"u":"https:\\/\\/jobs.ashbyhq.com\\/acme2\\/embed"}';
    assert.deepEqual(boardsInHtml(page), [{ ats: 'greenhouse', token: 'acme' }, { ats: 'ashby', token: 'acme2' }]);
});

test('tokenVariants', () => {
    assert.deepEqual(tokenVariants('Hugging Face'), ['huggingface', 'hugging-face']);
    assert.deepEqual(tokenVariants('BoschGroup'), ['BoschGroup', 'boschgroup']);
});

test('resolveEntry: explicit ats:token and ATS URL need no requests', async () => {
    const get = async () => assert.fail('no request expected');
    assert.deepEqual(await resolveEntry('greenhouse:stripe', { get }), { boards: [{ ats: 'greenhouse', token: 'stripe' }] });
    assert.deepEqual(await resolveEntry(' jobs.lever.co/palantir ', { get }), { boards: [{ ats: 'lever', token: 'palantir' }] });
    // one Ashby board in two spellings resolves to the same board
    assert.deepEqual(await resolveEntry('ashby:PineCone', { get }), { boards: [{ ats: 'ashby', token: 'pinecone' }] });
    assert.deepEqual(await resolveEntry('https://jobs.ashbyhq.com/pinecone', { get }), { boards: [{ ats: 'ashby', token: 'pinecone' }] });
});

test('resolveEntry: careers page is fetched once and scanned', async () => {
    const urls = [];
    const get = async (url) => {
        urls.push(url);
        return { url, body: html('careers-figma.html') };
    };
    assert.deepEqual(await resolveEntry('https://www.figma.com/careers/', { get }), { boards: [{ ats: 'greenhouse', token: 'figma' }] });
    assert.deepEqual(urls, ['https://www.figma.com/careers/']);
});

test('resolveEntry: careers page that redirects to an ATS board', async () => {
    const get = async () => ({ url: 'https://jobs.lever.co/acme', body: '<html></html>' });
    assert.deepEqual(await resolveEntry('https://acme.example/careers', { get }), { boards: [{ ats: 'lever', token: 'acme' }] });
});

test('resolveEntry: page without an ATS link reports an error', async () => {
    const get = async (url) => ({ url, body: '<a href="https://example.com/jobs/1">job</a>' });
    const r = await resolveEntry('https://example.com/careers', { get });
    assert.match(r.error, /No Greenhouse, Lever, Ashby or Workable board/);
});

test('resolveEntry: bare name probes every ATS and keeps the board with most jobs', async () => {
    const ashby = JSON.parse(html('ashby-linear.json'));
    const get = async (url) => {
        if (url === 'https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true') return { url, body: ashby };
        throw new HttpError(404, url);
    };
    const r = await resolveEntry('Linear', { get, includeDescription: false });
    assert.equal(r.boards.length, 1);
    assert.equal(r.boards[0].ats, 'ashby');
    assert.equal(r.boards[0].token, 'linear');
    assert.equal(r.boards[0].jobs.length, 2); // jobs reused, not fetched again
    assert.equal(r.boards[0].jobs[0].company, 'Linear');
    assert.equal(r.boards[0].resolvedBy, 'name-probe');
});

test('resolveEntry: a capitalised bare name probes each case-insensitive ATS once', async () => {
    const urls = [];
    const get = async (url) => {
        urls.push(url);
        throw new HttpError(404, url);
    };
    await resolveEntry('Discord', { get, includeDescription: false });
    assert.deepEqual(urls.sort(), [
        'https://api.ashbyhq.com/posting-api/job-board/discord?includeCompensation=true',
        'https://api.lever.co/v0/postings/Discord?mode=json',
        'https://api.lever.co/v0/postings/discord?mode=json',
        'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true',
        'https://www.workable.com/api/accounts/Discord?details=false',
        'https://www.workable.com/api/accounts/discord?details=false',
    ]);
});

test('resolveEntry: bare name found nowhere reports an error', async () => {
    const get = async (url) => {
        throw new HttpError(404, url);
    };
    const r = await resolveEntry('No Such Company', { get, includeDescription: false });
    assert.match(r.error, /nosuchcompany, no-such-company/);
});
