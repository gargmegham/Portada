(function () {
    const UA = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    };
    const URLS_JSON = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";
    const AIOMETA = "https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta";

    let dynamicBase = null;

    function fixUrl(url, base) {
        if (!url) return "";
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return base + url;
        return url;
    }

    function titleClean(text) {
        return (text || "").replace(/\s+/g, " ").replace(/^Download\s+/i, "").trim();
    }

    async function resolveBaseUrl() {
        if (dynamicBase) return dynamicBase;
        try {
            const r = await http_get(URLS_JSON, UA);
            const obj = JSON.parse(r.body || "{}");
            if (obj.moviesdrive && /^https?:\/\//.test(obj.moviesdrive)) {
                dynamicBase = obj.moviesdrive.replace(/\/$/, "");
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

    function asType(title) {
        const t = (title || "").toLowerCase();
        return (t.includes("season") || t.includes("episode") || t.includes("series")) ? "series" : "movie";
    }

    async function getHome(cb) {
        try {
            const base = await resolveBaseUrl();
            const sections = [
                { name: "Home", path: "/page/" },
                { name: "Prime Video", path: "/category/amzn-prime-video/page/" },
                { name: "Netflix", path: "/category/netflix/page/" },
                { name: "Hotstar", path: "/category/hotstar/page/" },
                { name: "Anime", path: "/category/anime/page/" },
                { name: "K Drama", path: "/category/k-drama/page/" }
            ];

            const out = {};
            for (const s of sections) {
                const url = `${base}${s.path}1`;
                const res = await http_get(url, UA);
                const links = await parse_html(res.body || "", "#moviesGridMain > a", "href");
                const items = [];
                for (const it of links || []) {
                    const href = fixUrl(it.attr, base);
                    const titleM = (it.html || "").match(/<p[^>]*>([\s\S]*?)<\/p>/i);
                    const imgM = (it.html || "").match(/<img[^>]+src=["']([^"']+)/i);
                    const title = titleClean(titleM ? titleM[1].replace(/<[^>]+>/g, "") : it.text);
                    const poster = fixUrl(imgM ? imgM[1] : "", base);
                    if (!href || !title) continue;
                    items.push(new MultimediaItem({ title, url: href, posterUrl: poster, type: asType(title) }));
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
            const out = hits.map((h) => {
                const d = h.document || {};
                const title = titleClean(d.post_title || "");
                const url = fixUrl(d.permalink || "", base);
                const posterUrl = fixUrl(d.post_thumbnail || "", base);
                return title && url ? new MultimediaItem({ title, url, posterUrl, type: asType(title) }) : null;
            }).filter(Boolean);
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e) });
        }
    }

    async function load(url, cb) {
        try {
            const base = await resolveBaseUrl();
            const res = await http_get(url, UA);
            const html = res.body || "";

            let title = titleClean(((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""));
            let posterUrl = (((html.match(/<main[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)/i) || [])[1] || ""));
            posterUrl = fixUrl(posterUrl, base);

            const imdbId = ((html.match(/imdb\.com\/title\/(tt\d+)/i) || [])[1] || "");
            const isSeries = /(?:episode|season\s*\d+|series)/i.test(title || "");
            let description = "";
            let year;
            let score;
            let tags = [];

            if (imdbId) {
                try {
                    const metaType = isSeries ? "series" : "movie";
                    const mr = await http_get(`${AIOMETA}/${metaType}/${imdbId}.json`, UA);
                    const meta = (JSON.parse(mr.body || "{}").meta || {});
                    if (meta.name) title = meta.name;
                    if (meta.poster) posterUrl = meta.poster;
                    description = meta.description || description;
                    year = parseInt((meta.year || "").slice(0, 4), 10) || undefined;
                    score = parseFloat(meta.imdbRating || "") || undefined;
                    tags = Array.isArray(meta.genre) ? meta.genre : [];
                } catch (_) {}
            }

            const containers = await parse_html(html, "h5 > a", "href");
            const episodeMap = new Map();
            let fallbackEpisode = 1;

            for (const c of containers || []) {
                const contText = c.text || "";
                if (/zip/i.test(contText)) continue;
                const containerUrl = fixUrl(c.attr, base);
                if (!containerUrl) continue;

                let season = 1;
                const sm = contText.match(/(?:season|s)\s*(\d+)/i);
                if (sm) season = parseInt(sm[1], 10);

                const ir = await http_get(containerUrl, UA);
                const inner = await parse_html(ir.body || "", "a", "href");

                for (const a of inner || []) {
                    const href = fixUrl(a.attr, base);
                    const txt = (a.text || "").trim();
                    if (!/(hubcloud|gdflix|gdlink)/i.test(`${href} ${txt}`)) continue;

                    let ep = fallbackEpisode;
                    const em = txt.match(/(?:ep|episode)\s*(\d+)/i);
                    if (em) ep = parseInt(em[1], 10);
                    fallbackEpisode = Math.max(fallbackEpisode, ep + 1);

                    const key = `${season}:${ep}`;
                    if (!episodeMap.has(key)) episodeMap.set(key, []);
                    episodeMap.get(key).push({ source: href, label: qualityFromText(`${contText} ${txt}`) });
                }
            }

            const episodes = [];
            if (isSeries) {
                for (const [key, arr] of episodeMap.entries()) {
                    const [season, episode] = key.split(":").map(Number);
                    episodes.push(new Episode({
                        name: `Episode ${episode}`,
                        season,
                        episode,
                        posterUrl,
                        description,
                        url: JSON.stringify(arr)
                    }));
                }
                episodes.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
            } else {
                const all = [];
                for (const arr of episodeMap.values()) all.push(...arr);
                episodes.push(new Episode({
                    name: "Full Movie",
                    season: 1,
                    episode: 1,
                    posterUrl,
                    description,
                    url: JSON.stringify(all)
                }));
            }

            cb({
                success: true,
                data: new MultimediaItem({
                    title,
                    url,
                    posterUrl,
                    description,
                    year,
                    score,
                    tags,
                    type: isSeries ? "series" : "movie",
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
                const sourceUrl = s.source;
                const label = s.label || "Auto";
                if (!sourceUrl) continue;

                try {
                    const extracted = await loadExtractor(sourceUrl, manifest.baseUrl);
                    if (Array.isArray(extracted) && extracted.length) {
                        for (const ex of extracted) {
                            out.push(new StreamResult({
                                url: ex.url,
                                source: `${ex.source || ex.name || "Source"} [${label}]`,
                                headers: ex.headers || {}
                            }));
                        }
                        continue;
                    }
                } catch (_) {}

                out.push(new StreamResult({ url: sourceUrl, source: `Direct [${label}]`, headers: {} }));
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
