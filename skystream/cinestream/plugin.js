(function () {
    const UA = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    };

    const CINEMETA_CATALOG = "https://cinemeta-catalogs.strem.io";
    const CINEMETA_META = "https://v3-cinemeta.strem.io";
    const KITSU = "https://anime-kitsu.strem.fun";
    const IMAGE_PROXY = "https://wsrv.nl/?url=";

    function safeJson(text, fallback) {
        try { return JSON.parse(text || ""); } catch (_) { return fallback; }
    }

    function proxiedPoster(url) {
        if (!url) return "";
        if (url.includes("metahub.space") || url.includes("kitsu.")) return IMAGE_PROXY + url;
        return url;
    }

    function normalizedType(type) {
        if (type === "movie") return "movie";
        if (type === "anime") return "anime";
        return "series";
    }

    function makePassData(id, type) {
        return JSON.stringify({ id, type });
    }

    function parsePassData(raw) {
        return safeJson(raw, null);
    }

    async function fetchCatalog(url) {
        const res = await http_get(url, UA);
        return safeJson(res.body, { metas: [], hasMore: false });
    }

    async function getHome(cb) {
        try {
            const skip = 0;
            const sections = [
                { name: "Top Movies", url: `${CINEMETA_CATALOG}/top/catalog/movie/top/skip=${skip}.json` },
                { name: "Top Series", url: `${CINEMETA_CATALOG}/top/catalog/series/top/skip=${skip}.json` },
                { name: "Top Airing Anime", url: `https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/catalog/anime/mal.airing/skip=${skip}.json` },
                { name: "Top Anime", url: `${KITSU}/catalog/anime/kitsu-anime-trending/skip=${skip}.json` }
            ];

            const out = {};
            for (const s of sections) {
                const json = await fetchCatalog(s.url);
                const metas = Array.isArray(json.metas) ? json.metas : [];
                const items = metas.map((m) => {
                    const title = (m.aliases && m.aliases[0]) || m.name || "Unknown";
                    return new MultimediaItem({
                        title,
                        url: makePassData(m.id, m.type),
                        posterUrl: proxiedPoster(m.poster),
                        score: parseFloat(m.imdbRating || "") || undefined,
                        type: normalizedType(m.type)
                    });
                });
                if (items.length) out[s.name] = items;
            }

            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: String(e) });
        }
    }

    async function search(query, cb) {
        try {
            const endpoints = [
                `${CINEMETA_META}/catalog/movie/top/search=${encodeURIComponent(query)}.json`,
                `${CINEMETA_META}/catalog/series/top/search=${encodeURIComponent(query)}.json`,
                `${KITSU}/catalog/anime/kitsu-anime-airing/search=${encodeURIComponent(query)}.json`
            ];

            const groups = [];
            for (const e of endpoints) {
                const json = await fetchCatalog(e);
                const metas = Array.isArray(json.metas) ? json.metas : [];
                groups.push(metas.map((m) => {
                    const title = (m.aliases && m.aliases[0]) || m.name || "Unknown";
                    const poster = m.id && String(m.id).startsWith("tt")
                        ? `https://images.metahub.space/poster/medium/${m.id}/img`
                        : m.poster;
                    return new MultimediaItem({
                        title,
                        url: makePassData(m.id, m.type),
                        posterUrl: proxiedPoster(poster),
                        score: parseFloat(m.imdbRating || "") || undefined,
                        type: normalizedType(m.type)
                    });
                }));
            }

            const interleaved = [];
            const maxLen = Math.max(...groups.map((g) => g.length), 0);
            for (let i = 0; i < maxLen; i++) {
                for (const g of groups) {
                    if (i < g.length) interleaved.push(g[i]);
                }
            }
            cb({ success: true, data: interleaved });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e) });
        }
    }

    async function load(url, cb) {
        try {
            const pass = parsePassData(url);
            if (!pass || !pass.id || !pass.type) {
                return cb({ success: false, errorCode: "BAD_URL", message: "Invalid cine payload" });
            }

            const isKitsu = String(pass.id).includes("kitsu") || String(pass.id).includes("mal");
            const tvType = pass.type === "movie" ? "movie" : "series";
            const metaBase = isKitsu ? KITSU : CINEMETA_META;
            const encodedId = isKitsu ? String(pass.id).replace(":", "%3A") : pass.id;
            const metaRes = await http_get(`${metaBase}/meta/${tvType}/${encodedId}.json`, UA);
            const meta = safeJson(metaRes.body, {}).meta || {};

            const title = (meta.aliases && meta.aliases[0]) || meta.name || "Unknown";
            const posterUrl = proxiedPoster(meta.poster || "");
            const description = meta.description || "";
            const tags = Array.isArray(meta.genre) ? meta.genre : (Array.isArray(meta.genres) ? meta.genres : []);
            const score = parseFloat(meta.imdbRating || "") || undefined;
            const yearRaw = meta.year || meta.releaseInfo || "";
            const year = parseInt(String(yearRaw).split(/[\-–]/)[0], 10) || undefined;

            if (tvType === "movie") {
                const streamPayload = JSON.stringify({
                    addonType: "movie",
                    id: pass.id,
                    imdbId: meta.imdb_id || pass.id
                });
                cb({
                    success: true,
                    data: new MultimediaItem({
                        title,
                        url,
                        posterUrl,
                        description,
                        tags,
                        score,
                        year,
                        type: normalizedType(pass.type),
                        episodes: [
                            new Episode({
                                name: "Full Movie",
                                season: 1,
                                episode: 1,
                                url: streamPayload,
                                posterUrl,
                                description
                            })
                        ]
                    })
                });
                return;
            }

            const videos = Array.isArray(meta.videos) ? meta.videos : [];
            const episodes = videos
                .filter((v) => (v.season || 0) !== 0)
                .map((v) => new Episode({
                    name: v.name || v.title || `Episode ${v.episode}`,
                    season: v.season || 1,
                    episode: v.episode || 1,
                    posterUrl: proxiedPoster(v.thumbnail || posterUrl),
                    description: v.overview || "",
                    url: JSON.stringify({
                        addonType: "series",
                        id: pass.id,
                        imdbId: meta.imdb_id || pass.id,
                        season: v.imdbSeason || v.season || 1,
                        episode: v.imdbEpisode || v.episode || 1
                    })
                }));

            cb({
                success: true,
                data: new MultimediaItem({
                    title,
                    url,
                    posterUrl,
                    description,
                    tags,
                    score,
                    year,
                    type: normalizedType(pass.type),
                    episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e) });
        }
    }

    function normalizeStremioToStream(stream) {
        if (!stream) return null;

        if (stream.url) {
            return new StreamResult({
                url: stream.url,
                source: stream.name || stream.title || "Stremio",
                headers: stream.behaviorHints && stream.behaviorHints.proxyHeaders ? stream.behaviorHints.proxyHeaders : {}
            });
        }

        if (stream.infoHash) {
            const tr = [
                "udp://tracker.opentrackr.org:1337/announce",
                "udp://open.demonii.com:1337/announce",
                "udp://tracker.torrent.eu.org:451/announce"
            ];
            let magnet = `magnet:?xt=urn:btih:${stream.infoHash}`;
            if (stream.fileIdx !== undefined) magnet += `&so=${stream.fileIdx}`;
            for (const t of tr) magnet += `&tr=${encodeURIComponent(t)}`;
            return new StreamResult({
                url: magnet,
                source: stream.name || stream.title || "Torrent"
            });
        }

        return null;
    }

    async function loadStreams(url, cb) {
        try {
            const data = parsePassData(url);
            if (!data || !data.id || !data.addonType) {
                return cb({ success: false, errorCode: "BAD_STREAM_PAYLOAD", message: "Invalid stream payload" });
            }

            const streamId = data.addonType === "movie"
                ? `${data.imdbId || data.id}`
                : `${data.imdbId || data.id}:${data.season || 1}:${data.episode || 1}`;

            const endpoints = [
                `https://torrentio.strem.fun/stream/${data.addonType}/${streamId}.json`,
                `https://peerflix.mov/stream/${data.addonType}/${streamId}.json`
            ];

            const streams = [];
            for (const ep of endpoints) {
                try {
                    const res = await http_get(ep, UA);
                    const parsed = safeJson(res.body, {});
                    const list = Array.isArray(parsed.streams) ? parsed.streams : [];
                    for (const st of list) {
                        const normalized = normalizeStremioToStream(st);
                        if (normalized) streams.push(normalized);
                    }
                } catch (_) {}
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
