/* ============================================================
   Music — Spatial Sessions
   The interface, the listening room, and the light.
   ============================================================ */

(function () {
  "use strict";

  const TRACKS = window.TRACKS;
  const Soundscape = window.Soundscape;

  if (!TRACKS || !TRACKS.length || !Soundscape) {
    console.error("Music: missing tracks or audio engine.");
    return;
  }

  /* ----------------------------------------------------------
     helpers
     ---------------------------------------------------------- */

  const $ = (selector, root = document) => root.querySelector(selector);

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const pad2 = (value) => String(value).padStart(2, "0");

  const formatTime = (seconds) => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${pad2(total % 60)}`;
  };

  const hash = (value) => {
    const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  const hexToRgb = (hex) => {
    const clean = String(hex).replace("#", "");
    const full = clean.length === 3
      ? clean.split("").map((char) => char + char).join("")
      : clean;
    const number = parseInt(full, 16);
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
  };

  const rgba = (hex, alpha) => {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return character;
    }
  });

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const app = $("#app");
  const root = document.documentElement;
  const engine = new Soundscape();

  const state = {
    index: 0,
    playing: false,
    ended: false,
    scrubbing: false,
    shuffle: false,
    repeat: "off",
    queueOpen: false,
    volume: 0.72,
    lastVolume: 0.72,
    activeLyric: 0,
    levels: { bass: 0, low: 0, mid: 0, high: 0, air: 0 },
    spectrum: null,
    rotation: 0,
    lastAurora: 0,
    lastFrame: performance.now(),
    lastIdleFrame: 0,
    lastBass: -1,
    lastScale: 0,
    wavePoints: null,
    waveGain: 1
  };

  let playPromise = null;
  let playToken = 0;
  let toastTimer = null;
  let previousBodyOverflow = "";

  const ui = {
    app,
    backdrop: $(".backdrop"),
    shell: $(".shell"),
    sidebar: $(".sidebar"),
    cover: $("#cover"),
    coverCanvas: $("#coverCanvas"),
    coverTilt: $("#coverTilt"),
    coverSheen: $("#coverSheen"),
    stageVisual: $("#stageVisual"),
    aurora: $("#aurora"),
    halo: $("#halo"),
    waveCanvas: $("#waveCanvas"),
    lyricsViewport: $("#lyricsViewport"),
    lyricsTrack: $("#lyricsTrack"),
    trackHeading: $("#trackHeading"),
    trackTitle: $("#trackTitle"),
    trackArtist: $("#trackArtist"),
    trackAlbum: $("#trackAlbum"),
    trackYear: $("#trackYear"),
    trackIndex: $("#trackIndex"),
    coverArtist: $("#coverArtist"),
    coverAlbum: $("#coverAlbum"),
    coverTitle: $("#coverTitle"),
    coverYear: $("#coverYear"),
    coverNumber: $("#coverNumber"),
    crumbAlbum: $("#crumbAlbum"),
    waveFormat: $("#waveFormat"),
    searchInput: $("#searchInput"),
    sideTracks: $("#sideTracks"),
    sideEmpty: $("#sideEmpty"),
    queue: $("#queue"),
    queueList: $("#queueList"),
    queueMeta: $("#queueMeta"),
    queueBtn: $("#queueBtn"),
    queueClose: $("#queueClose"),
    scrim: $("#scrim"),
    playBtn: $("#playBtn"),
    prevBtn: $("#prevBtn"),
    nextBtn: $("#nextBtn"),
    prevTop: $("#prevTop"),
    nextTop: $("#nextTop"),
    shuffleBtn: $("#shuffleBtn"),
    repeatBtn: $("#repeatBtn"),
    muteBtn: $("#muteBtn"),
    seek: $("#seek"),
    volume: $("#volume"),
    elapsed: $("#elapsed"),
    remaining: $("#remaining"),
    toast: $("#toast"),
    srStatus: $("#srStatus")
  };

  const visuals = {
    auroraW: 0,
    auroraH: 0,
    haloCtx: null,
    haloW: 0,
    haloH: 0,
    waveCtx: null,
    waveW: 0,
    waveH: 0,
    particles: []
  };

  const AURORA_BLOBS = [
    { x: 0.18, y: 0.28, r: 0.33, band: "bass", color: 0, phase: 0.0, speed: 0.13 },
    { x: 0.76, y: 0.20, r: 0.30, band: "high", color: 1, phase: 1.7, speed: 0.11 },
    { x: 0.64, y: 0.80, r: 0.36, band: "low", color: 2, phase: 3.2, speed: 0.09 },
    { x: 0.34, y: 0.58, r: 0.27, band: "mid", color: 3, phase: 4.1, speed: 0.14 },
    { x: 0.90, y: 0.66, r: 0.23, band: "air", color: 1, phase: 2.4, speed: 0.16 },
    { x: 0.08, y: 0.82, r: 0.22, band: "mid", color: 0, phase: 5.2, speed: 0.10 }
  ];

  /* ----------------------------------------------------------
     texture
     ---------------------------------------------------------- */

  const noiseTile = document.createElement("canvas");
  noiseTile.width = 180;
  noiseTile.height = 180;
  (() => {
    const context = noiseTile.getContext("2d");
    const image = context.createImageData(180, 180);
    for (let i = 0; i < image.data.length; i += 4) {
      const value = Math.floor(Math.random() * 255);
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = Math.floor(Math.random() * 28);
    }
    context.putImageData(image, 0, 0);
  })();

  const thumbStyle = (palette) => {
    const art = palette.art;
    const x = (art.sunX * 100).toFixed(1);
    const y = (art.sunY * 100).toFixed(1);
    return [
      "background:",
      `radial-gradient(circle at ${x}% ${y}%, ${palette.core} 0%, ${palette.core} 6%, ${rgba(palette.glow, 0.5)} 14%, transparent 39%),`,
      `radial-gradient(circle at 24% 84%, ${rgba(palette.cool, 0.48)}, transparent 54%),`,
      `linear-gradient(140deg, ${palette.coverA}, ${palette.coverC});`
    ].join("");
  };

  /* ----------------------------------------------------------
     track artwork
     ---------------------------------------------------------- */

  function drawCoverArt(track, index) {
    const canvas = ui.coverCanvas;
    const ctx = canvas.getContext("2d");
    const size = 900;
    canvas.width = size;
    canvas.height = size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    const palette = track.palette;
    const art = palette.art;
    const sunX = size * art.sunX;
    const sunY = size * art.sunY;
    const sunR = size * art.sunR;

    const base = ctx.createLinearGradient(0, 0, size * 0.92, size);
    base.addColorStop(0, palette.coverA);
    base.addColorStop(0.52, palette.coverB);
    base.addColorStop(1, palette.coverC);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    const wash = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, size * 0.8);
    wash.addColorStop(0, rgba(palette.glow, 0.24));
    wash.addColorStop(0.36, rgba(palette.glow, 0.12));
    wash.addColorStop(0.7, rgba(palette.cool, 0.05));
    wash.addColorStop(1, rgba(palette.glow, 0));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, size, size);

    /* distant dust */
    for (let i = 0; i < art.stars; i++) {
      const x = hash(i * 3.17 + index * 11.3) * size;
      const y = hash(i * 5.71 + index * 4.9) * size;
      const alpha = 0.06 + hash(i * 7.23) * 0.19;
      const radius = 0.6 + hash(i * 9.1 + index) * 1.4;
      ctx.fillStyle = rgba(palette.core, alpha);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    /* orbits */
    ctx.save();
    ctx.translate(sunX, sunY);
    ctx.rotate(art.tilt);
    ctx.scale(1, 0.34);
    for (let i = 0; i < art.orbits; i++) {
      const radius = sunR * (1.52 + i * 0.41);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 246, 232, ${(0.115 - i * 0.02).toFixed(3)})`;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      const angle = -0.7 + i * 1.05;
      ctx.fillStyle = rgba(palette.core, 0.55);
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* companion moons */
    if (art.echoes) {
      for (let i = 0; i < art.echoes; i++) {
        const angle = -0.8 + i * 0.78 + art.tilt;
        const distance = sunR * 2.25;
        const x = sunX + Math.cos(angle) * distance;
        const y = sunY + Math.sin(angle) * distance * 0.52;
        const radius = sunR * (0.15 - i * 0.025);
        const halo = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.6);
        halo.addColorStop(0, rgba(palette.core, 0.3));
        halo.addColorStop(1, rgba(palette.core, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, radius * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(palette.core, 0.62);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* corona */
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const corona = ctx.createRadialGradient(sunX, sunY, sunR * 0.2, sunX, sunY, sunR * 2.6);
    corona.addColorStop(0, rgba(palette.glow, 0.4));
    corona.addColorStop(0.3, rgba(palette.glow, 0.17));
    corona.addColorStop(0.66, rgba(palette.glow, 0.035));
    corona.addColorStop(1, rgba(palette.glow, 0));
    ctx.fillStyle = corona;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    /* the sun itself */
    const sun = ctx.createRadialGradient(
      sunX - sunR * 0.3,
      sunY - sunR * 0.32,
      sunR * 0.04,
      sunX,
      sunY,
      sunR * 1.02
    );
    sun.addColorStop(0, rgba(palette.core, 1));
    sun.addColorStop(0.42, rgba(palette.core, 0.98));
    sun.addColorStop(0.76, rgba(palette.glow, 0.98));
    sun.addColorStop(0.94, rgba(palette.core, 0.9));
    sun.addColorStop(0.985, rgba(palette.glow, 0.45));
    sun.addColorStop(1, rgba(palette.glow, 0));
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 1.02, 0, Math.PI * 2);
    ctx.fill();

    /* soft rim */
    ctx.save();
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 0.995, Math.PI * 0.56, Math.PI * 1.05);
    ctx.strokeStyle = rgba(palette.core, 0.4);
    ctx.lineWidth = 2.1;
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = 24;
    ctx.stroke();
    ctx.restore();

    /* the eclipse that makes the light readable */
    const eclipseX = sunX + sunR * art.eclipseX;
    const eclipseY = sunY + sunR * art.eclipseY;
    const eclipseR = sunR * 1.02;
    const shade = ctx.createRadialGradient(
      eclipseX - eclipseR * 0.26,
      eclipseY - eclipseR * 0.3,
      eclipseR * 0.08,
      eclipseX,
      eclipseY,
      eclipseR * 1.05
    );
    shade.addColorStop(0, palette.coverA);
    shade.addColorStop(0.54, palette.coverB);
    shade.addColorStop(0.9, "rgba(7, 7, 8, 0.98)");
    shade.addColorStop(1, "rgba(7, 7, 8, 0)");
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(eclipseX, eclipseY, eclipseR * 1.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(eclipseX, eclipseY, eclipseR * 0.985, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(palette.core, 0.11);
    ctx.lineWidth = 1.1;
    ctx.stroke();

    /* The living edge of the hidden sun. */
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 1.008, Math.PI * 0.53, Math.PI * 1.08);
    ctx.strokeStyle = rgba(palette.glow, 0.2);
    ctx.lineWidth = 18;
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = 34;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 1.006, Math.PI * 0.55, Math.PI * 1.05);
    ctx.strokeStyle = rgba(palette.core, 0.88);
    ctx.lineWidth = 3.8;
    ctx.shadowBlur = 24;
    ctx.stroke();
    ctx.restore();

    /* A cool breath on the dark side keeps the disc from going flat. */
    ctx.beginPath();
    ctx.arc(eclipseX, eclipseY, eclipseR * 0.99, Math.PI * 1.4, Math.PI * 1.95);
    ctx.strokeStyle = rgba(palette.cool, 0.17);
    ctx.lineWidth = 1.4;
    ctx.stroke();

    /* horizon */
    if (art.horizon) {
      const horizonY = size * art.horizon;
      const line = ctx.createLinearGradient(size * 0.05, horizonY, size * 0.95, horizonY);
      line.addColorStop(0, rgba(palette.core, 0));
      line.addColorStop(0.5, rgba(palette.core, 0.22));
      line.addColorStop(1, rgba(palette.core, 0));
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(size * 0.06, horizonY);
      ctx.lineTo(size * 0.94, horizonY);
      ctx.stroke();

      const below = ctx.createLinearGradient(0, horizonY, 0, horizonY + size * 0.16);
      below.addColorStop(0, rgba(palette.core, 0.05));
      below.addColorStop(1, rgba(palette.core, 0));
      ctx.fillStyle = below;
      ctx.fillRect(0, horizonY, size, size * 0.16);
    }

    /* type scrims */
    const topScrim = ctx.createLinearGradient(0, 0, 0, size * 0.32);
    topScrim.addColorStop(0, "rgba(0, 0, 0, 0.42)");
    topScrim.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = topScrim;
    ctx.fillRect(0, 0, size, size * 0.32);

    const bottomScrim = ctx.createLinearGradient(0, size * 0.56, 0, size);
    bottomScrim.addColorStop(0, "rgba(0, 0, 0, 0)");
    bottomScrim.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    ctx.fillStyle = bottomScrim;
    ctx.fillRect(0, size * 0.56, size, size * 0.44);

    /* a little print texture */
    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ctx.createPattern(noiseTile, "repeat");
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    /* vignette */
    const vignette = ctx.createRadialGradient(
      size * 0.5,
      size * 0.48,
      size * 0.23,
      size * 0.5,
      size * 0.5,
      size * 0.73
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.72, "rgba(0, 0, 0, 0.18)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.62)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, size, size);

    /* a fine diagonal sheen, like light across a print */
    const sheen = ctx.createLinearGradient(0, size, size, 0);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(0.46, "rgba(255, 255, 255, 0.018)");
    sheen.addColorStop(0.53, "rgba(255, 255, 255, 0.05)");
    sheen.addColorStop(0.64, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, size, size);
  }

  /* ----------------------------------------------------------
     lists
     ---------------------------------------------------------- */

  function buildLists() {
    ui.sideTracks.innerHTML = TRACKS.map((track, index) => `
      <button class="side-track" type="button" data-index="${index}" aria-label="播放 ${escapeHtml(track.title)} — ${escapeHtml(track.artist)}">
        <span class="mini-cover" style="${thumbStyle(track.palette)}" aria-hidden="true"></span>
        <span class="side-text">
          <span class="side-title">${escapeHtml(track.title)}</span>
          <span class="side-artist">${escapeHtml(track.artist)}</span>
        </span>
        <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
      </button>
    `).join("");

    ui.queueList.innerHTML = TRACKS.map((track, index) => `
      <button class="queue-item" type="button" data-index="${index}" aria-label="播放 ${escapeHtml(track.title)} — ${escapeHtml(track.artist)}">
        <span class="queue-index">
          <span>${pad2(index + 1)}</span>
          <span class="queue-eq" aria-hidden="true"><i></i><i></i><i></i></span>
        </span>
        <span class="mini-cover" style="${thumbStyle(track.palette)}" aria-hidden="true"></span>
        <span class="queue-copy">
          <span class="queue-title">${escapeHtml(track.title)}</span>
          <span class="queue-artist">${escapeHtml(track.artist)}</span>
        </span>
        <span class="queue-time">${formatTime(track.duration)}</span>
      </button>
    `).join("");

    const totalMinutes = Math.round(TRACKS.reduce((total, track) => total + track.duration, 0) / 60);
    ui.queueMeta.textContent = `${TRACKS.length} 首 · ${totalMinutes} 分钟`;
  }

  function updateActiveLists() {
    Array.from(ui.sideTracks.querySelectorAll(".side-track")).forEach((row) => {
      const active = Number(row.dataset.index) === state.index;
      row.classList.toggle("is-active", active);
      if (active) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    });

    Array.from(ui.queueList.querySelectorAll(".queue-item")).forEach((row) => {
      const active = Number(row.dataset.index) === state.index;
      row.classList.toggle("is-active", active);
      if (active) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    });
  }

  /* ----------------------------------------------------------
     track presentation
     ---------------------------------------------------------- */

  function applyPalette(track) {
    const palette = track.palette;
    root.style.setProperty("--glow", palette.glow);
    root.style.setProperty("--glow-rgb", hexToRgb(palette.glow).join(", "));
    root.style.setProperty("--core", palette.core);
    root.style.setProperty("--cool", palette.cool);
    root.style.setProperty("--cool-rgb", hexToRgb(palette.cool).join(", "));
    root.style.setProperty("--cover-a", palette.coverA);
    root.style.setProperty("--cover-b", palette.coverB);
    root.style.setProperty("--cover-c", palette.coverC);

    const theme = $('meta[name="theme-color"]');
    if (theme) theme.setAttribute("content", palette.coverA);
  }

  function paintTrack(track) {
    const index = TRACKS.indexOf(track);
    ui.trackTitle.textContent = track.title;
    ui.trackArtist.textContent = track.artist;
    ui.trackAlbum.textContent = track.album;
    ui.trackYear.textContent = String(track.year);
    ui.trackIndex.textContent = `${pad2(index + 1)} / ${pad2(TRACKS.length)}`;
    ui.crumbAlbum.textContent = track.album;

    ui.coverArtist.textContent = track.artist;
    ui.coverAlbum.textContent = track.album;
    ui.coverTitle.textContent = track.title;
    ui.coverYear.textContent = String(track.year);
    ui.coverNumber.textContent = pad2(index + 1);

    ui.seek.max = String(track.duration);
    ui.seek.setAttribute("aria-valuemax", String(track.duration));
    ui.seek.setAttribute("aria-valuetext", `0:00 / ${formatTime(track.duration)}`);
    ui.remaining.textContent = `-${formatTime(track.duration)}`;
    document.title = `${track.title} · ${track.artist} — Music`;
  }

  function cancelElementAnimations(element) {
    if (!element || typeof element.getAnimations !== "function") return;
    element.getAnimations().forEach((animation) => animation.cancel());
  }

  function animateTrackChange() {
    if (reduceMotion) return;

    if (ui.trackHeading.animate) {
      cancelElementAnimations(ui.trackHeading);
      ui.trackHeading.animate(
        [
          { opacity: 0, transform: "translateY(15px)", filter: "blur(8px)" },
          { opacity: 1, transform: "translateY(0)", filter: "blur(0)" }
        ],
        { duration: 720, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      );

      cancelElementAnimations(ui.coverCanvas);
      ui.coverCanvas.animate(
        [{ opacity: 0.2 }, { opacity: 1 }],
        { duration: 680, easing: "ease-out" }
      );

      cancelElementAnimations(ui.lyricsViewport);
      ui.lyricsViewport.animate(
        [{ opacity: 0.35 }, { opacity: 1 }],
        { duration: 620, easing: "ease-out" }
      );

      if (ui.backdrop.animate) {
        ui.backdrop.animate(
          [{ opacity: 0.62 }, { opacity: 1 }],
          { duration: 900, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
        );
      }
    }
  }

  function announce(message) {
    if (!ui.srStatus) return;
    ui.srStatus.textContent = "";
    window.setTimeout(() => {
      ui.srStatus.textContent = message;
    }, 40);
  }

  function setPlaying(playing) {
    state.playing = playing;
    ui.app.dataset.playing = playing ? "true" : "false";
    ui.playBtn.setAttribute("aria-label", playing ? "暂停" : "播放");
  }

  async function selectTrack(index, options = {}) {
    const targetIndex = ((index % TRACKS.length) + TRACKS.length) % TRACKS.length;
    const track = TRACKS[targetIndex];
    const wasPlaying = state.playing;
    const shouldPlay = options.autoplay !== undefined ? options.autoplay : wasPlaying;

    /* Cancel an in-flight start if the listener picked something else. */
    playToken += 1;

    state.ended = false;
    state.playing = false;
    state.scrubbing = false;
    setPlaying(false);

    state.index = targetIndex;
    engine.setTrack(track);

    applyPalette(track);
    paintTrack(track);
    buildLyrics(track);
    updateActiveLists();
    updateTransport(0);
    drawCoverArt(track, targetIndex);

    if (!options.initial) {
      animateTrackChange();
      announce(
        shouldPlay
          ? `正在播放 ${track.title}，${track.artist}`
          : `已选择 ${track.title}，播放已暂停`
      );
    }

    if (shouldPlay) {
      await startPlayback();
    } else {
      syncLyrics(0, true);
      updateTransport(0);
    }
  }

  /* ----------------------------------------------------------
     playback
     ---------------------------------------------------------- */

  async function startPlayback() {
    if (state.playing) return;

    const entryToken = playToken;

    if (playPromise) {
      const pending = playPromise;
      await pending;
      if (state.playing || entryToken !== playToken) return;
    }

    const token = ++playToken;

    playPromise = (async () => {
      try {
        await engine.play();
        if (token !== playToken) {
          engine.pause();
          return;
        }
        state.ended = false;
        setPlaying(true);
        const time = engine.currentTime;
        updateTransport(time);
        syncLyrics(time, true);
      } catch (error) {
        if (token !== playToken) {
          try {
            engine.pause();
          } catch (pauseError) {
            /* nothing else to do */
          }
          return;
        }
        console.error(error);
        try {
          engine.pause();
        } catch (pauseError) {
          /* nothing else to do */
        }
        setPlaying(false);
        showToast("无法启动声音，请允许此页面播放音频");
      } finally {
        playPromise = null;
      }
    })();

    return playPromise;
  }

  function pausePlayback() {
    playToken += 1;
    if (!state.playing) return;
    engine.pause();
    setPlaying(false);
    updateTransport(engine.currentTime);
  }

  function togglePlay() {
    if (state.playing || playPromise) pausePlayback();
    else startPlayback();
  }

  function chooseNextIndex(direction) {
    if (state.shuffle && TRACKS.length > 1) {
      let next = state.index;
      while (next === state.index) {
        next = Math.floor(Math.random() * TRACKS.length);
      }
      return next;
    }
    return (state.index + direction + TRACKS.length) % TRACKS.length;
  }

  function nextTrack() {
    selectTrack(chooseNextIndex(1), { autoplay: state.playing || state.ended });
  }

  function previousTrack() {
    if (engine.currentTime > 4 && !state.ended) {
      seekTo(0, { autoplay: false });
      return;
    }
    selectTrack(chooseNextIndex(-1), { autoplay: state.playing || state.ended });
  }

  function seekTo(time, options = {}) {
    const track = TRACKS[state.index];
    const target = clamp(Number(time) || 0, 0, Math.max(0, track.duration - 0.1));
    state.ended = false;
    engine.seek(target);
    updateTransport(target);
    syncLyrics(target, true);
    if (options.autoplay && !state.playing) {
      startPlayback();
    }
  }

  function seekRelative(seconds) {
    seekTo(engine.currentTime + seconds, { autoplay: false });
  }

  function updateTransport(rawTime) {
    if (state.scrubbing) return;
    const track = TRACKS[state.index];
    const duration = track.duration;
    const time = clamp(Number(rawTime) || 0, 0, duration);
    const percent = duration ? (time / duration) * 100 : 0;

    if (!Number.isNaN(ui.seek.valueAsNumber) && Math.abs(ui.seek.valueAsNumber - time) > 0.05) {
      ui.seek.value = String(time);
    }
    setRangeFill(ui.seek, percent);

    const elapsed = formatTime(time);
    const remaining = `-${formatTime(Math.max(0, duration - time))}`;
    const valueText = `${elapsed} / ${formatTime(duration)}`;

    if (ui.elapsed.textContent !== elapsed) {
      ui.elapsed.textContent = elapsed;
    }
    if (ui.seek.getAttribute("aria-valuetext") !== valueText) {
      ui.seek.setAttribute("aria-valuetext", valueText);
    }
    if (ui.remaining.textContent !== remaining) {
      ui.remaining.textContent = remaining;
    }
  }

  function setRangeFill(element, percent) {
    element.style.setProperty("--p", `${clamp(percent, 0, 100).toFixed(3)}%`);
  }

  function handleEnded() {
    if (state.ended) return;
    const track = TRACKS[state.index];
    const indexAtEnd = state.index;
    state.ended = true;
    engine.finish();
    setPlaying(false);
    updateTransport(track.duration);
    syncLyrics(track.duration, true);

    if (state.repeat === "one") {
      window.setTimeout(() => {
        if (state.ended && !state.playing && state.index === indexAtEnd && state.repeat === "one") {
          engine.seek(0);
          startPlayback();
        }
      }, 550);
    } else if (state.repeat === "all") {
      window.setTimeout(() => {
        if (state.ended && !state.playing && state.index === indexAtEnd && state.repeat === "all") {
          selectTrack(chooseNextIndex(1), { autoplay: true });
        }
      }, 500);
    }
  }

  /* ----------------------------------------------------------
     lyrics
     ---------------------------------------------------------- */

  function buildLyrics(track) {
    const fragment = document.createDocumentFragment();
    ui.lyricsTrack.style.transform = "none";

    track.lyrics.forEach((line, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lyric-line";
      button.textContent = line.text;
      button.dataset.index = String(index);
      button.dataset.time = String(line.t);
      button.setAttribute("aria-label", `跳转到歌词：${line.text}`);
      button.addEventListener("click", () => {
        seekTo(line.t, { autoplay: true });
      });
      fragment.appendChild(button);
    });

    ui.lyricsTrack.replaceChildren(fragment);
    state.activeLyric = 0;
    window.requestAnimationFrame(() => {
      setActiveLyric(0, true);
    });
  }

  function syncLyrics(time, force = false) {
    const lyrics = TRACKS[state.index].lyrics;
    let active = 0;
    for (let i = 0; i < lyrics.length; i++) {
      if (time >= lyrics[i].t) active = i;
      else break;
    }
    if (force || active !== state.activeLyric) {
      setActiveLyric(active, force);
    }
  }

  function setActiveLyric(index, immediate = false) {
    const lines = ui.lyricsTrack.children;
    if (!lines.length) return;
    const target = clamp(index, 0, lines.length - 1);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      line.classList.toggle("is-active", i === target);
      line.classList.toggle("is-past", i < target);
      if (i === target) line.setAttribute("aria-current", "true");
      else line.removeAttribute("aria-current");
    }

    state.activeLyric = target;
    layoutLyrics(immediate);
  }

  function layoutLyrics(immediate = false) {
    const line = ui.lyricsTrack.children[state.activeLyric];
    if (!line) return;
    const viewportHeight = ui.lyricsViewport.clientHeight;
    if (!viewportHeight) return;

    const center = line.offsetTop + line.offsetHeight / 2;
    const offset = viewportHeight / 2 - center;
    const transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;

    if (immediate) {
      const previous = ui.lyricsTrack.style.transition;
      ui.lyricsTrack.style.transition = "none";
      ui.lyricsTrack.style.transform = transform;
      void ui.lyricsTrack.offsetHeight;
      ui.lyricsTrack.style.transition = previous || "";
    } else {
      ui.lyricsTrack.style.transform = transform;
    }
  }

  /* ----------------------------------------------------------
     chrome
     ---------------------------------------------------------- */

  function applyVolume(value, silent = false) {
    const volume = clamp(Number(value) || 0, 0, 1);
    state.volume = volume;
    engine.setVolume(volume);
    ui.volume.value = String(volume);
    setRangeFill(ui.volume, volume * 100);

    const muted = volume <= 0.001;
    ui.muteBtn.dataset.muted = muted ? "true" : "false";
    ui.muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    ui.muteBtn.setAttribute("aria-label", muted ? "取消静音" : "静音");

    if (!silent && muted) ui.muteBtn.dataset.muted = "true";
  }

  function toggleMute() {
    if (state.volume > 0.001) {
      state.lastVolume = state.volume;
      applyVolume(0);
      showToast("已静音");
    } else {
      applyVolume(state.lastVolume || 0.72);
      showToast("已取消静音");
    }
  }

  function toggleShuffle() {
    state.shuffle = !state.shuffle;
    ui.shuffleBtn.classList.toggle("is-on", state.shuffle);
    ui.shuffleBtn.setAttribute("aria-pressed", state.shuffle ? "true" : "false");
    showToast(state.shuffle ? "随机播放已开启" : "随机播放已关闭");
  }

  function cycleRepeat() {
    const order = ["off", "all", "one"];
    const current = order.indexOf(state.repeat);
    state.repeat = order[(current + 1) % order.length];
    const labels = {
      off: "循环播放：关闭",
      all: "循环播放：全部",
      one: "循环播放：单曲"
    };

    ui.repeatBtn.dataset.mode = state.repeat;
    ui.repeatBtn.classList.toggle("is-on", state.repeat !== "off");
    ui.repeatBtn.setAttribute("aria-pressed", state.repeat !== "off" ? "true" : "false");
    ui.repeatBtn.setAttribute("aria-label", labels[state.repeat]);
    showToast(labels[state.repeat]);
  }

  function openQueue() {
    if (state.queueOpen) return;
    state.queueOpen = true;
    app.classList.add("queue-open");
    ui.queue.setAttribute("aria-hidden", "false");
    ui.queue.inert = false;
    ui.queueBtn.setAttribute("aria-expanded", "true");
    ui.shell.inert = true;
    ui.sidebar.inert = true;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => {
      if (state.queueOpen) ui.queueClose.focus({ preventScroll: true });
    }, 120);
  }

  function closeQueue() {
    if (!state.queueOpen) return;
    state.queueOpen = false;
    app.classList.remove("queue-open");
    ui.queueBtn.setAttribute("aria-expanded", "false");
    ui.shell.inert = false;
    ui.sidebar.inert = false;
    document.body.style.overflow = previousBodyOverflow;
    ui.queueBtn.focus({ preventScroll: true });
    ui.queue.setAttribute("aria-hidden", "true");
    ui.queue.inert = true;
  }

  function showToast(message) {
    if (!message) return;
    ui.toast.textContent = message;
    ui.toast.classList.add("is-visible");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      ui.toast.classList.remove("is-visible");
      toastTimer = null;
    }, 2200);
  }

  function filterTracks() {
    const query = ui.searchInput.value.trim().toLowerCase();
    let visible = 0;

    Array.from(ui.sideTracks.querySelectorAll(".side-track")).forEach((row) => {
      const track = TRACKS[Number(row.dataset.index)];
      const haystack = `${track.title} ${track.artist} ${track.album}`.toLowerCase();
      const match = !query || haystack.includes(query);
      row.hidden = !match;
      if (match) visible++;
    });

    ui.sideEmpty.hidden = visible !== 0;
  }

  /* ----------------------------------------------------------
     visual analysis
     ---------------------------------------------------------- */

  function initParticles() {
    const count = reduceMotion ? 18 : (window.innerWidth < 700 ? 30 : 58);
    visuals.particles = Array.from({ length: count }, (_, index) => ({
      x: hash(index * 3.7),
      y: hash(index * 8.1 + 2),
      z: 0.35 + hash(index * 5.3) * 0.65,
      size: 0.6 + hash(index * 2.9) * 1.5,
      speed: 0.0015 + hash(index * 6.4) * 0.006,
      phase: hash(index * 9.2) * Math.PI * 2
    }));
  }

  function updateLevels(now) {
    let spectrum = null;
    if (state.playing) {
      spectrum = engine.readSpectrum();
    }
    state.spectrum = spectrum;

    let target;
    if (spectrum) {
      const average = (start, end) => {
        const from = Math.max(1, start);
        const to = Math.min(spectrum.length, end);
        let sum = 0;
        for (let i = from; i < to; i++) sum += spectrum[i];
        return sum / Math.max(1, to - from) / 255;
      };

      target = {
        bass: clamp(average(1, 8) * 1.9, 0, 1),
        low: clamp(average(8, 23) * 2.0, 0, 1),
        mid: clamp(average(23, 82) * 2.5, 0, 1),
        high: clamp(average(82, 245) * 3.2, 0, 1),
        air: clamp(average(245, 520) * 3.7, 0, 1)
      };
    } else {
      const t = now * 0.001;
      target = {
        bass: 0.14 + 0.045 * (0.5 + 0.5 * Math.sin(t * 0.57)),
        low: 0.12 + 0.04 * (0.5 + 0.5 * Math.sin(t * 0.43 + 1.4)),
        mid: 0.1 + 0.035 * (0.5 + 0.5 * Math.sin(t * 0.38 + 2.6)),
        high: 0.07 + 0.028 * (0.5 + 0.5 * Math.sin(t * 0.51 + 4.1)),
        air: 0.05 + 0.02 * (0.5 + 0.5 * Math.sin(t * 0.47 + 5.2))
      };
    }

    const smoothing = spectrum ? 0.22 : 0.045;
    const levels = state.levels;
    Object.keys(levels).forEach((key) => {
      levels[key] += (target[key] - levels[key]) * smoothing;
    });

    if (Math.abs(levels.bass - state.lastBass) > 0.004) {
      root.style.setProperty("--bass", levels.bass.toFixed(3));
      state.lastBass = levels.bass;
    }

    const scale = 1 + levels.bass * 0.0085;
    if (Math.abs(scale - state.lastScale) > 0.0002) {
      ui.cover.style.transform = `scale(${scale.toFixed(4)})`;
      state.lastScale = scale;
    }
  }

  function resizeAurora() {
    const scale = window.innerWidth < 700 ? 0.8 : 0.62;
    const width = Math.max(280, Math.min(1500, Math.round(window.innerWidth * scale)));
    const height = Math.max(320, Math.min(1000, Math.round(window.innerHeight * scale)));

    if (ui.aurora.width !== width || ui.aurora.height !== height) {
      ui.aurora.width = width;
      ui.aurora.height = height;
    }
    visuals.auroraW = width;
    visuals.auroraH = height;
  }

  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }

  function resizeHalo() {
    const fitted = fitCanvas(ui.halo);
    visuals.haloCtx = fitted.ctx;
    visuals.haloW = fitted.width;
    visuals.haloH = fitted.height;
  }

  function resizeWave() {
    const fitted = fitCanvas(ui.waveCanvas);
    visuals.waveCtx = fitted.ctx;
    visuals.waveW = fitted.width;
    visuals.waveH = fitted.height;
    state.wavePoints = null;
  }

  function drawAurora(now, dt) {
    if (now - state.lastAurora < 32) return;
    state.lastAurora = now;

    const ctx = ui.aurora.getContext("2d");
    const width = visuals.auroraW;
    const height = visuals.auroraH;
    if (!width || !height) return;

    const palette = TRACKS[state.index].palette;
    const colors = palette.aurora;
    const levels = state.levels;
    const time = reduceMotion ? 0 : now * 0.001;
    const longest = Math.max(width, height);

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";

    AURORA_BLOBS.forEach((blob) => {
      const energy = levels[blob.band] || 0;
      const x = (blob.x + Math.sin(time * blob.speed + blob.phase) * 0.035) * width;
      const y = (blob.y + Math.cos(time * blob.speed * 0.8 + blob.phase) * 0.04) * height;
      const radius = longest * blob.r * (0.84 + energy * 0.55);
      const color = colors[blob.color % colors.length];
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);

      gradient.addColorStop(0, rgba(color, 0.15 + energy * 0.19));
      gradient.addColorStop(0.42, rgba(color, 0.055 + energy * 0.09));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    });

    ctx.globalCompositeOperation = "screen";
    const particleSpeed = 1 + levels.high * 2.2;
    visuals.particles.forEach((particle) => {
      if (!reduceMotion) {
        particle.y -= particle.speed * dt * particleSpeed;
        particle.x += Math.sin(time * 0.14 + particle.phase) * 0.000035;
        if (particle.y < -0.03) {
          particle.y = 1.03;
          particle.x = Math.random();
        }
        if (particle.x < -0.02) particle.x = 1.02;
        if (particle.x > 1.02) particle.x = -0.02;
      }

      const alpha = 0.04 + levels.air * 0.32 * particle.z;
      const size = particle.size * (width < 700 ? 0.85 : 1.1);
      ctx.fillStyle = rgba(palette.core, alpha);
      ctx.fillRect(particle.x * width, particle.y * height, size, size);
    });

    ctx.globalCompositeOperation = "source-over";
  }

  function drawHalo(now, dt) {
    const ctx = visuals.haloCtx;
    const width = visuals.haloW;
    const height = visuals.haloH;
    if (!ctx || width < 10 || height < 10) return;

    state.rotation += reduceMotion ? 0 : dt * (state.playing ? 0.07 : 0.018);

    const palette = TRACKS[state.index].palette;
    const levels = state.levels;
    const spectrum = state.spectrum;
    const idleTime = reduceMotion ? 0 : now * 0.0011;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.452;
    const scale = Math.min(width, height) / 700;
    const count = 132;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    /* A fine corona of frequencies, mirrored across the vertical axis. */
    for (let i = 0; i < count; i++) {
      const mirror = i < count / 2 ? i : count - 1 - i;
      const unit = mirror / (count / 2 - 1);
      const bin = Math.min(
        Math.max(2, Math.floor(2 + Math.pow(unit, 1.55) * 370)),
        spectrum ? spectrum.length - 1 : 0
      );

      let energy = 0;
      if (spectrum) {
        energy = Math.pow(spectrum[bin] / 255, 1.2);
      } else {
        energy = 0.035 + 0.03 * (0.5 + 0.5 * Math.sin(idleTime + i * 0.32));
      }

      const angle = state.rotation + (i / count) * Math.PI * 2 - Math.PI / 2;
      const length = (2.5 + energy * 30 + levels.high * 4 + (i % 9 === 0 ? 2 : 0)) * scale;
      const startX = centerX + Math.cos(angle) * radius;
      const startY = centerY + Math.sin(angle) * radius;
      const endX = centerX + Math.cos(angle) * (radius + length);
      const endY = centerY + Math.sin(angle) * (radius + length);
      const alpha = 0.08 + energy * 0.52;
      const warm = i % 11 === 0;

      ctx.strokeStyle = warm
        ? rgba(palette.glow, Math.min(0.62, alpha + 0.06))
        : `rgba(244, 239, 230, ${alpha.toFixed(3)})`;
      ctx.lineWidth = i % 4 === 0 ? 1.25 : 0.95;

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    /* Whisper-thin guide rings. */
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.075)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 2.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(-0.24 + state.rotation * 0.18);
    ctx.scale(1, 0.34);
    ctx.strokeStyle = rgba(palette.glow, 0.055);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.055, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawWave(now) {
    const ctx = visuals.waveCtx;
    const width = visuals.waveW;
    const height = visuals.waveH;
    if (!ctx || width < 10 || height < 5) return;

    ctx.clearRect(0, 0, width, height);

    const data = state.playing ? engine.readWave() : null;
    const palette = TRACKS[state.index].palette;
    const idleTime = reduceMotion ? 0 : now;
    const pointCount = Math.max(36, Math.min(150, Math.floor(width / 3.1)));
    if (!state.wavePoints || state.wavePoints.length !== pointCount) {
      state.wavePoints = new Float32Array(pointCount);
    }

    const points = state.wavePoints;
    let peak = 0.0001;
    if (data) {
      for (let i = 0; i < data.length; i += 8) {
        peak = Math.max(peak, Math.abs((data[i] - 128) / 128));
      }
      const desiredGain = clamp(0.5 / Math.max(peak, 0.035), 1.2, 3.6);
      state.waveGain += (desiredGain - state.waveGain) * 0.03;
    } else {
      state.waveGain += (1 - state.waveGain) * 0.03;
    }

    for (let i = 0; i < pointCount; i++) {
      let target = 0;
      if (data) {
        const index = Math.floor((i / (pointCount - 1)) * (data.length - 1));
        target = clamp(((data[index] - 128) / 128) * state.waveGain, -1, 1);
      } else {
        const x = i / (pointCount - 1);
        target = (
          Math.sin(x * Math.PI * 3.1 + idleTime * 0.00125) * 0.4 * Math.sin(x * Math.PI) +
          Math.sin(x * Math.PI * 7.2 - idleTime * 0.00082) * 0.1
        );
      }
      points[i] += (target - points[i]) * 0.34;
    }

    const mid = height * 0.54;
    const amplitude = height * (state.playing ? 0.55 : 0.23);
    const coords = [];

    for (let i = 0; i < pointCount; i++) {
      const x = (i / (pointCount - 1)) * width;
      const y = mid - points[i] * amplitude;
      coords.push([x, y]);
    }

    ctx.beginPath();
    ctx.moveTo(0, mid);
    coords.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(width, mid);
    for (let i = coords.length - 1; i >= 0; i--) {
      const [x, y] = coords[i];
      ctx.lineTo(x, mid + (mid - y));
    }
    ctx.closePath();

    const fill = ctx.createLinearGradient(0, mid - amplitude, 0, mid + amplitude);
    fill.addColorStop(0, rgba(palette.core, 0.32));
    fill.addColorStop(0.5, rgba(palette.core, 0.05));
    fill.addColorStop(1, rgba(palette.core, 0.32));
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    coords.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "rgba(244, 239, 230, 0.78)";
    ctx.lineWidth = 1.3;
    ctx.lineJoin = "round";
    ctx.shadowColor = rgba(palette.glow, 0.45);
    ctx.shadowBlur = 9;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.075)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();
  }

  /* ----------------------------------------------------------
     interaction
     ---------------------------------------------------------- */

  function initTilt() {
    if (!canHover || reduceMotion) return;
    const cover = ui.cover;

    ui.stageVisual.addEventListener("pointerenter", () => {
      ui.coverTilt.classList.add("is-tilting");
    });

    ui.stageVisual.addEventListener("pointermove", (event) => {
      const rect = cover.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      const px = x - 0.5;
      const py = y - 0.5;

      ui.coverTilt.style.transform = `perspective(1100px) rotateX(${(-py * 6).toFixed(2)}deg) rotateY(${(px * 8).toFixed(2)}deg)`;
      ui.coverSheen.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
      ui.coverSheen.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    });

    ui.stageVisual.addEventListener("pointerleave", () => {
      ui.coverTilt.classList.remove("is-tilting");
      ui.coverTilt.style.transform = "";
      ui.coverSheen.style.setProperty("--mx", "30%");
      ui.coverSheen.style.setProperty("--my", "12%");
    });
  }

  function onSeekInput() {
    state.scrubbing = true;
    const track = TRACKS[state.index];
    const time = clamp(Number(ui.seek.value) || 0, 0, track.duration);
    const percent = track.duration ? (time / track.duration) * 100 : 0;

    setRangeFill(ui.seek, percent);
    ui.elapsed.textContent = formatTime(time);
    ui.remaining.textContent = `-${formatTime(Math.max(0, track.duration - time))}`;
    ui.seek.setAttribute("aria-valuetext", `${formatTime(time)} / ${formatTime(track.duration)}`);
    syncLyrics(time);
  }

  function commitSeek() {
    if (!state.scrubbing) return;
    state.scrubbing = false;
    seekTo(Number(ui.seek.value), { autoplay: false });
  }

  function bindEvents() {
    ui.playBtn.addEventListener("click", togglePlay);
    ui.prevBtn.addEventListener("click", previousTrack);
    ui.nextBtn.addEventListener("click", nextTrack);
    ui.prevTop.addEventListener("click", previousTrack);
    ui.nextTop.addEventListener("click", nextTrack);

    ui.seek.addEventListener("input", onSeekInput);
    ui.seek.addEventListener("change", commitSeek);
    ui.seek.addEventListener("pointerup", () => {
      if (state.scrubbing) commitSeek();
    });
    ui.seek.addEventListener("blur", () => {
      if (state.scrubbing) commitSeek();
    });

    ui.volume.addEventListener("input", () => {
      const value = clamp(Number(ui.volume.value) || 0, 0, 1);
      if (value > 0.001) state.lastVolume = value;
      applyVolume(value);
    });

    ui.muteBtn.addEventListener("click", toggleMute);
    ui.shuffleBtn.addEventListener("click", toggleShuffle);
    ui.repeatBtn.addEventListener("click", cycleRepeat);

    ui.queueBtn.addEventListener("click", openQueue);
    ui.queueClose.addEventListener("click", closeQueue);
    ui.scrim.addEventListener("click", closeQueue);

    ui.sideTracks.addEventListener("click", (event) => {
      const row = event.target.closest(".side-track");
      if (!row) return;
      selectTrack(Number(row.dataset.index), { autoplay: true });
    });

    ui.queueList.addEventListener("click", (event) => {
      const row = event.target.closest(".queue-item");
      if (!row) return;
      selectTrack(Number(row.dataset.index), { autoplay: true });
      window.setTimeout(() => {
        if (state.queueOpen) closeQueue();
      }, 180);
    });

    ui.searchInput.addEventListener("input", filterTracks);

    document.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.nav === "now") return;

        if (button.dataset.nav === "browse") {
          ui.searchInput.focus();
          ui.searchInput.select();
          showToast("在空间声场中搜索");
          return;
        }

        if (!state.shuffle) {
          state.shuffle = true;
          ui.shuffleBtn.classList.add("is-on");
          ui.shuffleBtn.setAttribute("aria-pressed", "true");
        }
        selectTrack(chooseNextIndex(1), { autoplay: true });
        showToast("空间声场电台");
      });
    });

    document.querySelectorAll("#brandHome, .mini-brand").forEach((brand) => {
      brand.addEventListener("click", (event) => event.preventDefault());
    });

    const avatar = $(".avatar");
    if (avatar) {
      avatar.addEventListener("click", () => showToast("本地试听空间 · 未登录"));
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (state.queueOpen) {
          event.preventDefault();
          closeQueue();
          return;
        }
        if (document.activeElement === ui.searchInput) {
          ui.searchInput.value = "";
          filterTracks();
          ui.searchInput.blur();
        }
        return;
      }

      if (state.queueOpen) return;

      const target = event.target;
      const isTyping = target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      );
      if (isTyping) return;

      const isInteractive = target && target.closest && target.closest("button, a, [role='button']");

      if (event.code === "Space") {
        if (isInteractive) return;
        event.preventDefault();
        togglePlay();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        seekRelative(10);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekRelative(-10);
      } else if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        toggleMute();
      }
    });

    let resizeFrame = 0;
    const handleResize = () => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeAurora();
        resizeHalo();
        resizeWave();
        layoutLyrics(false);
        resizeFrame = 0;
      });
    };
    window.addEventListener("resize", handleResize, { passive: true });

    /* Keep the end-of-track logic alive when rAF is suspended in a hidden tab. */
    window.setInterval(() => {
      if (!state.playing || state.ended) return;
      const duration = TRACKS[state.index].duration;
      if (engine.currentTime >= duration - 0.02) handleEnded();
    }, 400);

    if ("ResizeObserver" in window) {
      let observerFrame = 0;
      const observer = new ResizeObserver(() => {
        if (observerFrame) window.cancelAnimationFrame(observerFrame);
        observerFrame = window.requestAnimationFrame(() => {
          resizeHalo();
          resizeWave();
          layoutLyrics(false);
          observerFrame = 0;
        });
      });
      observer.observe(ui.stageVisual);
      observer.observe(ui.lyricsViewport);
    }
  }

  /* ----------------------------------------------------------
     frame
     ---------------------------------------------------------- */

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000));
    state.lastFrame = now;

    /* Idle light can breathe at 30fps; audio-reactive light runs at full rate. */
    if (!state.playing && now - state.lastIdleFrame < 32) {
      window.requestAnimationFrame(frame);
      return;
    }
    state.lastIdleFrame = now;

    if (state.playing) {
      const time = engine.currentTime;
      const duration = TRACKS[state.index].duration;

      if (!state.ended && time >= duration - 0.02) {
        handleEnded();
      } else {
        updateTransport(time);
        if (!state.scrubbing) syncLyrics(time);
      }
    }

    updateLevels(now);
    drawAurora(now, dt);
    drawHalo(now, dt);
    drawWave(now);

    window.requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------------
     boot
     ---------------------------------------------------------- */

  function init() {
    buildLists();
    bindEvents();
    applyVolume(state.volume, true);
    engine.setVolume(state.volume);
    ui.queue.inert = true;
    initParticles();
    initTilt();
    selectTrack(0, { autoplay: false, initial: true });
    resizeAurora();

    window.requestAnimationFrame(() => {
      resizeHalo();
      resizeWave();
      layoutLyrics(true);
      window.requestAnimationFrame(frame);
    });

    window.addEventListener("load", () => {
      resizeHalo();
      resizeWave();
      layoutLyrics(true);
    });
  }

  init();
})();
