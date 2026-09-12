/*
 * Build TV app files from the GitHub data sources.
 *
 * Inputs:
 *   - serials.json   (dict: show → {show_url, episodes:[{title,url,streams}]})
 *   - movies.json    (dict: film → {movie_url, streams})
 *   - templates/serial_index.html, templates/film_index.html  (host skeletons
 *     with the no-referrer meta preserved; contain __CVP_*_INLINE_DATA__ tokens)
 *
 * Output (dist/tv/):
 *   - serial/index.html                   inline window.__CVP_SERIALS_INLINE__
 *   - film/index.html                     inline window.__CVP_FILMS_INLINE__
 *   - panel-data/serials.js, serials.json window.__CVP_SERIALS__ + raw json
 *   - panel-data/films.js,   films.json   window.__CVP_FILMS__ + raw json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'tv');

const SERIAL_TOKEN = '__CVP_SERIALS_INLINE_DATA__';
const FILM_TOKEN = '__CVP_FILMS_INLINE_DATA__';

function readJson(rel) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
    return JSON.parse(raw);
}

function pretty(obj) {
    return JSON.stringify(obj, null, 2) + '\n';
}

// Inline data is embedded minified (matching the host's current pages).
// Escape "</script" so inline data can never break out of its <script> block;
// "\/" is valid JSON (equal to "/") so it round-trips cleanly.
function forInline(obj) {
    return JSON.stringify(obj).replace(/<\//g, '<\\/');
}

function fillTemplate(rel, token, content) {
    let tpl = fs.readFileSync(path.join(ROOT, 'templates', rel), 'utf-8');
    if (!tpl.includes(token)) {
        throw new Error(`Template ${rel} is missing token ${token}`);
    }
    return tpl.replace(token, content);
}

function write(rel, content) {
    const dst = path.join(DIST, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, content, 'utf-8');
    console.log(`  wrote dist/tv/${rel} (${Buffer.byteLength(content, 'utf-8')} bytes)`);
}

function main() {
    const serials = readJson('serials.json');
    const movies = readJson('movies.json');

    console.log(`Serials: ${Object.keys(serials).length} shows`);
    console.log(`Movies:  ${Object.keys(movies).length} films`);

    const serialsPretty = pretty(serials);
    const moviesPretty = pretty(movies);

    // Pages (inline data)
    write('serial/index.html', fillTemplate('serial_index.html', SERIAL_TOKEN, forInline(serials)));
    write('film/index.html', fillTemplate('film_index.html', FILM_TOKEN, forInline(movies)));

    // Panel data (raw pretty json + js global)
    write('panel-data/serials.js', 'window.__CVP_SERIALS__ = ' + serialsPretty);
    write('panel-data/serials.json', serialsPretty);
    write('panel-data/films.js', 'window.__CVP_FILMS__ = ' + moviesPretty);
    write('panel-data/films.json', moviesPretty);

    console.log(`\nDone. Output: ${DIST}`);
}

main();