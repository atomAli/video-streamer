/*
 * GET /api/videos
 *   Default: returns JSON { videos: [...] } for modern browsers (XHR/fetch).
 *   ?callback=name : returns JS that calls window.__CVP_VIDEOS__ = [...] for
 *                    old TV browsers (2016 WebKit) that load it via <script>
 *                    injection (no CORS, like the original Tizen app).
 */

const GITHUB_API = 'https://api.github.com';

export default async function handler(req, res) {
    try {
        const owner = process.env.GITHUB_OWNER;
        const repo = process.env.GITHUB_REPO || 'video-streamer';
        const branch = process.env.GITHUB_BRANCH || 'main';

        let videos = [];
        if (owner) {
            const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/videos.json?ref=${branch}`;
            const ghRes = await fetch(url, {
                headers: {
                    'Authorization': `token ${process.env.GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (ghRes.status === 404) {
                videos = [];
            } else if (ghRes.ok) {
                const file = await ghRes.json();
                const decoded = Buffer.from(file.content, 'base64').toString('utf-8');
                videos = JSON.parse(decoded);
            } else {
                throw new Error(`GitHub fetch failed: ${ghRes.status}`);
            }
        }

        res.setHeader('Cache-Control', 'no-store');

        const callback = req.query && req.query.callback;
        if (callback) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            const json = JSON.stringify({ videos });
            return res.status(200).send(`window.__CVP_VIDEOS__=${json};`);
        }

        return res.status(200).json({ videos });
    } catch (err) {
        console.error('videos endpoint error:', err.message);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ videos: [] });
    }
}
