const BASE_URL = "https://hanime.tv";
const SEARCH_URL = "https://search.htv-services.com/";
const VIDEO_API = "https://hanime.tv/api/v8/video?id=";

const DEFAULT_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*"
};

async function searchResults(keyword) {
    try {
        const body = JSON.stringify({
            blacklist: [],
            brands: [],
            order_by: "title_sortable",
            ordering: "asc",
            page: 0,
            search_text: keyword,
            tags: [],
            tags_mode: "AND"
        });

        const response = await soraFetch(SEARCH_URL, {
            headers: {
                ...DEFAULT_HEADERS,
                "Content-Type": "application/json;charset=UTF-8"
            },
            method: "POST",
            body
        });

        if (!response) throw new Error("No response from Hanime search API");

        const json = await response.json();
        let hits = [];

        if (typeof json.hits === "string") {
            hits = JSON.parse(json.hits);
        } else if (Array.isArray(json.hits)) {
            hits = json.hits;
        }

        const results = [];

        for (const item of hits) {
            if (!item) continue;

            const slug = item.slug || item.id || "";
            const title = item.name || item.title || slug;
            if (!slug) continue;

            const image =
                item.poster_url ||
                item.cover_url ||
                item.poster ||
                item.thumbnail ||
                "";

            results.push({
                title,
                image,
                href: `${BASE_URL}/hentai/${slug}`
            });
        }

        return JSON.stringify(results);
    } catch (error) {
        console.log("Fetch error in searchResults:", error);
        return JSON.stringify([{ title: "Error", image: "", href: "" }]);
    }
}

async function extractDetails(url) {
    try {
        const slug = extractSlug(url);
        if (!slug) throw new Error("Could not extract Hanime video slug");

        const data = await getVideoData(slug);
        const video = data?.hentai_video || {};
        const franchise = data?.hentai_franchise || {};

        let description = stripHtml(video.description || "");
        if (!description) description = "No description available";

        let aliases = "";
        if (Array.isArray(video.hentai_tags)) {
            aliases = video.hentai_tags
                .map(tag => typeof tag === "string" ? tag : (tag?.text || tag?.name || ""))
                .filter(Boolean)
                .join(", ");
        }

        if (franchise.title) {
            aliases += (aliases ? " | " : "") + `Franchise: ${franchise.title}`;
        }

        let airdate = "Released: Unknown";
        const releaseValue =
            video.released_at ||
            video.released_at_unix ||
            video.created_at;

        if (releaseValue) {
            airdate = `Released: ${formatDate(releaseValue)}`;
        }

        return JSON.stringify([{
            description,
            aliases: aliases || "No tags available",
            airdate
        }]);
    } catch (error) {
        console.log("Details error:", error);
        return JSON.stringify([{
            description: "Error loading description",
            aliases: "No tags available",
            airdate: "Released: Unknown"
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        const slug = extractSlug(url);
        if (!slug) throw new Error("Could not extract Hanime video slug");

        const data = await getVideoData(slug);
        const franchiseVideos = data?.hentai_franchise_hentai_videos;
        const results = [];

        if (Array.isArray(franchiseVideos) && franchiseVideos.length > 0) {
            let number = 1;

            for (const video of franchiseVideos) {
                if (!video) continue;

                const videoSlug = video.slug || video.id;
                if (!videoSlug) continue;

                results.push({
                    href: `${BASE_URL}/hentai/${videoSlug}`,
                    number: number++
                });
            }
        }

        if (results.length === 0) {
            results.push({ href: url, number: 1 });
        }

        return JSON.stringify(results);
    } catch (error) {
        console.log("Fetch error in extractEpisodes:", error);
        return JSON.stringify([{ href: url, number: 1 }]);
    }
}

async function extractStreamUrl(url) {
    try {
        console.log("Input URL: " + url);

        const slug = extractSlug(url);
        if (!slug) throw new Error("Invalid Hanime URL");

        const data = await getVideoData(slug);
        const servers = data?.videos_manifest?.servers;

        if (!Array.isArray(servers)) {
            throw new Error("No video manifest/server list found");
        }

        const streams = [];
        const seen = new Set();

        for (const server of servers) {
            if (!server) continue;

            const serverName = server.name || "Hanime";
            const serverStreams = Array.isArray(server.streams)
                ? server.streams
                : [];

            const valid = serverStreams
                .filter(stream =>
                    stream &&
                    typeof stream.url === "string" &&
                    stream.url.length > 0
                )
                .sort((a, b) => Number(b.height || 0) - Number(a.height || 0));

            for (const stream of valid) {
                if (seen.has(stream.url)) continue;
                seen.add(stream.url);

                const height = Number(stream.height || 0);
                const title = height > 0
                    ? `${serverName} ${height}p`
                    : serverName;

                streams.push({
                    title,
                    streamUrl: stream.url,
                    headers: {
                        Referer: `${BASE_URL}/`
                    }
                });
            }
        }

        streams.sort((a, b) => {
            const ah = Number((a.title.match(/(\d+)p/) || [0, 0])[1]);
            const bh = Number((b.title.match(/(\d+)p/) || [0, 0])[1]);
            return bh - ah;
        });

        return JSON.stringify({
            streams,
            subtitles: ""
        });
    } catch (error) {
        console.log("Fetch error in extractStreamUrl:", error);
        return JSON.stringify({
            streams: [],
            subtitles: ""
        });
    }
}

function extractSlug(url) {
    if (!url || typeof url !== "string") return null;

    try {
        const parsed = new URL(url);
        const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");

        for (const marker of ["hentai", "hentai-videos", "video"]) {
            const index = parts.indexOf(marker);
            if (index >= 0 && parts[index + 1]) {
                return decodeURIComponent(parts[index + 1]);
            }
        }

        return parts.length ? decodeURIComponent(parts[parts.length - 1]) : null;
    } catch (error) {
        console.log("Slug extraction error:", error);
        return null;
    }
}

async function getVideoData(slug) {
    const apiUrl = VIDEO_API + encodeURIComponent(slug);

    const response = await soraFetch(apiUrl, {
        headers: DEFAULT_HEADERS,
        method: "GET"
    });

    if (!response) throw new Error("No response from Hanime video API");

    const data = await response.json();
    if (!data) throw new Error("Empty response from Hanime API");

    return data;
}

function stripHtml(html) {
    if (!html) return "";

    return String(html)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .trim();
}

function formatDate(value) {
    try {
        if (typeof value === "number" || /^\d+$/.test(String(value))) {
            let timestamp = Number(value);
            if (timestamp < 100000000000) timestamp *= 1000;
            return new Date(timestamp).toISOString().split("T")[0];
        }

        const date = new Date(value);
        return isNaN(date.getTime())
            ? String(value)
            : date.toISOString().split("T")[0];
    } catch {
        return String(value);
    }
}

async function soraFetch(
    url,
    options = { headers: {}, method: "GET", body: null }
) {
    try {
        return await fetchv2(
            url,
            options.headers ?? {},
            options.method ?? "GET",
            options.body ?? null
        );
    } catch (e) {
        try {
            return await fetch(url, options);
        } catch (error) {
            return null;
        }
    }
}
