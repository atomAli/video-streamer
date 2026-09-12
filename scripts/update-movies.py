#!/usr/bin/env python3
"""
Update movies.json from ispanechannel.it.com/iranian-movies/ (PersianMovieBox).

- Scrapes the Movies archive pages 1 and 2.
- For each movie: extracts its direct stream link(s).
- Keeps movies that already exist in movies.json even if they are no longer
  on archive pages 1-2 (fetched individually).
- Writes movies.json back (formatted, UTF-8). Only writes when changed.

Needs: aiohttp  (install with: pip install aiohttp)
"""
import asyncio
import html as htmlmod
import json
import os
import re
import sys
import aiohttp

BASE = "https://ispanechannel.it.com"
ARCHIVE_PAGES = [f"{BASE}/iranian-movies/", f"{BASE}/iranian-movies/page/2/"]
OUTPUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "movies.json")
CONCURRENCY = 20
TIMEOUT = 30

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def clean(text):
    text = re.sub(r"<[^>]+>", "", text)
    return htmlmod.unescape(text).strip()


def get_movie_links_from_archive(mhtml):
    movies = []
    seen = set()
    for m in re.finditer(
        r'<a href="(https://ispanechannel\.it\.com/movie/[^"]+/)" '
        r'class="masvideos-LoopMovie-link[^"]*">\s*'
        r'<h3 class="masvideos-loop-movie__title\s+movie__title">(.*?)</h3>',
        mhtml,
        re.S,
    ):
        url = m.group(1).rstrip("/")
        title = clean(m.group(2))
        if url not in seen:
            seen.add(url)
            movies.append((title, url))
    return movies


def get_stream_url(mhtml):
    """Extract stream URLs from video sources, iframes, or embeds."""
    urls = []
    for m in re.finditer(r'<source\s+src="([^"]+)"[^>]*type="video/mp4"', mhtml):
        urls.append(m.group(1))
    for m in re.finditer(r'<source\s+src="([^"]+\.m3u8[^"]*)"', mhtml):
        urls.append(m.group(1))
    if not urls:
        for m in re.finditer(r'src="(https://[^"]+\.(?:mp4|m3u8|mkv|webm))"', mhtml):
            urls.append(m.group(1))
    for m in re.finditer(r'<iframe[^>]*src="([^"]+)"', mhtml):
        u = m.group(1).strip()
        if u and not u.endswith((".js", ".css")):
            urls.append(u)
    if not urls:
        for m in re.finditer(r'href="(https://www\.youtube\.com/watch\?v=[^"]+)"', mhtml):
            urls.append(m.group(1))
    seen = set()
    unique = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            unique.append(u)
    return unique


async def fetch(session, sem, url):
    async with sem:
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=TIMEOUT),
                                   allow_redirects=True) as resp:
                return await resp.text()
        except Exception as exc:
            print(f"  fetch failed ({url}): {exc}", file=sys.stderr)
            return None


async def scrape_movie(session, sem, title, url):
    mhtml = await fetch(session, sem, url)
    if not mhtml:
        return title, None
    return title, {"movie_url": url, "streams": get_stream_url(mhtml)}


async def main():
    sem = asyncio.Semaphore(CONCURRENCY)

    async with aiohttp.ClientSession(headers=HEADERS) as session:
        old = {}
        if os.path.exists(OUTPUT):
            try:
                with open(OUTPUT, "r", encoding="utf-8") as f:
                    old = json.load(f)
            except Exception as exc:
                print(f"  could not read existing movies.json: {exc}", file=sys.stderr)

        # 1) movies from archive pages 1 & 2
        print("Fetching archive pages...", file=sys.stderr)
        movies = []
        seen = set()
        archive_htmls = await asyncio.gather(
            *[fetch(session, sem, page) for page in ARCHIVE_PAGES]
        )
        for mhtml in archive_htmls:
            if not mhtml:
                print("  archive page failed", file=sys.stderr)
                continue
            for title, url in get_movie_links_from_archive(mhtml):
                if url not in seen:
                    seen.add(url)
                    movies.append((title, url))

        print(f"Movies on archive pages 1-2: {len(movies)}", file=sys.stderr)

        # 2) old movies no longer on pages 1-2 -> keep & refresh individually
        known = {url for _, url in movies}
        for title, data in old.items():
            url = data.get("movie_url", "")
            if url and url not in known:
                movies.append((title, url))
        print(f"Total movies to process: {len(movies)}", file=sys.stderr)

        # 3) scrape movie pages in parallel
        movie_tasks = [scrape_movie(session, sem, t, u) for t, u in movies]
        movie_results = await asyncio.gather(*movie_tasks)

        new = {}
        for title, entry in movie_results:
            if entry:
                new[title] = entry
            else:
                print(f"  could not fetch movie: {title}", file=sys.stderr)

        # 4) merge: preserve key order of old, then new movies
        merged = {}
        for title in old:
            if title in new:
                merged[title] = new[title]
        for title, entry in new.items():
            if title not in merged:
                merged[title] = entry

        output = json.dumps(merged, ensure_ascii=False, indent=2) + "\n"

        if old == merged:
            print("No changes.", file=sys.stderr)
            return

        with open(OUTPUT, "w", encoding="utf-8") as f:
            f.write(output)

        stream_count = sum(len(e["streams"]) for e in merged.values())
        print(f"Updated movies.json: {len(merged)} movies, {stream_count} stream links.",
              file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())