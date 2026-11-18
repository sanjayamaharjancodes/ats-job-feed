import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADAPTERS } from '../src/ats.js';
import { htmlToText } from '../src/html.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const fakeGet = (routes) => async (url) => {
    if (!(url in routes)) throw new Error(`unexpected URL ${url}`);
    return { url, body: routes[url] };
};
const FIELDS = ['id', 'ats', 'boardToken', 'company', 'title', 'location', 'remote', 'department', 'employmentType', 'salary', 'postedAt', 'updatedAt', 'jobUrl', 'applyUrl', 'description'];

test('greenhouse: maps recorded discord board', async () => {
    const get = fakeGet({ 'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true': fixture('greenhouse-discord.json') });
    const jobs = await ADAPTERS.greenhouse.fetchJobs({ ats: 'greenhouse', token: 'discord' }, { includeDescription: true }, get);
    assert.equal(jobs.length, 2);
    const j = jobs[0];
    assert.deepEqual(Object.keys(j), FIELDS);
    assert.match(j.id, /^greenhouse:discord:\d+$/);
    assert.equal(j.company, 'Discord');
    assert.equal(j.title, 'Associate Commercial Counsel');
    assert.ok(j.jobUrl.startsWith('https://'));
    assert.equal(j.applyUrl, j.jobUrl);
    assert.match(j.postedAt, /^\d{4}-\d\d-\d\dT/);
    assert.match(j.updatedAt, /^\d{4}-\d\d-\d\dT/);
    assert.ok(j.department);
    // entity-escaped HTML is decoded to plain text, no tags or entities left
    assert.match(j.description, /Commercial & Marketing Legal/);
    assert.doesNotMatch(j.description, /<[a-z]|&lt;|&amp;|&nbsp;/i);
});

test('company name is trimmed', async () => {
    const raw = fixture('greenhouse-discord.json');
    raw.jobs[0].company_name = 'General Assembly Remote Jobs ';
    const get = fakeGet({ 'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true': raw });
    const jobs = await ADAPTERS.greenhouse.fetchJobs({ ats: 'greenhouse', token: 'discord' }, { includeDescription: false }, get);
    assert.equal(jobs[0].company, 'General Assembly Remote Jobs');
});

test('greenhouse: descriptions off gives null description', async () => {
    const get = fakeGet({ 'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true': fixture('greenhouse-discord.json') });
    const jobs = await ADAPTERS.greenhouse.fetchJobs({ ats: 'greenhouse', token: 'discord' }, { includeDescription: false }, get);
    assert.ok(jobs.every((j) => j.description === null));
});

test('lever: maps recorded matchgroup postings incl. salary, workplace type and lists', async () => {
    const raw = fixture('lever-matchgroup.json');
    const get = fakeGet({ 'https://api.lever.co/v0/postings/matchgroup?mode=json': raw });
    const jobs = await ADAPTERS.lever.fetchJobs({ ats: 'lever', token: 'matchgroup' }, { includeDescription: true }, get);
    assert.equal(jobs.length, 2);
    const j = jobs[0];
    assert.deepEqual(Object.keys(j), FIELDS);
    assert.equal(j.id, `lever:matchgroup:${raw[0].id}`);
    assert.equal(j.company, 'matchgroup');
    assert.equal(j.employmentType, 'Internship');
    assert.equal(j.department, 'Match Group');
    assert.equal(j.location, 'Vancouver, British Columbia');
    assert.equal(j.remote, false); // workplaceType hybrid
    assert.equal(j.salary, 'CAD 35-38 per-hour-wage');
    assert.equal(j.postedAt, new Date(raw[0].createdAt).toISOString());
    assert.equal(j.jobUrl, raw[0].hostedUrl);
    assert.equal(j.applyUrl, raw[0].applyUrl);
    assert.ok(j.description.startsWith(raw[0].descriptionPlain.trim().slice(0, 40))); // plain text is used when present
    assert.ok(j.description.includes(raw[0].lists[0].text));
    assert.doesNotMatch(j.description, /<li>/);
});

