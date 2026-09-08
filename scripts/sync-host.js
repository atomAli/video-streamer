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

function extractGroupsFromJs(jsContent) {
    const match = jsContent.match(/__CVP_VIDEOS__\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!match) return [];
    try {
        return JSON.parse(match[1]);
    } catch (e) {
        console.error('Failed to parse existing videos.js:', e.message);
        return [];
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

    // 2. Connect to FTP
    const client = await getFtpClient();
    console.log('Connected to FTP');

    try {
        // 3. Read current videos.js from host (to preserve uptv groups)
        let existingGroups = [];
        try {
            const existingJs = await ftpRead(client, VIDEOS_JS_PATH);
            existingGroups = extractGroupsFromJs(existingJs);
            console.log(`Host videos.js: ${existingGroups.length} groups found`);
            existingGroups.forEach((g, i) => {
                console.log(`  ${i}: "${g.name}" (${(g.videos || []).length} videos)`);
            });
        } catch (e) {
            console.log('Could not read existing videos.js, will create fresh');
        }

        // 4. Rebuild: keep uptv groups, replace "ویدیوهای من" with GitHub data
        const uptvGroups = existingGroups.filter((g, i) => {
            // Keep everything that is NOT the first "ویدیوهای من" group
            if (i === 0 && g.name === MY_GROUP_NAME) return false;
            // Also filter by name to catch any reordering
            if (g.name === MY_GROUP_NAME) return false;
            return true;
        });

        const allGroups = [
            { name: MY_GROUP_NAME, videos: myVideos },
            ...uptvGroups
        ];

        // 5. Write videos.js (the TV page reads this via script injection)
        const videosJs = 'window.__CVP_VIDEOS__ = ' + JSON.stringify(allGroups, null, 2) + ';\n';
        await ftpWrite(client, VIDEOS_JS_PATH, videosJs);
        console.log(`Uploaded ${VIDEOS_JS_PATH} (${videosJs.length} bytes)`);

        // 6. Write my-videos.json (the panel reads this)
        const myJson = JSON.stringify(myVideos, null, 2) + '\n';
        await ftpWrite(client, MY_VIDEOS_JSON_PATH, myJson);
        console.log(`Uploaded ${MY_VIDEOS_JSON_PATH} (${myJson.length} bytes)`);

        // Summary
        console.log(`\nDone. videos.js now has ${allGroups.length} groups.`);
        allGroups.forEach((g, i) => {
            console.log(`  ${i}: "${g.name}" (${(g.videos || []).length} videos)`);
        });
    } finally {
        client.close();
    }
}

main().catch((e) => {
    console.error('Sync failed:', e);
    process.exit(1);
});
