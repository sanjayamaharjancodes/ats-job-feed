// Turns one input entry (ATS URL, company careers-page URL, "ats:token" or bare name) into boards.
import { ADAPTERS } from './ats.js';

const RESERVED = {
    workableSub: new Set(['www', 'apply', 'help', 'resources', 'jobs', 'api', 'blog', 'careers']),
    workablePath: new Set(['j', 'api', 'jobs']),
    ashby: new Set(['api']),
};

// Greenhouse and Ashby ignore the case of board tokens, so they are lower-cased to give one board one key
// (and one set of job ids). Lever and Workable tokens are case-sensitive and are kept as given.
const CASE_INSENSITIVE = new Set(['greenhouse', 'ashby']);
const makeBoard = (ats, token, extra = {}) => ({ ats, token: CASE_INSENSITIVE.has(ats) ? token.toLowerCase() : token, ...extra });

/** Recognise a URL on an ATS host. Returns { ats, token, eu? } or null. */
export function boardFromUrl(raw) {
    let u;
    let seg;
    try {
        u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
        seg = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
        return null; // not a URL, or a malformed percent-escape
    }
    const host = u.hostname.toLowerCase();
    const board = (ats, token, extra) => (token && /^[\w.-]+$/.test(token) ? makeBoard(ats, token, extra) : null);

    if (host === 'boards-api.greenhouse.io') return seg[0] === 'v1' && seg[1] === 'boards' ? board('greenhouse', seg[2]) : null;
    if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
        if (seg[0] === 'embed') return board('greenhouse', u.searchParams.get('for'));
        return board('greenhouse', seg[0]);
    }
    const lever = host.match(/^(jobs|api)\.(eu\.)?lever\.co$/);
    if (lever) {
        const token = lever[1] === 'api' ? (seg[0] === 'v0' && seg[1] === 'postings' ? seg[2] : null) : seg[0];
        return board('lever', token, lever[2] ? { eu: true } : {});
    }
    if (host === 'jobs.ashbyhq.com') return RESERVED.ashby.has(seg[0]) ? null : board('ashby', seg[0]);
    if (host === 'api.ashbyhq.com') return seg[0] === 'posting-api' && seg[1] === 'job-board' ? board('ashby', seg[2]) : null;
    if (host === 'www.workable.com' || host === 'apply.workable.com') {
        const i = seg.indexOf('accounts');
        if (seg[0] === 'api') return i > 0 ? board('workable', seg[i + 1]) : null;
        return host === 'apply.workable.com' && !RESERVED.workablePath.has(seg[0]) ? board('workable', seg[0]) : null;
    }
    const sub = host.match(/^([a-z0-9-]+)\.workable\.com$/);
    if (sub && !RESERVED.workableSub.has(sub[1])) return board('workable', sub[1]);
    return null;
}

const ATS_URL = /(?:https?:)?\/\/[a-z0-9.-]*(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com)[^\s"'<>)\\]*/gi;

/** Find ATS boards linked or embedded in one HTML page. */
export function boardsInHtml(html) {
    const text = html.replace(/\\\//g, '/').replace(/&amp;/g, '&');
    const found = new Map();
    for (const m of text.match(ATS_URL) ?? []) {
        const b = boardFromUrl(m);
        if (b) found.set(boardKey(b), b);
    }
    return [...found.values()];
}

export const boardKey = (b) => `${b.ats}${b.eu ? '-eu' : ''}-${b.token}`;

const isUrl = (s) => /^https?:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(s);

/** Candidate board tokens for a bare company name, e.g. "Hugging Face" -> huggingface, hugging-face. */
export function tokenVariants(name) {
    const lower = name.toLowerCase();
    return [...new Set([
        /^[\w.-]+$/.test(name) ? name : null,
        lower.replace(/[^a-z0-9]/g, ''),
        lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    ].filter(Boolean))];
}

/**
 * Resolve one input entry to { boards } or { error }.
 * Boards found by probing carry the jobs already fetched (board.jobs) so they are not fetched twice.
 */
export async function resolveEntry(entry, { get, includeDescription }) {
    const s = entry.trim();
    const explicit = s.match(/^([a-z]+):([\w.-]+)$/i);
    if (explicit && ADAPTERS[explicit[1].toLowerCase()]) return { boards: [makeBoard(explicit[1].toLowerCase(), explicit[2])] };

    if (isUrl(s)) {
        const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
        const direct = boardFromUrl(url);
        if (direct) return { boards: [direct] };
        let page;
        try {
            page = await get(url, { type: 'text', retries: 2 });
        } catch (err) {
            return { error: `Could not load careers page: ${err.message}` };
        }
        const redirected = boardFromUrl(page.url);
        const boards = redirected ? [redirected] : boardsInHtml(page.body);
        return boards.length ? { boards } : { error: 'No Greenhouse, Lever, Ashby or Workable board link found on this page' };
    }

    // Bare company name or token: probe every ATS API and keep the board with the most jobs.
    // That is a guess, so the board is marked for the run report.
    const tokens = tokenVariants(s);
    const attempts = new Map(Object.keys(ADAPTERS).flatMap((ats) => tokens.map((token) => {
        const b = makeBoard(ats, token, { company: s, resolvedBy: 'name-probe' });
        return [boardKey(b), b]; // one probe per board: "Discord" and "discord" are one Greenhouse board
    })));
    const results = await Promise.all([...attempts.values()].map(async (b) => {
        try {
            return { ...b, jobs: await ADAPTERS[b.ats].fetchJobs(b, { includeDescription }, get) };
        } catch {
            return null; // 404 and friends: not on this ATS
        }
    }));
    const best = results.filter((r) => r?.jobs.length).sort((a, b) => b.jobs.length - a.jobs.length)[0];
    if (!best) return { error: `No board with open jobs found for tokens: ${tokens.join(', ')}` };
    return { boards: [best] };
}
