/*
 * Telegram Bot Webhook - Vercel Serverless Function
 * Persian, button-driven UX for low-tech users.
 *
 *  - Paste any link -> bot offers to add it (confirm with a button)
 *  - /list shows delete buttons next to each video
 *  - /start, /help, /add, /remove still work
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

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescHtml = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function tgApi(config, method, payload) {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) console.error(`${method} failed:`, res.status, JSON.stringify(body));
    return body;
}

const sendMessage = (config, chatId, text, keyboard, parseMode = 'HTML') =>
    tgApi(config, 'sendMessage', {
        chat_id: chatId, text, parse_mode: parseMode,
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {})
    });

const editMessage = (config, chatId, messageId, text, keyboard = null) =>
    tgApi(config, 'editMessageText', {
        chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
        ...(keyboard !== null ? { reply_markup: { inline_keyboard: keyboard } } : {})
    });

const answerCallback = (config, callbackId, text = '') =>
    tgApi(config, 'answerCallbackQuery', { callback_query_id: callbackId, text });

const row = (btns) => btns;
const btn = (text, data) => ({ text, callback_data: data });

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
    if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status} ${await res.text()}`);
    return await res.json();
}

async function getVideos(config) {
    const file = await githubGetFile(config);
    if (!file) return { videos: [], sha: null };
    return {
        videos: JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8')),
        sha: file.sha
    };
}

async function mutateVideos(config, mutate, commitMsg) {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
        const { videos, sha } = await getVideos(config);
        const detail = await mutate(videos);
        try {
            await githubUpdateFile(config, videos, commitMsg, sha);
            return detail;
        } catch (e) {
            lastErr = e;
            if (!/409|SHA|sha|conflict/i.test(String(e.message))) throw e;
            await sleep(300 * (attempt + 1));
        }
    }
    throw lastErr;
}

function findUrl(text) {
    const m = text.match(/https?:\/\/[^\s]+/i);
    return m ? m[0] : null;
}

function parseMessage(text) {
    const clean = String(text || '').replace(/^\/add\s+/i, '').trim();
    const url = findUrl(clean);
    if (!url) return null;
    const before = clean.slice(0, clean.indexOf(url)).trim();
    return { title: before || null, url };
}

const HELP_TEXT = [
    '<b>🎬 ربات ویدیو</b>',
    '',
    'برای <b>اضافه کردن</b> ویدیو، همینطوری <b>لینک</b> ویدیو رو بفرست.',
    'مثلاً:',
    '<code>https://example.com/movie.mp4</code>',
    '',
    'اگه بخوای <b>اسم</b> داشته باشه، اول اسم رو بنویس، بعد لینک:',
    '<code>فیلم جدید https://example.com/movie.mp4</code>',
    '',
    'برای دیدن لیست: /list',
    'برای حذف: توی لیست روی دکمه 🗑 بزن.'
].join('\n');

const NO_URL_TEXT = [
    '😅 این که فرستادی، لینک ویدیو نبود.',
    '',
    'کافیه <b>لینک ویدیو</b> رو اینجا بفرستی تا اضافهش کنم.',
    'مثلاً:',
    '<code>https://example.com/movie.mp4</code>',
    '',
    'یا برای دیدن ویدیوها: <b>/list</b>'
].join('\n');

function addConfirmText(title, url) {
    return [
        '<b>➕ افزودن ویدیو جدید</b>',
        '',
        `🎬 ${escHtml(title || 'ویدیو')}`,
        `🔗 <code>${escHtml(url)}</code>`,
        '',
        'میخوای اضافهکنم؟'
    ].join('\n');
}

function parseConfirmText(text) {
    const lines = String(text || '').replace(/<[^>]*>/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    const url = findUrl(lines.join('\n'));
    let title = null;
    for (const line of lines) {
        const m = line.match(/^\s*🎬\s*(.+)/);
        if (m) { title = m[1].trim(); break; }
    }
    return { title: title && title !== 'ویدیو' && title.trim() ? title.trim() : null, url };
}

function listMessageText(videos, offset) {
    if (!videos.length) return ['<b>📄 لیست ویدیوها</b>', '', 'هنوز ویدیویی اضافه نشده.', '', 'اولین ویدیو رو با فرستادن لینکش اضافه کن! 🚀'].join('\n');
    const lines = ['<b>📄 لیست ویدیوها</b>', ''];
    videos.forEach((v, i) => {
        lines.push(`<code>${i}</code> — ${escHtml(v.title)}`);
    });
    return lines.join('\n');
}

function listKeyboard(videos) {
    const kb = [];
    videos.forEach((v, i) => {
        kb.push([btn(`🗑 ${truncate(v.title, 28)}`, `del_${i}`)]);
    });
    kb.push([btn('➕ اضافه کردن ویدیو', 'add_hint'), btn('🔄 تازهسازی', 'list')]);
    return kb;
}

async function sendList(config, chatId) {
    const { videos, sha } = await getVideos(config);
    return sendMessage(config, chatId, listMessageText(videos), listKeyboard(videos));
}

async function sendConfirmDelete(config, chatId, videos, index) {
    const video = videos[index];
    if (!video) {
        return sendMessage(config, chatId, '❌ این ویدیو دیگه وجود نداره. لیست رو تازه کن:\n/list');
    }
    return sendMessage(config, chatId,
        `🗑 <b>حذف این ویدیو؟</b>\n\n🎬 ${escHtml(video.title)}`,
        [[btn('✅ بله، حذف کن', `del_yes_${index}`), btn('❌ نه', 'del_no')]]
    );
}

async function handleCallback(config, cb) {
    const chatId = cb.message?.chat?.id;
    const messageId = cb.message?.message_id;
    const userId = cb.from?.id;
    const data = cb.data || '';

    if (!chatId || !messageId) { await answerCallback(config, cb.id, 'مشکلی پیش اومد'); return; }
    if (!isAllowed(userId, config)) { await answerCallback(config, cb.id, '⛔️ دسترسی ندارید'); return; }

    if (data === 'add_confirm') {
        const { title, url } = parseConfirmText(cb.message?.text || '');
        if (!url) {
            await answerCallback(config, cb.id, 'لینکی پیدا نکردم');
            return;
        }
        const finalTitle = title || 'ویدیو';
        await answerCallback(config, cb.id, 'در حال اضافه کردن…');
        await mutateVideos(config, (v) => { v.push({ title: finalTitle, url }); return null; }, `Add video: ${finalTitle}`);
        await editMessage(config, chatId, messageId, `✅ <b>اضافه شد!</b>\n\n🎬 ${escHtml(finalTitle)}`, []);
        return;
    }

    if (data === 'add_cancel') {
        await answerCallback(config, cb.id, 'لغو شد');
        await editMessage(config, chatId, messageId, '❌ اضافه نشد.', []);
        return;
    }

    if (data === 'add_hint') {
        await answerCallback(config, cb.id, '');
        await sendMessage(config, chatId, NO_URL_TEXT);
        return;
    }

    if (data === 'list') {
        await answerCallback(config, cb.id, '');
        await editMessage(config, chatId, messageId, 'در حال بهروزرسانی…', []);
        await sendList(config, chatId);
        return;
    }

    if (data.startsWith('del_yes_')) {
        const index = parseInt(data.split('_')[2], 10);
        await answerCallback(config, cb.id, 'در حال حذف…');
        const removed = await mutateVideos(config, (v) => {
            if (index < 0 || index >= v.length) return null;
            return v.splice(index, 1)[0];
        }, `Remove video: ${index}`);
        if (removed) {
            await editMessage(config, chatId, messageId, `✅ <b>حذف شد:</b> ${escHtml(removed.title)}\n\nبرای دیدن لیست جدید: /list`, []);
        } else {
            await editMessage(config, chatId, messageId, '⚠️ این ویدیو دیگه وجود نداشت.', []);
        }
        return;
    }

    if (data.startsWith('del_')) {
        const index = parseInt(data.split('_')[1], 10);
        const { videos } = await getVideos(config);
        if (isNaN(index) || index < 0 || index >= videos.length) {
            await answerCallback(config, cb.id, 'این ویدیو دیگه نیست');
            return;
        }
        await sendConfirmDelete(config, chatId, videos, index);
        await answerCallback(config, cb.id, '');
        return;
    }

    if (data === 'del_no') {
        await answerCallback(config, cb.id, 'باشه، حذف نشد');
        await editMessage(config, chatId, messageId, '❌ حذف نشد.', []);
        return;
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(data || '{}')); }
            catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).json({ ok: true });
    }

    const config = getConfig();

    try {
        const update = await readBody(req).catch(() => req.body || {});

        if (update.callback_query) {
            await handleCallback(config, update.callback_query);
            return res.status(200).json({ ok: true });
        }

        if (!update.message) {
            return res.status(200).json({ ok: true });
        }

        const msg = update.message;
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const text = (msg.text || '').trim();

        if (!isAllowed(userId, config)) {
            await sendMessage(config, chatId, '⛔️ شما به این ربات دسترسی ندارید.');
            return res.status(200).json({ ok: true });
        }

        const command = text.split(/\s/)[0].toLowerCase();

        if (command === '/start' || command === '/help') {
            await sendMessage(config, chatId, HELP_TEXT);
            return res.status(200).json({ ok: true });
        }

        if (command === '/list') {
            await sendList(config, chatId);
            return res.status(200).json({ ok: true });
        }

        if (command === '/add' || findUrl(text)) {
            const parsed = parseMessage(text);
            if (!parsed) {
                await sendMessage(config, chatId, 'یک لینک معتبر بفرست، مثلاً:\n<code>https://example.com/movie.mp4</code>');
            } else {
                await sendMessage(config, chatId, addConfirmText(parsed.title, parsed.url), [
                    [btn('✅ بله، اضافه کن', 'add_confirm'), btn('❌ نه', 'add_cancel')]
                ]);
            }
            return res.status(200).json({ ok: true });
        }

        if (command === '/remove') {
            const tokens = text.trim().split(/\s+/);
            const index = parseInt(tokens[1], 10);
            const { videos } = await getVideos(config);
            if (isNaN(index)) {
                await sendMessage(config, chatId, 'شماره ویدیو رو بعد از /remove بفرست، مثلاً:\n<code>/remove 2</code>');
            } else {
                await sendConfirmDelete(config, chatId, videos, index);
            }
            return res.status(200).json({ ok: true });
        }

        await sendMessage(config, chatId, NO_URL_TEXT);
        return res.status(200).json({ ok: true });

    } catch (err) {
        console.error('Bot error:', err);
        return res.status(200).json({ ok: true });
    }
}