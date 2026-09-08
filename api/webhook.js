/*
 * Telegram Bot Webhook - Vercel Serverless Function
 * Manages videos.json in GitHub repo via Telegram commands.
 *
 * Commands:
 *   /add <title> <url>  - Add a video
 *   /remove <index>     - Remove a video by index
 *   /list               - List all videos
 *   /help               - Show help
 */

const GITHUB_API = 'https://api.github.com';

function getConfig() {
    return {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        githubToken: process.env.GITHUB_TOKEN,
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO || 'video-streamer',
        branch: process.env.GITHUB_BRANCH || 'main',
        listFile: 'videos.json',
        allowedIds: (process.env.ALLOWED_TELEGRAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
    };
}

function isAllowed(userId, config) {
    if (config.allowedIds.length === 0) return true;
    return config.allowedIds.includes(String(userId));
}

async function tgSendMessage(chatId, text, config) {
    await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
}

async function githubGetFile(config) {
    const url = `${GITHUB_API}/repos/${config.owner}/${config.repo}/contents/${config.listFile}?ref=${config.branch}`;
    const res = await fetch(url, {
        headers: {
            'Authorization': `token ${config.githubToken}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
    return await res.json();
}

async function githubUpdateFile(config, content, message, sha) {
    const url = `${GITHUB_API}/repos/${config.owner}/${config.repo}/contents/${config.listFile}`;
    const body = {
        message,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
        branch: config.branch
    };
    if (sha) body.sha = sha;

    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${config.githubToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`GitHub PUT failed: ${res.status} ${err}`);
    }
    return await res.json();
}

async function getVideos(config) {
    const file = await githubGetFile(config);
    if (!file) return { videos: [], sha: null };
    const decoded = Buffer.from(file.content, 'base64').toString('utf-8');
    const videos = JSON.parse(decoded);
    return { videos, sha: file.sha };
}

async function addVideo(config, title, url) {
    const { videos, sha } = await getVideos(config);
    videos.push({ title, url });
    await githubUpdateFile(config, videos, `Add video: ${title}`, sha);
    return videos.length;
}

async function removeVideo(config, index) {
    const { videos, sha } = await getVideos(config);
    if (index < 0 || index >= videos.length) return null;
    const removed = videos.splice(index, 1)[0];
    await githubUpdateFile(config, videos, `Remove video: ${removed.title}`, sha);
    return removed;
}

function formatList(videos) {
    if (videos.length === 0) return 'No videos yet.';
    let text = '<b>Videos:</b>\n\n';
    videos.forEach((v, i) => {
        text += `<code>${i}</code> - ${v.title}\n`;
    });
    return text;
}

function parseArgs(text, command) {
    const stripped = text.replace(new RegExp(`^/${command}\\s*`, 'i'), '').trim();
    return stripped;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).json({ ok: true });
    }

    const config = getConfig();

    try {
        const update = req.body;

        if (!update.message) {
            return res.status(200).json({ ok: true });
        }

        const msg = update.message;
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const text = (msg.text || '').trim();

        if (!isAllowed(userId, config)) {
            await tgSendMessage(chatId, 'Unauthorized.', config);
            return res.status(200).json({ ok: true });
        }

        if (!text.startsWith('/')) {
            return res.status(200).json({ ok: true });
        }

        const command = text.split(/\s/)[0].toLowerCase();

        if (command === '/start' || command === '/help') {
            const help = [
                '<b>Video Streamer Bot</b>',
                '',
                '/add <code>&lt;title&gt; &lt;url&gt;</code> - Add a video',
                '/remove <code>&lt;index&gt;</code> - Remove by index',
                '/list - List all videos',
                '/help - Show this help'
            ].join('\n');
            await tgSendMessage(chatId, help, config);

        } else if (command === '/list') {
            const { videos } = await getVideos(config);
            await tgSendMessage(chatId, formatList(videos), config);

        } else if (command === '/add') {
            const args = parseArgs(text, 'add');
            const spaceIdx = args.indexOf(' ');
            if (spaceIdx === -1 || !args) {
                await tgSendMessage(chatId, 'Usage: /add <code>&lt;title&gt; &lt;url&gt;</code>', config);
            } else {
                const title = args.substring(0, spaceIdx).trim();
                const url = args.substring(spaceIdx + 1).trim();
                const count = await addVideo(config, title, url);
                await tgSendMessage(chatId, `Added. Total: ${count} videos.`, config);
            }

        } else if (command === '/remove') {
            const args = parseArgs(text, 'remove');
            const index = parseInt(args, 10);
            if (isNaN(index)) {
                await tgSendMessage(chatId, 'Usage: /remove <code>&lt;index&gt;</code>', config);
            } else {
                const removed = await removeVideo(config, index);
                if (!removed) {
                    await tgSendMessage(chatId, 'Invalid index.', config);
                } else {
                    await tgSendMessage(chatId, `Removed: ${removed.title}`, config);
                }
            }

        } else {
            await tgSendMessage(chatId, 'Unknown command. Use /help', config);
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Bot error:', err);
        return res.status(200).json({ ok: true });
    }
}
