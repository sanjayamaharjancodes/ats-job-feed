// One adapter per ATS. Each uses only that ATS's documented public job-board API
// and maps its postings to the shared output schema (see job()).
import { decodeEntities, htmlToText } from './html.js';

const enc = encodeURIComponent;
const iso = (d) => {
    if (d === null || d === undefined || d === '') return null;
    const t = new Date(d);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
};
const looksRemote = (location) => /\bremote\b/i.test(location ?? '');
const joinText = (parts) => parts.filter(Boolean).join('\n\n') || null;

function job(board, f) {
    return {
        id: `${board.ats}:${board.token}:${f.atsJobId}`,
        ats: board.ats,
        boardToken: board.token,
        company: f.company?.trim() || board.company || board.token,
        title: f.title?.trim() ?? null,
        location: f.location || null,
        remote: f.remote,
        department: f.department || null,
        employmentType: f.employmentType || null,
        salary: f.salary || null,
        postedAt: iso(f.postedAt),
        updatedAt: iso(f.updatedAt),
        jobUrl: f.jobUrl ?? null,
        applyUrl: f.applyUrl ?? f.jobUrl ?? null,
        description: f.description ?? null,
    };
}

export const greenhouse = {
    // https://developers.greenhouse.io/job-board.html ; content=true also adds departments
    async fetchJobs(board, { includeDescription }, get) {
        const { body } = await get(`https://boards-api.greenhouse.io/v1/boards/${enc(board.token)}/jobs?content=true`);
        return body.jobs.map((j) => job(board, {
            atsJobId: j.id,
            company: j.company_name,
            title: j.title,
            location: j.location?.name,
            remote: looksRemote(j.location?.name),
            department: j.departments?.map((d) => d.name).join(', '),
            postedAt: j.first_published,
            updatedAt: j.updated_at,
            jobUrl: j.absolute_url,
            description: includeDescription && j.content ? htmlToText(decodeEntities(j.content)) : null,
        }));
    },
};

const LEVER_REMOTE = { remote: true, onsite: false, 'on-site': false, hybrid: false };
// Lever documents each text field twice, as styled HTML and as plain text (postings-api README, "description",
// "descriptionPlain", "additional", "additionalPlain"). On some postings the plain field is "" while the HTML is full,
// so fall back to the HTML converted to text.
const leverText = (plain, html) => plain?.trim() || htmlToText(html);
export const lever = {
    // https://github.com/lever/postings-api ; EU accounts live on api.eu.lever.co
    async fetchJobs(board, { includeDescription }, get) {
        const host = board.eu ? 'api.eu.lever.co' : 'api.lever.co';
        const { body } = await get(`https://${host}/v0/postings/${enc(board.token)}?mode=json`);
        return body.map((p) => {
            const c = p.categories ?? {};
            const location = c.allLocations?.length ? c.allLocations.join('; ') : c.location;
            const s = p.salaryRange;
            return job(board, {
                atsJobId: p.id,
                title: p.text,
                location,
                remote: LEVER_REMOTE[p.workplaceType] ?? looksRemote(location),
                department: c.department || c.team,
                employmentType: c.commitment,
                salary: s && (s.min || s.max) ? `${s.currency ?? ''} ${s.min ?? ''}-${s.max ?? ''} ${s.interval ?? ''}`.trim() : null,
                postedAt: p.createdAt,
                jobUrl: p.hostedUrl,
                applyUrl: p.applyUrl,
                description: includeDescription
                    ? joinText([
                        leverText(p.descriptionPlain, p.description),
                        ...(p.lists ?? []).map((l) => joinText([l.text, htmlToText(l.content)])),
                        leverText(p.additionalPlain, p.additional),
                    ])
                    : null,
            });
        });
    },
};

const ASHBY_TYPES = { FullTime: 'Full-time', PartTime: 'Part-time', Intern: 'Internship', Contract: 'Contract', Temporary: 'Temporary' };
export const ashby = {
    // https://developers.ashbyhq.com/docs/public-job-posting-api
    async fetchJobs(board, { includeDescription }, get) {
        const { body } = await get(`https://api.ashbyhq.com/posting-api/job-board/${enc(board.token)}?includeCompensation=true`);
        return body.jobs
            .filter((j) => j.isListed !== false) // unlisted postings are reachable only by direct link
            .map((j) => job(board, {
                atsJobId: j.id,
                title: j.title,
                location: [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location)].filter(Boolean).join('; '),
                remote: j.workplaceType ? j.workplaceType === 'Remote' : Boolean(j.isRemote),
                department: j.department || j.team,
                employmentType: ASHBY_TYPES[j.employmentType] ?? j.employmentType,
                salary: j.compensation?.scrapeableCompensationSalarySummary || j.compensation?.compensationTierSummary,
                postedAt: j.publishedAt,
                jobUrl: j.jobUrl,
                applyUrl: j.applyUrl,
                description: includeDescription ? (j.descriptionPlain?.trim() || htmlToText(j.descriptionHtml)) : null,
            }));
    },
};

export const workable = {
    // https://help.workable.com/hc/en-us/articles/115012771647 ("the below public endpoints")
    async fetchJobs(board, { includeDescription }, get) {
        const { body } = await get(`https://www.workable.com/api/accounts/${enc(board.token)}?details=${includeDescription}`);
        // The endpoint lists a job once per location: merge the entries into one job with all locations.
        const jobs = new Map();
        for (const j of body.jobs.map(toJob)) {
            const first = jobs.get(j.id);
            if (!first) jobs.set(j.id, j);
            else if (j.location && !first.location?.split('; ').includes(j.location)) first.location = first.location ? `${first.location}; ${j.location}` : j.location;
        }
        return [...jobs.values()];

        function toJob(w) {
            const locs = (w.locations ?? []).filter((l) => !l.hidden).map((l) => [l.city, l.region, l.country].filter(Boolean).join(', '));
            return job(board, {
                atsJobId: w.shortcode,
                company: body.name,
                title: w.title,
                location: locs.length ? locs.join('; ') : [w.city, w.state, w.country].filter(Boolean).join(', '),
                remote: Boolean(w.telecommuting),
                department: w.department,
                employmentType: w.employment_type,
                postedAt: w.published_on || w.created_at,
                jobUrl: w.url || w.shortlink,
                applyUrl: w.application_url,
                description: includeDescription ? htmlToText(w.description) : null,
            });
        }
    },
};

export const ADAPTERS = { greenhouse, lever, ashby, workable };
