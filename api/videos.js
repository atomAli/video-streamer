/*
 * GET /api/videos - returns the video list from GitHub videos.json.
 * Sets long cache headers so repeated page loads are fast,
 * but the Telegram bot invalidates via GitHub raw timestamps.
 */

const GITHUB_API = 'https://api.github.com';

export default async function handler(req, res) {
    try {
        const owner = process.env.GITHUB_OWNER;
        const repo = process.env.GITHUB_REPO || 'video-streamer';
        const branch = process.env.GITHUB_BRANCH || 'main';

        if (!owner) {
            return res.status(500).json({ error: 'GITHUB_OWNER not set', videos: [] });
        }

        const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/videos.json?ref=${branch}`;
        const ghRes = await fetch(url, {
            headers: {
                'Authorization': `token ${process.env.GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (ghRes.status === 404) {
            return res.status(200).json({ videos: [] });
        }

        if (!ghRes.ok) {
            throw new Error(`GitHub fetch failed: ${ghRes.status}`);
        }

        const file = await ghRes.json();
        const decoded = Buffer.from(file.content, 'base64').toString('utf-8');
        const videos = JSON.parse(decoded);

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ videos });
    } catch (err) {
        console.error('videos endpoint error:', err.message);
        return res.status(500).json({ error: 'Failed to load videos', videos: [] });
    }
}
