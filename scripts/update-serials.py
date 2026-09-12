#!/usr/bin/env python3
"""
Update serials.json from ispanechannel.it.com (PersianMovieBox).

- Scrapes the TV Shows archive pages 1 and 2.
- For each show: extracts all episodes and their stream links.
- Keeps shows that already exist in serials.json even if they are no longer
  on archive pages 1-2 (fetched individually), so older episodes stay fresh.
- Writes serials.json back (formatted, UTF-8). Only writes when changed.

Needs: aiohttp  (install with: pip install aiohttp)
"""
import asyncio
import json
import os
import re
import sys
import aiohttp

BASE = "https://ispanechannel.it.com"
ARCHIVE_PAGES = [f"{BASE}/serial/", f"{BASE}/serial/page/2/"]
OUTPUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "serials.json")
CONCURRENCY = 20
TIMEOUT = 30

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def get_show_links_from_archive(html):
    """Extract unique show title+URL pairs from an archive page."""
    shows = []
    seen = set()
    for m in re.finditer(
        r'<a href="(https://ispanechannel\.it\.com/tv-show/[^"]+/)" '
        r'class="masvideos-LoopTvShow-link[^"]*"><h3 class="masvideos-loop-tv-show__title  tv-show__title">(.*?)</h3>',
        html,
        re.S,
    ):
        url = m.group(1).rstrip("/")
        title = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if url not in seen:
            seen.add(url)
            shows.append((title, url))
    return shows


def get_episodes_from_show(html):
    """Extract episode title+URL pairs from a show page (main episodes section only)."""
    idx = html.find('class="episodes columns-6"')
    if idx == -1:
        return []
    related = html.find('class="tv-show-related"', idx)
    if related == -1:
        related = len(html)
    segment = html[idx:related]

    episodes = []
    seen = set()
    for m in re.finditer(
        r'<a href="(https://ispanechannel\.it\.com/episode/[^"#]+)" '
        r'class="masvideos-LoopEpisode-link[^"]*">\s*'
        r'<h3 class="masvideos-loop-episode__title\s+episode__title">(.*?)</h3>',
        segment,
        re.S,
    ):
        url = m.group(1).rstrip("/")
        title = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if url not in seen:
            seen.add(url)
            episodes.append((title, url))
    return episodes


def get_stream_url(html):
    """Extract stream URLs from video sources, iframes, or embeds."""
    urls = []
    for m in re.finditer(r'<source\s+src="([^"]+)"[^>]*type="video/mp4"', html):
        urls.append(m.group(1))
    for m in re.finditer(r'<source\s+src="([^"]+\.m3u8[^"]*)"', html):
        urls.append(m.group(1))
    if not urls:
        for m in re.finditer(r'src="(https://[^"]+\.(?:mp4|m3u8|mkv|webm))"', html):
            urls.append(m.group(1))
    for m in re.finditer(r'<iframe[^>]*src="([^"]+)"', html):
        u = m.group(1).strip()
        if u and not u.endswith((".js", ".css")):
            urls.append(u)
    if not urls:
        for m in re.finditer(r'href="(https://www\.youtube\.com/watch\?v=[^"]+)"', html):
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


async def scrape_show_from_archive(session, sem, title, url):
    html = await fetch(session, sem, url)
    if not html:
        return title, None
    entry = {"show_url": url, "episodes": []}
    for ep_title, ep_url in get_episodes_from_show(html):
        entry["episodes"].append({"title": ep_title, "url": ep_url, "streams": []})
    return title, entry


async def fill_streams(session, sem, entry):
    tasks = [fill_episode(session, sem, ep) for ep in entry["episodes"]]
    await asyncio.gather(*tasks)
    return entry


async def fill_episode(session, sem, ep):
    html = await fetch(session, sem, ep["url"])
    if html:
        ep["streams"] = get_stream_url(html)
    return ep


async def main():
    sem = asyncio.Semaphore(CONCURRENCY)

    async with aiohttp.ClientSession(headers=HEADERS) as session:
        old = {}
        if os.path.exists(OUTPUT):
            try:
                with open(OUTPUT, "r", encoding="utf-8") as f:
                    old = json.load(f)
            except Exception as exc:
                print(f"  could not read existing serials.json: {exc}", file=sys.stderr)

        # 1) shows from archive pages 1 & 2
        print("Fetching archive pages...", file=sys.stderr)
        shows = []
        seen = set()
        archive_htmls = await asyncio.gather(
            *[fetch(session, sem, page) for page in ARCHIVE_PAGES]
        )
        for html in archive_htmls:
            if not html:
                print("  archive page failed", file=sys.stderr)
                continue
            for title, url in get_show_links_from_archive(html):
                if url not in seen:
                    seen.add(url)
                    shows.append((title, url))

        print(f"Shows on archive pages 1-2: {len(shows)}", file=sys.stderr)

        # 2) old shows no longer on pages 1-2 -> keep & refresh individually
        known = {url for _, url in shows}
        for title, data in old.items():
            url = data.get("show_url", "")
            if url and url not in known:
                shows.append((title, url))
        print(f"Total shows to process: {len(shows)}", file=sys.stderr)

        # 3) scrape show pages in parallel
        show_tasks = [scrape_show_from_archive(session, sem, t, u) for t, u in shows]
        show_results = await asyncio.gather(*show_tasks)

        new = {}
        for title, entry in show_results:
            if entry:
                new[title] = entry
            else:
                print(f"  could not fetch show: {title}", file=sys.stderr)

        # 4) scrape episode streams in parallel
        total_eps = sum(len(e["episodes"]) for e in new.values())
        print(f"Fetching streams for {total_eps} episodes...", file=sys.stderr)
        stream_tasks = [fill_streams(session, sem, entry) for entry in new.values()]
        await asyncio.gather(*stream_tasks)

        # 5) merge: preserve key order of old, then new shows
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

        ep_count = sum(len(e["episodes"]) for e in merged.values())
        stream_count = sum(
            sum(len(ep["streams"]) for ep in e["episodes"]) for e in merged.values()
        )
        print(f"Updated serials.json: {len(merged)} shows, {ep_count} episodes, "
              f"{stream_count} stream links.", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())