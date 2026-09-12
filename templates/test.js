/*
 * Test page - plays a single fixed video.
 * Remote-friendly (enter/back/arrows + mouse) via VideoPlayer.
 */
(function () {
    'use strict';

    var TEST_URL = 'https://150.uptv.ir/uptv/serial2/The%20Ark/s1/The.Ark.S01.E01.720p.Sub_UPTV.co.mp4';
    var TEST_TITLE = 'تست - The Ark S01E01';

    function $(id) {
        return document.getElementById(id);
    }

    function goMenu() {
        window.location.href = '../index.html';
    }

    function togglePlay() {
        VideoPlayer.togglePlayPause();
        VideoPlayer.showControls();
    }

    function wireButtons() {
        var map = {
            'btn-exit': goMenu,
            'btn-play': togglePlay,
            'btn-rew': function () { VideoPlayer.seekBackward(); VideoPlayer.showControls(); },
            'btn-fwd': function () { VideoPlayer.seekForward(); VideoPlayer.showControls(); },
            'btn-voldn': function () { VideoPlayer.volumeDown(); VideoPlayer.showControls(); },
            'btn-volup': function () { VideoPlayer.volumeUp(); VideoPlayer.showControls(); }
        };
        for (var id in map) {
            var el = $(id);
            if (el) { el.addEventListener('click', map[id]); }
        }
    }

    function onKeyDown(e) {
        var k = e.keyCode || e.which;

        if (k === 27 || k === 10009 || k === 461 || k === 403 || k === 413) {
            e.preventDefault();
            goMenu();
        } else if (k === 13 || k === 32 || k === 415 || k === 10252) {
            togglePlay();
        } else if (k === 37) {
            VideoPlayer.seekBackward();
        } else if (k === 39) {
            VideoPlayer.seekForward();
        } else if (k === 38) {
            VideoPlayer.volumeUp();
        } else if (k === 40) {
            VideoPlayer.volumeDown();
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
        document.title = 'تست';
        VideoPlayer.init();
        VideoPlayer.onEnded(goMenu);
        VideoPlayer.onStateChanged(function (playing) {
            var b = $('btn-play');
            if (b) { b.textContent = playing ? 'Pause' : 'Play'; }
        });
        wireButtons();
        window.addEventListener('keydown', onKeyDown, false);
        VideoPlayer.load(TEST_URL, TEST_TITLE);
        VideoPlayer.play();
    }

    if (typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', init, false);
    } else {
        window.onload = init;
    }
})();