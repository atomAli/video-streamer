/*
 * Upload the built TV app files (dist/tv/) to the FTP host.
 *
 * The host keeps two copies of the TV app:
 *   - /tv/...
 *   - /public_html/tv/...   (public_html → ./domains/<user>.parspack.net/public_html)
 * This script uploads every file from dist/tv/ to BOTH trees so they stay in sync.
 *
 * Run after scripts/build-tv.js. Uses FTP_* environment variables (GitHub secrets).
 */

const { Client } = require('basic-ftp');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist', 'tv');
const TARGETS = ['/tv', '/public_html/tv'];

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listFiles(dir, base) {
    const out = [];
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const rel = path.relative(base, full);
        if (fs.statSync(full).isDirectory()) {
            out.push(...listFiles(full, base));
        } else {
            out.push(rel);
        }
    }
    return out;
}

async function uploadOnce() {
    const client = await getFtpClient();
    console.log('Connected to FTP');

    try {
        const files = listFiles(DIST, DIST);
        console.log(`Local dist/tv files to upload: ${files.length}`);
        files.forEach((f) => console.log('  ' + f));

        for (const target of TARGETS) {
            console.log(`\nUploading to ${target} ...`);
            for (const rel of files) {
                const remote = path.posix.join(target, rel.split(path.sep).join('/'));
                const local = path.join(DIST, rel);

                // ensureDir creates the remote path (and parents) if needed
                await client.ensureDir(path.posix.dirname(remote));
                await client.uploadFrom(fs.createReadStream(local), remote);

                const bytes = fs.statSync(local).size;
                console.log(`  OK ${remote} (${bytes} bytes)`);
            }
            console.log(`Done with ${target}`);
        }
    } finally {
        client.close();
    }
}

async function main() {
    if (!fs.existsSync(DIST)) {
        console.error(`dist/tv not found (${DIST}). Run scripts/build-tv.js first.`);
        process.exit(1);
    }

    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await uploadOnce();
            console.log('\nSync complete.');
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