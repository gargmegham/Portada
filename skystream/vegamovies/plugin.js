(function () {
    const UA = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    };
    const URLS_JSON = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";
    const CINEMETA = "https://v3-cinemeta.strem.io/meta";

    let dynamicBase = null;

    function fixUrl(url, base) {
        if (!url) return "";
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return base + url;
        return url;
    }

    function cleanTitle(t) {
        return (t || "").replace(/<[^>]+>/g, "").replace(/^Download\s+/i, "").replace(/\s+/g, " ").trim();
    }

    function mediaTypeByTitle(title) {
        return /season|episode|series/i.test(title || "") ? "series" : "movie";
    }

    async function resolveBaseUrl() {
        if (dynamicBase) return dynamicBase;
        try {
            const r = await http_get(URLS_JSON, UA);
            const obj = JSON.parse(r.body || "{}");
            if (obj.vegamovies && /^https?:\/\//.test(obj.vegamovies)) {
                dynamicBase = obj.vegamovies.replace(/\/$/, "");
                return dynamicBase;
            }
        } catch (_) {}
        dynamicBase = (manifest.baseUrl || "").replace(/\/$/, "");
        return dynamicBase;
    }

    function qualityFromText(text) {
        const t = (text || "").toLowerCase();
        if (t.includes("2160") || t.includes("4k")) return "4K";
        if (t.includes("1080")) return "1080p";
        if (t.includes("720")) return "720p";
        if (t.includes("480")) return "480p";
        return "Auto";
    }

    async function getHome(cb) {
        try {
            const base = await resolveBaseUrl();
            const sections = [
                { name: "Home", path: "/page/1/" },
                { name: "Netflix", path: "/category/web-series/netflix/page/1/" },
                { name: "Disney Plus Hotstar", path: "/category/web-series/disney-plus-hotstar/page/1/" },
                { name: "Amazon Prime", path: "/category/web-series/amazon-prime-video/page/1/" },
                { name: "Anime Series", path: "/category/anime-series/page/1/" },
                { name: "Korean Series", path: "/category/korean-series/page/1/" }
            ];

            const out = {};
            for (const s of sections) {
                const res = await http_get(base + s.path, UA);
                const cards = await parse_html(res.body || "", "div.movies-grid > a", "href");
                const items = [];

                for (const c of cards || []) {
                    const href = fixUrl(c.attr, base);
                    const alt = (c.html.match(/<img[^>]+alt=["']([^"']+)/i) || [])[1] || c.text;
                    const src = (c.html.match(/<img[^>]+src=["']([^"']+)/i) || [])[1] || (c.html.match(/<img[^>]+data-src=["']([^"']+)/i) || [])[1] || "";
                    const title = cleanTitle(alt);
                    const posterUrl = fixUrl(src, base);
                    if (!href || !title) continue;
                    items.push(new MultimediaItem({ title, url: href, posterUrl, type: mediaTypeByTitle(title) }));
                }
                if (items.length) out[s.name] = items;
            }
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: String(e) });
        }
    }

    async function search(query, cb) {
        try {
            const base = await resolveBaseUrl();
            const res = await http_get(`${base}/search.php?q=${encodeURIComponent(query)}&page=1`, UA);
            const json = JSON.parse(res.body || "{}");
            const hits = Array.isArray(json.hits) ? json.hits : [];
            const items = hits.map((h) => {
                const d = h.document || {};
                const title = cleanTitle(d.post_title || "");
                const url = fixUrl(d.permalink || "", base);
                const posterUrl = fixUrl(d.post_thumbnail || "", base);
                if (!title || !url) return null;
                return new MultimediaItem({ title, url, posterUrl, type: mediaTypeByTitle(title) });
            }).filter(Boolean);
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e) });
        }
    }

    async function load(url, cb) {
        try {
            const base = await resolveBaseUrl();
            const fullUrl = fixUrl(url, base);
            const res = await http_get(fullUrl, UA);
            const html = res.body || "";

            let title = cleanTitle(((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""));
            let posterUrl = fixUrl(((html.match(/<p[^>]*>\s*<img[^>]+src=["']([^"']+)/i) || [])[1] || ""), base);
            const imdbId = ((html.match(/imdb\.com\/title\/(tt\d+)/i) || [])[1] || "");

            const isSeries = /Series\s*-\s*SYNOPSIS|Series Info|series synopsis/i.test(html) || /season|episode/i.test(title);
            let description = cleanTitle(((html.match(/(?:SYNOPSIS\/PLOT|synopsis\/PLOT)[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || ""));
            let year;
            let score;
            let tags = [];

            if (imdbId) {
                try {
                    const metaType = isSeries ? "series" : "movie";
                    const mr = await http_get(`${CINEMETA}/${metaType}/${imdbId}.json`, UA);
                    const meta = (JSON.parse(mr.body || "{}").meta || {});
                    if (meta.name) title = meta.name;
                    if (meta.poster) posterUrl = meta.poster;
                    if (meta.description) description = meta.description;
                    year = parseInt((meta.year || "").slice(0, 4), 10) || undefined;
                    score = parseFloat(meta.imdbRating || "") || undefined;
                    tags = Array.isArray(meta.genre) ? meta.genre : (Array.isArray(meta.genres) ? meta.genres : []);
                } catch (_) {}
            }

            const anchors = await parse_html(html, "a", "href");
            const candidateButtons = (anchors || []).filter((a) => {
                const txt = (a.text || "").toLowerCase();
                const href = (a.attr || "").toLowerCase();
                return txt.includes("v-cloud") || txt.includes("episode") || txt.includes("download") || txt.includes("g-direct") || href.includes("vega") || href.includes("download");
            });

            const grouped = new Map();
            let seq = 1;

            for (const b of candidateButtons) {
                const seasonMatch = (b.text || "").match(/(?:season|s)\s*(\d+)/i);
                const season = seasonMatch ? parseInt(seasonMatch[1], 10) : 1;
                const target = fixUrl(b.attr, base);
                if (!target) continue;

                const page = await http_get(target, UA);
                const links = await parse_html(page.body || "", "a", "href");
                const vcloud = (links || []).filter((x) => /v-?cloud/i.test((x.text || "") + " " + (x.attr || "")));
                if (!vcloud.length) continue;

                for (const v of vcloud) {
                    const source = fixUrl(v.attr, base);
                    if (!source) continue;
                    const em = (v.text || "").match(/(?:ep|episode)\s*(\d+)/i);
                    const episode = em ? parseInt(em[1], 10) : seq++;
                    const key = `${season}:${episode}`;
                    if (!grouped.has(key)) grouped.set(key, []);
                    grouped.get(key).push({ source, label: qualityFromText(`${b.text} ${v.text}`) });
                }
            }

            const episodes = [];
            if (isSeries) {
                for (const [key, list] of grouped.entries()) {
                    const [season, episode] = key.split(":").map(Number);
                    episodes.push(new Episode({
                        name: `Episode ${episode}`,
                        season,
                        episode,
                        url: JSON.stringify(list),
                        posterUrl,
                        description
                    }));
                }
                episodes.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
            } else {
                const all = [];
                for (const list of grouped.values()) all.push(...list);
                episodes.push(new Episode({
                    name: "Full Movie",
                    season: 1,
                    episode: 1,
                    url: JSON.stringify(all),
                    posterUrl,
                    description
                }));
            }

            cb({
                success: true,
                data: new MultimediaItem({
                    title,
                    url: fullUrl,
                    posterUrl,
                    description,
                    type: isSeries ? "series" : "movie",
                    year,
                    score,
                    tags,
                    episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e) });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const sources = JSON.parse(url);
            if (!Array.isArray(sources)) return cb({ success: true, data: [] });
            const out = [];
            for (const s of sources) {
                if (!s.source) continue;
                try {
                    const extracted = await loadExtractor(s.source, manifest.baseUrl);
                    if (Array.isArray(extracted) && extracted.length) {
                        for (const ex of extracted) {
                            out.push(new StreamResult({
                                url: ex.url,
                                source: `${ex.source || ex.name || "Source"} [${s.label || "Auto"}]`,
                                headers: ex.headers || {}
                            }));
                        }
                        continue;
                    }
                } catch (_) {}
                out.push(new StreamResult({ url: s.source, source: `Direct [${s.label || "Auto"}]`, headers: {} }));
            }
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
