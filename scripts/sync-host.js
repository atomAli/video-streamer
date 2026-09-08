/*
 * Sync GitHub videos.json → FTP host videos.js
 *
 * This script is run by GitHub Actions after every change to videos.json.
 * It:
 *   1. Reads the GitHub repo's videos.json (list of {title, url} entries)
 *   2. Downloads the current videos.js from the FTP host
 *   3. Replaces only the "ویدیوهای من" (My Videos) group with GitHub data
 *   4. Preserves all other groups (uptv films, series, anime, etc.)
 *   5. Uploads the rebuilt videos.js
 *   6. Also uploads my-videos.json (flat list) for the panel data
 */

const { Client } = require('basic-ftp');
const fs = require('fs');
const path = require('path');
const { PassThrough, Readable } = require('stream');

const BASE = '/public_html';
const VIDEOS_JS_PATH = BASE + '/videos.js';
const MY_VIDEOS_JSON_PATH = BASE + '/tv/panel-data/my-videos.json';
const UPTV_JSON_PATH = BASE + '/tv/panel-data/uptv.json';
const MY_GROUP_NAME = 'ویدیوهای من';

function getFtpClient() {
    const client = new Client();
    return client.access({
        host: process.env.FTP_HOST,
        user: process.env.FTP_USER,
        password: process.env.FTP_PASSWORD,
        port: parseInt(process.env.FTP_PORT || '21', 10),
        secure: false
    }).then(() => client);
}

async function ftpRead(client, remotePath) {
    const pt = new PassThrough();
    const chunks = [];
    pt.on('data', (c) => chunks.push(c));
    await client.downloadTo(pt, remotePath);
    return Buffer.concat(chunks).toString('utf-8');
}

async function ftpWrite(client, remotePath, content) {
    const stream = Readable.from([Buffer.from(content, 'utf-8')]);
    await client.uploadFrom(stream, remotePath);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function syncOnce(myVideos) {
    // Fresh connection each attempt (a timed-out data connection leaves the old one unreliable)
    const client = await getFtpClient();
    console.log('Connected to FTP');

    try {
        // 1. Read uptv groups from tv/panel-data/uptv.json (stable source on host)
        let uptvGroups = [];
        try {
            const uptvRaw = await ftpRead(client, UPTV_JSON_PATH);
            const parsed = JSON.parse(uptvRaw);
            if (Array.isArray(parsed)) {
                uptvGroups = parsed.filter((g) => g && g.name && g.name !== MY_GROUP_NAME);
            }
            console.log(`Host uptv.json: ${uptvGroups.length} uptv groups found`);
            uptvGroups.forEach((g, i) => {
                console.log(`  ${i}: "${g.name}" (${(g.videos || []).length} videos)`);
            });
        } catch (e) {
            console.log('Could not read uptv.json, will create fresh videos.js', e.message);
        }

        // 2. Rebuild: my group (from GitHub) + uptv groups (from host uptv.json)
        const allGroups = [
            { name: MY_GROUP_NAME, videos: myVideos },
            ...uptvGroups
        ];

        // 3. Write my-videos.json FIRST (secondary), then videos.js (TV page) LAST
        //    so that if one upload fails mid-run, the primary file stays consistent.
        const myJson = JSON.stringify(myVideos, null, 2) + '\n';
        await ftpWrite(client, MY_VIDEOS_JSON_PATH, myJson);
        console.log(`Uploaded ${MY_VIDEOS_JSON_PATH} (${myJson.length} bytes)`);

        // 4. Write videos.js (the TV page reads this via script injection)
        const videosJs = 'window.__CVP_VIDEOS__ = ' + JSON.stringify(allGroups, null, 2) + ';\n';
        await ftpWrite(client, VIDEOS_JS_PATH, videosJs);
        console.log(`Uploaded ${VIDEOS_JS_PATH} (${videosJs.length} bytes)`);

        // Summary
        console.log(`\nDone. videos.js now has ${allGroups.length} groups.`);
        allGroups.forEach((g, i) => {
            console.log(`  ${i}: "${g.name}" (${(g.videos || []).length} videos)`);
        });
    } finally {
        client.close();
    }
}

async function main() {
    // 1. Read GitHub videos.json
    const videosJsonPath = path.join(process.cwd(), 'videos.json');
    let myVideos;
    try {
        const raw = fs.readFileSync(videosJsonPath, 'utf-8');
        myVideos = JSON.parse(raw);
        if (!Array.isArray(myVideos)) myVideos = [];
    } catch (e) {
        console.error('Failed to read videos.json:', e.message);
        process.exit(1);
    }
    console.log(`GitHub videos.json: ${myVideos.length} videos`);

    // 2. Sync with retries. Transient FTP timeouts on the data connection are common,
    //    so retry the whole operation with a fresh connection a few times.
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await syncOnce(myVideos);
            return;
        } catch (e) {
            lastErr = e;
            console.error(`Sync attempt ${attempt} failed: ${e.message}`);
            if (attempt < 3) {
                console.log(`Retrying in ${attempt * 5}s...`);
                await sleep(attempt * 5000);
            }
        }
    }
    throw lastErr;
}

main().catch((e) => {
    console.error('Sync failed after retries:', e);
    process.exit(1);
});