// Recorded 2026-11-16 (zoox 6f987774, spotify a4651332): Lever returned descriptionPlain and additionalPlain as ""
// while the HTML description and additional were full. The intro and closing text must come from the HTML.
test('lever: empty plain-text fields fall back to the HTML description and closing', async () => {
    const raw = fixture('lever-empty-plain.json');
    const get = fakeGet({ 'https://api.lever.co/v0/postings/acme?mode=json': raw });
    const [zoox, spotify] = await ADAPTERS.lever.fetchJobs({ ats: 'lever', token: 'acme' }, { includeDescription: true }, get);
    for (const p of raw) assert.equal(p.descriptionPlain, '');

    // no lists: before the fix this posting had no description at all
    assert.match(zoox.description ?? '', /^Zoox is building a purpose-built robotaxi/);
    assert.match(zoox.description, /There are three major components to compensation/);

    const intro = spotify.description.indexOf('Royalty Operations owns the operations behind Spotify’s royalty process');
    const list = spotify.description.indexOf("What You'll Do");
    const closing = spotify.description.indexOf('Spotify is an equal opportunity employer');
    assert.ok(intro === 0 && list > intro && closing > list, `intro ${intro}, list ${list}, closing ${closing}`);

    for (const j of [zoox, spotify]) assert.doesNotMatch(j.description, /<[a-z/]|&[a-z]+;|&#/i);
});

test('lever: EU boards use the EU API host', async () => {
    const get = fakeGet({ 'https://api.eu.lever.co/v0/postings/acme?mode=json': [] });
    assert.deepEqual(await ADAPTERS.lever.fetchJobs({ ats: 'lever', token: 'acme', eu: true }, { includeDescription: true }, get), []);
});

test('ashby: maps recorded linear board incl. compensation and workplace type', async () => {
    const raw = fixture('ashby-linear.json');
    const get = fakeGet({ 'https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true': raw });
    const jobs = await ADAPTERS.ashby.fetchJobs({ ats: 'ashby', token: 'linear', company: 'Linear' }, { includeDescription: true }, get);
    assert.equal(jobs.length, 2);
    const j = jobs[0];
    assert.deepEqual(Object.keys(j), FIELDS);
    assert.equal(j.id, `ashby:linear:${raw.jobs[0].id}`);
    assert.equal(j.company, 'Linear');
    assert.equal(j.salary, '$240K - $320K');
    assert.equal(j.remote, raw.jobs[0].workplaceType === 'Remote');
    assert.equal(j.employmentType, 'Full-time');
    assert.equal(j.jobUrl, raw.jobs[0].jobUrl);
    assert.equal(j.applyUrl, raw.jobs[0].applyUrl);
    assert.ok(j.description.length > 200);
});

test('ashby: unlisted postings are dropped', async () => {
    const raw = fixture('ashby-linear.json');
    raw.jobs[1].isListed = false;
    const get = fakeGet({ 'https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true': raw });
    const jobs = await ADAPTERS.ashby.fetchJobs({ ats: 'ashby', token: 'linear' }, { includeDescription: false }, get);
    assert.equal(jobs.length, 1);
});

test('workable: maps recorded huggingface account', async () => {
    const raw = fixture('workable-huggingface.json');
    const get = fakeGet({ 'https://www.workable.com/api/accounts/huggingface?details=true': raw });
    const jobs = await ADAPTERS.workable.fetchJobs({ ats: 'workable', token: 'huggingface' }, { includeDescription: true }, get);
    assert.equal(jobs.length, 2);
    const j = jobs[0];
    assert.deepEqual(Object.keys(j), FIELDS);
    assert.equal(j.id, `workable:huggingface:${raw.jobs[0].shortcode}`);
    assert.equal(j.company, 'Hugging Face');
    assert.equal(j.remote, true);
    assert.equal(j.location, 'Paris, Île-de-France, France');
    assert.equal(j.employmentType, 'Full-time');
    assert.equal(j.postedAt, '2026-05-29T00:00:00.000Z');
    assert.equal(j.applyUrl, raw.jobs[0].application_url);
    assert.match(j.description, /Hugging Face/);
});

test('workable: a job listed once per location becomes one job with all locations', async () => {
    const raw = fixture('workable-huggingface.json');
    const other = { ...raw.jobs[0], city: 'Lyon', state: 'Auvergne-Rhône-Alpes', locations: [{ country: 'France', city: 'Lyon', region: 'Auvergne-Rhône-Alpes', hidden: false }] };
    raw.jobs.splice(1, 0, other, { ...raw.jobs[0] });
    const get = fakeGet({ 'https://www.workable.com/api/accounts/huggingface?details=false': raw });
    const jobs = await ADAPTERS.workable.fetchJobs({ ats: 'workable', token: 'huggingface' }, { includeDescription: false }, get);
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].location, 'Paris, Île-de-France, France; Lyon, Auvergne-Rhône-Alpes, France');
});

test('htmlToText: lists, breaks and entities', () => {
    assert.equal(htmlToText('<p>A &amp; B</p><ul><li>one</li><li>two&nbsp;x</li></ul>x<br>y &#8217; &#x2019;'), 'A & B\n\n- one\n- two x\nx\ny ’ ’');
    assert.equal(htmlToText(''), null);
    // list item text inside a paragraph keeps its bullet
    assert.equal(htmlToText('<ul><li><p>a</p></li><li><p>&#xa0;b</p></li></ul>'), '- a\n- b');
    // a bullet with no text of its own (only a nested list, or empty) leaves no lone '-' line
    assert.equal(htmlToText('<p>Bonus</p><ul><li><ul><li>x</li></ul></li><li></li></ul>'), 'Bonus\n\n- x');
    assert.equal(htmlToText('<script>bad()</script><p> </p>'), null);
});
