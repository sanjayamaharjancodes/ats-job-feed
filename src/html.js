const NAMED = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·',
    copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', deg: '°', times: '×',
};

export function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] !== '#') return NAMED[e] ?? m;
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    });
}

const BLOCK = 'p|div|h[1-6]|ul|ol|tr|table|section|article|header|footer|blockquote|pre';

/** Convert an HTML fragment to readable plain text. Returns null for empty input. */
export function htmlToText(html) {
    if (!html) return null;
    const text = decodeEntities(
        html
            .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<li[^>]*>(\s*<p(\s[^>]*)?>)?/gi, '\n- ') // <li><p>text</p></li> keeps text on the bullet line
            .replace(/<\/p>\s*<\/li>/gi, '')
            .replace(new RegExp(`</?(${BLOCK})(\\s[^>]*)?>`, 'gi'), '\n')
            .replace(/<[^>]*>/g, ''),
    )
        .replace(/[ \t\f\v\r ]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/^-$/gm, '') // a bullet with no text of its own
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text || null;
}
