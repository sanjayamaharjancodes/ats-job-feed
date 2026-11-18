import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { get, HttpError, USER_AGENT } from '../src/http.js';

async function serve(handler) {
    const server = createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${server.address().port}`, close: () => {
        server.closeAllConnections();
        server.close();
    } };
}

test('retries 429 and 5xx, then succeeds; sends the generic User-Agent', async () => {
    const statuses = [429, 503];
    const agents = [];
    const s = await serve((req, res) => {
        agents.push(req.headers['user-agent']);
        const status = statuses.shift() ?? 200;
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: status === 200 }));
    });
    try {
        const r = await get(`${s.url}/x`, { retryBaseMs: 5 });
        assert.deepEqual(r.body, { ok: true });
        assert.equal(agents.length, 3);
        assert.ok(agents.every((a) => a === USER_AGENT));
    } finally {
        s.close();
    }
});

test('404 is not retried', async () => {
    let hits = 0;
    const s = await serve((req, res) => {
        hits++;
        res.writeHead(404).end();
    });
    try {
        await assert.rejects(get(`${s.url}/x`, { retryBaseMs: 5 }), (e) => e instanceof HttpError && e.status === 404);
        assert.equal(hits, 1);
    } finally {
        s.close();
    }
});

test('gives up after the retry budget', async () => {
    let hits = 0;
    const s = await serve((req, res) => {
        hits++;
        res.writeHead(500).end();
    });
    try {
        await assert.rejects(get(`${s.url}/x`, { retryBaseMs: 1, retries: 2 }), (e) => e.status === 500);
        assert.equal(hits, 3);
    } finally {
        s.close();
    }
});

test('times out a hanging request and retries it', async () => {
    let hits = 0;
    const s = await serve((req, res) => {
        hits++;
        if (hits === 1) return; // never answer
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
    try {
        const r = await get(`${s.url}/x`, { timeoutMs: 200, retryBaseMs: 5 });
        assert.deepEqual(r.body, { ok: true });
        assert.equal(hits, 2);
    } finally {
        s.close();
    }
});

test('never more than 4 requests in flight per host', async () => {
    let active = 0;
    let peak = 0;
    const s = await serve((req, res) => {
        active++;
        peak = Math.max(peak, active);
        setTimeout(() => {
            active--;
            res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
        }, 30);
    });
    try {
        await Promise.all(Array.from({ length: 12 }, (_, i) => get(`${s.url}/${i}`)));
        assert.equal(peak, 4);
    } finally {
        s.close();
    }
});
