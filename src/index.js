// Library entry point: read the open jobs of a list of companies from the public job-board APIs of
// Greenhouse, Lever, Ashby and Workable, in one schema.
import { ADAPTERS } from './ats.js';
import { boardFromUrl, boardKey, boardsInHtml, resolveEntry, tokenVariants } from './detect.js';
import { get as httpGet, HttpError, USER_AGENT } from './http.js';
import { decodeEntities, htmlToText } from './html.js';

const BOARD_CONCURRENCY = 8;
const PUBLISHES_COMPANY = new Set(['greenhouse', 'workable']); // Lever and Ashby publish no company name

async function pool(items, size, fn) {
    let i = 0;
    const worker = async () => {
        while (i < items.length) await fn(items[i++]);
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/** A job passes when it matches every filter that is set. Keywords match case-insensitively; any keyword is enough. */
export function jobFilter({ titleKeywords = [], locationKeywords = [], remoteOnly = false, postedWithinDays } = {}, now = Date.now()) {
    const has = (words, text) => !words.length || words.some((w) => (text ?? '').toLowerCase().includes(w.toLowerCase()));
    const since = postedWithinDays ? now - postedWithinDays * 86400000 : null;
    return (j) => has(titleKeywords, j.title) && has(locationKeywords, j.location) && (!remoteOnly || j.remote)
        && (since === null || (j.postedAt !== null && Date.parse(j.postedAt) >= since));
}

/**
 * Fetch the open jobs of every company in `companies`.
 *
 * Each entry is an ATS board URL, an "ats:token" pair, a company's own careers-page URL or a bare company name.
 *
 * options:
 *   includeDescription  add the plain-text description (default true)
 *   titleKeywords, locationKeywords, remoteOnly, postedWithinDays   filters (see jobFilter)
 *   get                 HTTP GET function, for tests or a custom client (default: the polite client in http.js)
 *   onBoard(row)        called once per board with its report row, as soon as the board is done
 *
 * Returns { jobs, boards }: `jobs` is one object per open job; `boards` is one report row per input entry.
 * A board that fails is reported in `boards` and does not stop the others.
 */
export async function fetchJobs(companies, options = {}) {
    if (!Array.isArray(companies)) throw new TypeError('companies must be an array of strings');
    const { includeDescription = true, get = httpGet, onBoard } = options;
    const keep = jobFilter(options);
    const jobs = [];
    const boards = [];
    const done = new Set();
    const report = (row) => {
        boards.push(row);
        onBoard?.(row);
    };

    async function readBoard(entry, board) {
        const row = { input: entry, ats: board.ats, boardToken: board.token, status: 'ok', jobsFound: 0 };
        if (board.resolvedBy) row.resolvedBy = board.resolvedBy;
        const key = boardKey(board);
        if (done.has(key)) return report({ ...row, status: 'skipped', error: 'Duplicate of an earlier entry' });
        done.add(key);
        try {
            const all = board.jobs ?? await ADAPTERS[board.ats].fetchJobs(board, { includeDescription }, get);
            // A bare name is a guess: publish the company name the ATS gives, so the caller can check it.
            if (board.resolvedBy) row.atsCompanyName = PUBLISHES_COMPANY.has(board.ats) ? (all[0]?.company ?? null) : null;
            const kept = all.filter(keep);
            row.jobsFound = kept.length;
            jobs.push(...kept);
        } catch (err) {
            Object.assign(row, { status: 'failed', error: err.message });
        }
        return report(row);
    }

    const entries = companies.filter((c) => typeof c === 'string' && c.trim());
    await pool(entries, BOARD_CONCURRENCY, async (entry) => {
        try {
            const resolved = await resolveEntry(entry, { get, includeDescription });
            if (resolved.error) return report({ input: entry, status: 'failed', jobsFound: 0, error: resolved.error });
            for (const b of resolved.boards) await readBoard(entry, b);
        } catch (err) { // an unexpected error fails only this entry
            report({ input: entry, status: 'failed', jobsFound: 0, error: err.message });
        }
        return undefined;
    });

    return { jobs, boards };
}

export { ADAPTERS, boardFromUrl, boardKey, boardsInHtml, resolveEntry, tokenVariants, httpGet as get, HttpError, USER_AGENT, decodeEntities, htmlToText };
