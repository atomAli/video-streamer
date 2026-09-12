/*
 * App - fetches video list from GitHub and handles navigation.
 */
(function () {
    'use strict';

    var CACHE_KEY = 'streamer_videos_v2';
    var CACHE_TTL_MS = 6 * 60 * 60 * 1000;

    var state = 'boot';
    var videos = [];
    var focusedIndex = 0;

    var loadingEl, errorEl, errorMsgEl;
    var listViewEl, listEl, countEl;

    function $(id) {
        return document.getElementById(id);
    }

    function getSource() {
        return window.APP_CONFIG && window.APP_CONFIG.api;
    }

    function buildListUrl() {
        var s = getSource();
        if (!s || !s.listUrl) {
            return null;
        }
        return s.listUrl + '?_=' + Date.now();
    }

    function loadVideoList(onDone, onError) {
        var url = buildListUrl();
        if (!url) {
            onError(new Error('API config missing'));
            return;
        }

        /* Try script injection first - same as the original Tizen app.
           This works on old TV WebKit (2016) because <script> tags are not
           subject to CORS. The endpoint responds with window.__CVP_VIDEOS__. */
        if (getSource().listJsUrl) {
            loadViaScript(onDone, onError);
            return;
        }

        loadViaXhr(url, onDone, onError);
    }

    function loadViaScript(onDone, onError) {
        var s = getSource();
        var url = s.listJsUrl + '&_=' + Date.now();
        var timedOut = false;

        window.__CVP_VIDEOS__ = null;

        function cleanup() {
            clearTimeout(timer);
            tag.onload = null;
            tag.onerror = null;
            if (tag.parentNode) { tag.parentNode.removeChild(tag); }
        }

        function handle() {
            if (timedOut) { return; }
            var entries = window.__CVP_VIDEOS__;
            cleanup();
            window.__CVP_VIDEOS__ = null;
            onDone(normalizeEntries(entries));
        }

        var timer = setTimeout(function () {
            timedOut = true;
            cleanup();
            onError(new Error('Timeout'));
        }, 15000);

        var tag = document.createElement('script');
        tag.type = 'text/javascript';
        tag.src = url;
        tag.onload = handle;
        tag.onerror = function () {
            if (timedOut) { return; }
            cleanup();
            onError(new Error('Network error'));
        };
        (document.head || document.documentElement).appendChild(tag);
    }

    function loadViaXhr(url, onDone, onError) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 15000;

        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    var entries = (data && data.videos) ? data.videos : [];
                    onDone(normalizeEntries(entries));
                } catch (e) {
                    onError(new Error('Invalid JSON'));
                }
            } else {
                onError(new Error('HTTP ' + xhr.status));
            }
        };

        xhr.onerror = function () { onError(new Error('Network error')); };
        xhr.ontimeout = function () { onError(new Error('Timeout')); };
        xhr.send();
    }

    function normalizeEntries(entries) {
        var files = [];
        if (!entries) {
            return files;
        }
        /* API responds with { videos: [...] }; FTP videos.js responds with an
           array of groups [{name, videos}, ...]. Accept both. */
        if (!(entries instanceof Array)) {
            if (entries.videos instanceof Array) {
                entries = entries.videos;
            } else {
                return files;
            }
        }
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (!e) { continue; }
            if (e.videos instanceof Array) {
                files.push({ header: true, name: e.name || ' ' });
                var kids = e.videos;
                for (var j = 0; j < kids.length; j++) {
                    var v = kids[j];
                    if (!v || !v.url) { continue; }
                    files.push({ name: v.title || 'Video ' + (j + 1), url: v.url });
                }
                continue;
            }
            if (e.url) {
                files.push({ name: e.title || 'Video ' + (i + 1), url: e.url });
            }
        }
        return files;
    }

    function saveCache(files) {
        try {
            window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), files: files }));
        } catch (e) { /* noop */ }
    }

    function loadCache() {
        try {
            var raw = window.localStorage.getItem(CACHE_KEY);
            if (!raw) { return null; }
            var obj = JSON.parse(raw);
            if (!obj || !(obj.files instanceof Array)) { return null; }
            if (Date.now() - (obj.ts || 0) > CACHE_TTL_MS) { return null; }
            return obj.files;
        } catch (e) {
            return null;
        }
    }

    function showView(name) {
        loadingEl.classList.add('hidden');
        errorEl.classList.add('hidden');
        listViewEl.classList.add('hidden');
        $('player-view').classList.add('hidden');

        if (name === 'loading') {
            loadingEl.classList.remove('hidden');
        } else if (name === 'list') {
            listViewEl.classList.remove('hidden');
        } else if (name === 'player') {
            $('player-view').classList.remove('hidden');
        } else if (name === 'error') {
            errorEl.classList.remove('hidden');
        }
    }

    function showError(msg) {
        state = 'error';
        showView('error');
        errorMsgEl.textContent = msg;
    }

    function renderList(files) {
        videos = files;
        focusedIndex = 0;

        listEl.innerHTML = '';
        var playable = 0;
        for (var i = 0; i < files.length; i++) {
            if (!files[i].header) { playable++; }
        }
        countEl.textContent = playable === 0 ? '' : (playable + ' video' + (playable === 1 ? '' : 's'));

        if (playable === 0) {
            var empty = document.createElement('div');
            empty.className = 'list-empty';
            empty.textContent = 'No videos yet. Use the Telegram bot to add videos.';
            listEl.appendChild(empty);
            return;
        }

        for (var i = 0; i < files.length; i++) {
            (function (idx) {
                var f = files[idx];

                if (f.header) {
                    var head = document.createElement('div');
                    head.className = 'list-header';
                    head.textContent = f.name;
                    listEl.appendChild(head);
                    return;
                }

                var item = document.createElement('div');
                item.className = 'list-item';
                item.setAttribute('data-index', idx);

                var arrow = document.createElement('span');
                arrow.className = 'item-arrow';
                arrow.innerHTML = '&#9654;';

                var title = document.createElement('span');
                title.className = 'item-title';
                title.textContent = f.name;

                item.appendChild(arrow);
                item.appendChild(title);

                item.addEventListener('click', function () {
                    playIndex(idx);
                });

                listEl.appendChild(item);
            })(i);
        }

        applyFocus();
    }

    function applyFocus() {
        var items = listEl.children;
        for (var i = 0; i < items.length; i++) {
            var el = items[i];
            if (videos[i] && videos[i].header) {
                el.className = 'list-header';
                continue;
            }
            var cls = el.className.replace(/ focused/g, '');
            if (i === focusedIndex) {
                el.className = cls + ' focused';
            } else {
                el.className = cls;
            }
        }
        if (items.length > 0 && items[focusedIndex]) {
            ensureVisible(items[focusedIndex]);
        }
    }

    function ensureVisible(el) {
        var top = el.offsetTop;
        var bottom = top + el.offsetHeight;
        var viewTop = listEl.scrollTop;
        var viewBottom = viewTop + listEl.clientHeight;
        if (top < viewTop) {
            listEl.scrollTop = top;
        } else if (bottom > viewBottom) {
            listEl.scrollTop = bottom - listEl.clientHeight;
        }
    }

    function playIndex(idx) {
        if (!videos[idx] || videos[idx].header) { return; }
        var v = videos[idx];
        state = 'player';
        showView('player');
        VideoPlayer.stop();
        VideoPlayer.load(v.url, v.name);
        VideoPlayer.play();
    }

    function exitPlayer() {
        VideoPlayer.stop();
        state = 'list';
        showView('list');
    }

    function boot() {
        document.title = 'Video Streamer';

        if (!getSource() || !getSource().listUrl) {
            showError('Configure API settings in config.js');
            return;
        }

        var cached = loadCache();
        if (cached && cached.length) {
            state = 'list';
            showView('list');
            renderList(cached);
        } else {
            state = 'boot';
            showView('loading');
        }

        loadVideoList(function (files) {
            state = 'list';
            showView('list');
            renderList(files);
            saveCache(files);
        }, function (err) {
            if (state === 'list') {
                if (countEl && countEl.textContent) {
                    countEl.textContent += ' (offline, showing cache)';
                }
                return;
            }
            var msg = 'Could not load videos.\n';
            msg += (err && err.message) ? err.message : 'Network error';
            showError(msg);
        });
    }

    function wireButtons() {
        var back = $('btn-back');
        if (back) {
            back.addEventListener('click', exitPlayer);
        }

        var play = $('btn-play');
        if (play) {
            play.addEventListener('click', function () {
                VideoPlayer.togglePlayPause();
                VideoPlayer.showControls();
            });
        }

        var rew = $('btn-rew');
        if (rew) {
            rew.addEventListener('click', function () {
                VideoPlayer.seekBackward();
                VideoPlayer.showControls();
            });
        }

        var fwd = $('btn-fwd');
        if (fwd) {
            fwd.addEventListener('click', function () {
                VideoPlayer.seekForward();
                VideoPlayer.showControls();
            });
        }

        var voldn = $('btn-voldn');
        if (voldn) {
            voldn.addEventListener('click', function () {
                VideoPlayer.volumeDown();
                VideoPlayer.showControls();
            });
        }

        var volup = $('btn-volup');
        if (volup) {
            volup.addEventListener('click', function () {
                VideoPlayer.volumeUp();
                VideoPlayer.showControls();
            });
        }
    }

    var KEY_ENTER = 13;
    var KEY_UP = 38;
    var KEY_DOWN = 40;
    var KEY_LEFT = 37;
    var KEY_RIGHT = 39;
    var KEY_BACK_TIZEN = 10009;
    var KEY_BACK_MEDIA = 461;
    var KEY_ESC = 27;
    var KEY_SPACE = 32;
    var KEY_PLAY = 415;
    var KEY_PLAYPAUSE = 10252;
    var KEY_STOP = 413;
    var KEY_EXIT = 403;

    function onKeyDown(e) {
        var key = e.keyCode || e.which;

        if (state === 'list') {
            var n = videos.length;
            if (n === 0) { return; }
            if (key === KEY_UP) {
                focusedIndex = (focusedIndex - 1 + n) % n;
                applyFocus();
            } else if (key === KEY_DOWN) {
                focusedIndex = (focusedIndex + 1) % n;
                applyFocus();
            } else if (key === KEY_ENTER || key === KEY_PLAY || key === KEY_PLAYPAUSE) {
                var focusIdx = focusedIndex;
                if (document.activeElement && document.activeElement.getAttribute) {
                    var attr = document.activeElement.getAttribute('data-index');
                    if (attr !== null && attr !== undefined) {
                        focusIdx = parseInt(attr, 10);
                    }
                }
                playIndex(focusIdx);
            } else if (key === KEY_ESC || key === KEY_BACK_MEDIA) {
                /* stay */
            }
            if (key >= KEY_UP && key <= KEY_RIGHT) {
                e.preventDefault();
            }
        } else if (state === 'player') {
            if (key === KEY_BACK_TIZEN || key === KEY_BACK_MEDIA || key === KEY_ESC || key === KEY_STOP || key === KEY_EXIT) {
                e.preventDefault();
                exitPlayer();
            } else if (key === KEY_ENTER || key === KEY_SPACE || key === KEY_PLAY || key === KEY_PLAYPAUSE) {
                VideoPlayer.togglePlayPause();
            } else if (key === KEY_RIGHT) {
                VideoPlayer.seekForward();
            } else if (key === KEY_LEFT) {
                VideoPlayer.seekBackward();
            } else if (key === KEY_UP) {
                VideoPlayer.volumeUp();
            } else if (key === KEY_DOWN) {
                VideoPlayer.volumeDown();
            }
            if (key !== KEY_BACK_TIZEN) {
                VideoPlayer.showControls();
            }
        }
    }

    function onDomReady(fn) {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            fn();
        } else {
            document.addEventListener('DOMContentLoaded', fn, false);
        }
    }

    function init() {
        loadingEl = $('loading');
        errorEl = $('error');
        errorMsgEl = $('error-message');
        listViewEl = $('list-view');
        listEl = $('video-list');
        countEl = $('video-count');

        VideoPlayer.init();
        VideoPlayer.onEnded(exitPlayer);
        VideoPlayer.onStateChanged(function (playing) {
            var b = $('btn-play');
            if (b) { b.textContent = playing ? 'Pause' : 'Play'; }
        });

        wireButtons();
        window.addEventListener('keydown', onKeyDown, false);
        onDomReady(boot);
    }

    if (typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', init, false);
    } else {
        window.onload = init;
    }
})();
