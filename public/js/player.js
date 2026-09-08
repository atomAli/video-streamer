/*
 * VideoPlayer - lightweight HTML5 video player controller.
 * Adapted from tizen-video-player for web use.
 */
(function () {
    'use strict';

    var SEEK_STEP_SECONDS = 10;

    var video = null;
    var osd = null;
    var osdTitle = null;
    var osdTime = null;
    var osdProgressBar = null;
    var osdProgress = null;
    var osdBufferedBar = null;
    var osdBufferedText = null;
    var playerLoading = null;
    var playerLoadingText = null;
    var playerError = null;

    var currentTitle = '';
    var endedCallback = null;
    var stateChangedCallback = null;
    var hideTimer = null;

    function fmtTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) {
            seconds = 0;
        }
        seconds = Math.floor(seconds);
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = seconds % 60;
        var mm = (m < 10) ? ('0' + m) : ('' + m);
        var ss = (s < 10) ? ('0' + s) : ('' + s);
        if (h > 0) {
            return h + ':' + mm + ':' + ss;
        }
        return m + ':' + ss;
    }

    function showOsd() {
        if (osd) {
            osd.classList.remove('hidden-osd');
        }
        clearTimeout(hideTimer);
        if (video && !video.paused) {
            hideTimer = setTimeout(hideOsd, 3500);
        }
    }

    function hideOsd() {
        hideTimer = null;
        if (osd) {
            osd.classList.add('hidden-osd');
        }
    }

    function updateProgress() {
        if (!video || !osdProgressBar) {
            return;
        }
        var d = video.duration || 0;
        var c = video.currentTime || 0;
        var pct = d > 0 ? (c / d * 100) : 0;
        if (osdTime) {
            osdTime.textContent = fmtTime(c) + ' / ' + fmtTime(d);
        }
        if (osdProgressBar) {
            osdProgressBar.style.width = pct + '%';
        }
    }

    function updateBuffered() {
        if (!video || !osdBufferedBar) {
            return 0;
        }
        var d = video.duration || 0;
        var buff = 0;
        try {
            if (video.buffered && video.buffered.length > 0) {
                buff = video.buffered.end(video.buffered.length - 1);
            }
        } catch (e) { /* noop */ }
        var pct = d > 0 ? (buff / d * 100) : 0;
        if (pct < 0) { pct = 0; }
        if (pct > 100) { pct = 100; }
        osdBufferedBar.style.width = pct + '%';
        if (osdBufferedText) {
            osdBufferedText.textContent = 'Buffer ' + Math.round(pct) + '%';
        }
        return pct;
    }

    function showLoading() {
        if (!playerLoading) { return; }
        var pct = Math.round(updateBuffered());
        if (playerLoadingText) {
            playerLoadingText.textContent = 'Loading ' + pct + '%';
        }
        playerLoading.classList.remove('hidden');
    }

    function hideLoading() {
        if (playerLoading) {
            playerLoading.classList.add('hidden');
        }
    }

    window.VideoPlayer = {
        init: function () {
            video = document.getElementById('video-player');
            osd = document.getElementById('osd');
            osdTitle = document.getElementById('osd-title');
            osdTime = document.getElementById('osd-time');
            osdProgress = document.getElementById('osd-progress');
            osdProgressBar = document.getElementById('osd-progress-bar');
            osdBufferedBar = document.getElementById('osd-buffer-bar');
            osdBufferedText = document.getElementById('osd-buffer');
            playerLoading = document.getElementById('player-loading');
            playerLoadingText = document.getElementById('player-loading-text');
            playerError = document.getElementById('player-error');

            video.addEventListener('timeupdate', updateProgress);
            video.addEventListener('durationchange', updateProgress);
            video.addEventListener('progress', updateBuffered);
            video.addEventListener('waiting', showLoading);
            video.addEventListener('playing', hideLoading);
            video.addEventListener('canplay', hideLoading);
            video.addEventListener('loadstart', showLoading);

            video.addEventListener('click', function () {
                window.VideoPlayer.togglePlayPause();
            });

            video.addEventListener('ended', function () {
                if (endedCallback) {
                    endedCallback();
                }
            });

            video.addEventListener('error', function () {
                if (playerError) {
                    playerError.classList.remove('hidden');
                }
            });

            video.addEventListener('play', function () {
                if (stateChangedCallback) { stateChangedCallback(true); }
                showOsd();
            });

            video.addEventListener('pause', function () {
                if (stateChangedCallback) { stateChangedCallback(false); }
                clearTimeout(hideTimer);
                showOsd();
            });

            if (osdProgress) {
                osdProgress.addEventListener('click', function (e) {
                    if (!video) { return; }
                    var rect = osdProgress.getBoundingClientRect();
                    var pct = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
                    if (pct < 0) { pct = 0; } else if (pct > 1) { pct = 1; }
                    var d = video.duration || 0;
                    video.currentTime = pct * d;
                    showOsd();
                });
            }
        },

        onEnded: function (cb) {
            endedCallback = cb;
        },

        onStateChanged: function (cb) {
            stateChangedCallback = cb;
        },

        load: function (url, title) {
            currentTitle = title || '';
            if (osdTitle) { osdTitle.textContent = currentTitle; }
            if (playerError) { playerError.classList.add('hidden'); }
            hideLoading();
            if (osdTime) { osdTime.textContent = '0:00 / 0:00'; }
            if (osdBufferedBar) { osdBufferedBar.style.width = '0%'; }
            if (osdBufferedText) { osdBufferedText.textContent = ''; }
            if (osdProgressBar) { osdProgressBar.style.width = '0%'; }
            video.src = url;
            video.load();
        },

        play: function () {
            if (!video) { return; }
            showOsd();
            if (video.paused) {
                var p = video.play();
                if (p && typeof p['catch'] === 'function') {
                    p['catch'](function () {
                        /* autoplay restrictions */
                    });
                }
            }
        },

        pause: function () {
            clearTimeout(hideTimer);
            if (video && !video.paused) {
                video.pause();
            }
            showOsd();
        },

        togglePlayPause: function () {
            if (!video) { return; }
            if (video.paused) {
                this.play();
            } else {
                video.pause();
                showOsd();
            }
        },

        isPaused: function () {
            return !video || video.paused;
        },

        seekForward: function () {
            if (!video) { return; }
            var d = video.duration || 0;
            var t = video.currentTime + SEEK_STEP_SECONDS;
            video.currentTime = (t > d) ? d : t;
            showOsd();
        },

        seekBackward: function () {
            if (!video) { return; }
            var t = video.currentTime - SEEK_STEP_SECONDS;
            video.currentTime = (t < 0) ? 0 : t;
            showOsd();
        },

        volumeUp: function () {
            if (!video) { return; }
            video.volume = Math.min(1, video.volume + 0.1);
            showOsd();
        },

        volumeDown: function () {
            if (!video) { return; }
            video.volume = Math.max(0, video.volume - 0.1);
            showOsd();
        },

        showControls: function () {
            showOsd();
        },

        stop: function () {
            clearTimeout(hideTimer);
            if (video) {
                try { video.pause(); } catch (e) { /* noop */ }
                try { video.removeAttribute('src'); } catch (e) { /* noop */ }
                try { video.load(); } catch (e) { /* noop */ }
            }
        }
    };
})();
