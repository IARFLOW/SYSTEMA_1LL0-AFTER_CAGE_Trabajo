// Hecho con scripts/screen-viejo.mjs a partir de screen.js. No se toca a mano.
"use strict";
if (!Element.prototype.append) {
  Element.prototype.append = function () {
    for (var i = 0; i < arguments.length; i += 1) {
      var n = arguments[i];
      this.appendChild(typeof n === "string" ? document.createTextNode(n) : n);
    }
  };
}
if (!Object.getOwnPropertyDescriptors) {
  Object.getOwnPropertyDescriptors = function (o) {
    var r = {};
    Reflect.ownKeys(o).forEach(function (k) { r[k] = Object.getOwnPropertyDescriptor(o, k); });
    return r;
  };
}
if (!String.prototype.padStart) {
  String.prototype.padStart = function (n, c) {
    var s = String(this), f = c === undefined ? " " : String(c);
    while (f && s.length < n) s = f + s;
    return s;
  };
}
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };
  var _a;
  const $ = (id) => document.getElementById(id);
  const video = $("video");
  const clip = $("clip");
  const clipLabel = $("clip-label");
  const clipTime = $("clip-time");
  const tag = $("tag");
  const ident = $("ident");
  const name = decodeURIComponent((_a = location.pathname.split("/")[2]) != null ? _a : "").toLowerCase();
  document.title = "Systema \xB7 ".concat(name || "pantalla");
  const TOUCH = navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches;
  const VERSION = new URLSearchParams(location.search).get("version") || (TOUCH ? "tablet" : "monitor");
  const IPAD = /iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  const fileOf = (v) => {
    var _a2, _b;
    return (_b = (_a2 = v.files) == null ? void 0 : _a2[VERSION]) != null ? _b : v.file;
  };
  let current = null;
  let online = null;
  let clipTimer = null;
  let devMode = false;
  let sock = null;
  function silence() {
    const n = 800;
    const v = new DataView(new ArrayBuffer(44 + n));
    const text = (at, s) => {
      for (let i = 0; i < s.length; i += 1) v.setUint8(at + i, s.charCodeAt(i));
    };
    text(0, "RIFF");
    v.setUint32(4, 36 + n, true);
    text(8, "WAVEfmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 8e3, true);
    v.setUint32(28, 8e3, true);
    v.setUint16(32, 1, true);
    v.setUint16(34, 8, true);
    text(36, "data");
    v.setUint32(40, n, true);
    for (let i = 0; i < n; i += 1) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([v.buffer], { type: "audio/wav" }));
  }
  function canSoundWithoutTouch() {
    return __async(this, null, function* () {
      if (navigator.getAutoplayPolicy) return navigator.getAutoplayPolicy("mediaelement") === "allowed";
      const a = new Audio(silence());
      try {
        yield a.play();
        a.pause();
        return true;
      } catch (e) {
        return false;
      }
    });
  }
  let sound = false;
  let tagTimer = null;
  function say(text, { call = false, fade = 0 } = {}) {
    clearTimeout(tagTimer);
    tag.textContent = text;
    if (call) tag.append(Object.assign(document.createElement("i"), { className: "caret" }));
    tag.classList.toggle("call", call);
    tag.classList.remove("gone");
    if (fade) tagTimer = setTimeout(() => tag.classList.add("gone"), fade);
  }
  function status() {
    if (!name) return say("a esta direcci\xF3n le falta el nombre de la pantalla, por ejemplo /screen/tele1", { call: true });
    if (online === null) return say("".concat(name, " \xB7 conectando"));
    if (!online) return say("".concat(name, " \xB7 sin conexi\xF3n con la sala \xB7 reintentando"));
    if (!sound) return say("".concat(name, " \xB7 toca la pantalla para activar el sonido"), { call: true });
    return say("".concat(name, " \xB7 conectada"), { fade: 4e3 });
  }
  let lastError = null;
  let waiting = false;
  let reportTimer = null;
  let lastReport = "";
  function report() {
    if (reportTimer) return;
    reportTimer = setTimeout(() => {
      var _a2;
      reportTimer = null;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      const msg = JSON.stringify({
        type: "screen:status",
        sound,
        playing: (_a2 = current == null ? void 0 : current.id) != null ? _a2 : null,
        paused: Boolean(current == null ? void 0 : current.file) && video.paused,
        waiting: Boolean(current == null ? void 0 : current.file) && waiting,
        error: lastError,
        version: VERSION,
        size: "".concat(screen.width, "\xD7").concat(screen.height),
        hidden: document.hidden
      });
      if (msg === lastReport) return;
      lastReport = msg;
      sock.send(msg);
    }, 300);
  }
  function fmt(s) {
    s = Math.max(0, Math.round(s));
    return "".concat(Math.floor(s / 60), "'").concat(String(s % 60).padStart(2, "0"), '"');
  }
  function stopVideo() {
    video.pause();
    if (video.getAttribute("src")) {
      video.removeAttribute("src");
      video.load();
    }
    video.hidden = true;
  }
  function blank() {
    clearInterval(clipTimer);
    video.playbackRate = 1;
    clearTimeout(stallTimer);
    clearTimeout(retryTimer);
    waiting = false;
    clip.hidden = true;
    stopVideo();
  }
  function start() {
    video.muted = !sound;
    video.play().catch((err) => {
      if (err.name !== "NotAllowedError" || video.muted) return;
      sound = false;
      status();
      report();
      video.muted = true;
      video.play().catch(() => {
      });
    });
  }
  let offset = null;
  let samples = [];
  let clockTimer = null;
  function askTime() {
    if ((sock == null ? void 0 : sock.readyState) === WebSocket.OPEN) sock.send(JSON.stringify({ type: "time", c: performance.now() }));
  }
  function onTime(msg) {
    const rtt = performance.now() - msg.c;
    if (!(rtt >= 0) || !Number.isFinite(msg.s)) return;
    samples.push({ rtt, offset: msg.s - (msg.c + rtt / 2) });
    if (samples.length > 8) samples.shift();
    offset = samples.reduce((a, b) => b.rtt < a.rtt ? b : a).offset;
  }
  function startClock() {
    clearInterval(clockTimer);
    offset = null;
    samples = [];
    for (let i = 0; i < 5; i += 1) setTimeout(askTime, i * 250);
    clockTimer = setInterval(askTime, 5e3);
  }
  function elapsed() {
    if (!current) return 0;
    if (offset !== null && Number.isFinite(current.start)) return (performance.now() + offset - current.start) / 1e3;
    return (performance.now() - current.t0) / 1e3;
  }
  const SALTO = 0.3;
  const CLAVADO = 0.01;
  const PARTITURA = 900;
  let lead = 0.1;
  let seekAt = 0;
  let afterSeek = false;
  function keepPace() {
    if (!(current == null ? void 0 : current.file) || video.paused || video.seeking || video.readyState < 3 || !Number.isFinite(video.duration)) return;
    const want = elapsed();
    if (want < 0 || want >= video.duration) return;
    const ahead = video.currentTime - want;
    if (afterSeek) {
      afterSeek = false;
      if (Math.abs(ahead) < 1) lead = Math.min(1, Math.max(0, lead - ahead));
    }
    if (Math.abs(ahead) > SALTO) {
      if (performance.now() - seekAt < 2e3) return;
      seekAt = performance.now();
      afterSeek = true;
      video.playbackRate = 1;
      video.currentTime = Math.min(want + lead, video.duration);
      return;
    }
    if (!(current.num >= PARTITURA)) {
      if (video.playbackRate !== 1) video.playbackRate = 1;
      return;
    }
    video.playbackRate = Math.abs(ahead) < CLAVADO ? 1 : 1 - Math.max(-0.1, Math.min(0.1, ahead * 0.8));
  }
  setInterval(() => {
    keepPace();
    awakeTick();
  }, 250);
  let soloSonido = /* @__PURE__ */ new Set();
  let conocidos = /* @__PURE__ */ new Set();
  let leyendo = 0;
  let catVisto = null;
  function pintarNegro() {
    video.classList.toggle("negro", Boolean(current && current.file && soloSonido.has(current.id)));
  }
  function leerSoloSonido() {
    if (leyendo && performance.now() - leyendo < 1e4) return;
    const esta = performance.now();
    leyendo = esta;
    const fin = () => {
      if (leyendo === esta) leyendo = 0;
      pintarNegro();
    };
    fetch("/contents.json", { cache: "no-cache" }).then((r) => r.json()).then((c) => {
      conocidos = new Set(Object.keys(c));
      soloSonido = new Set(Object.keys(c).filter((id) => c[id] && c[id].audio));
    }).then(fin, fin);
  }
  leerSoloSonido();
  function load(join) {
    current.join = join;
    video.playbackRate = 1;
    seekAt = 0;
    afterSeek = false;
    clip.hidden = true;
    video.hidden = false;
    pintarNegro();
    if (!conocidos.has(current.id)) leerSoloSonido();
    video.src = fileOf(current);
    start();
    armStall();
  }
  function show(v) {
    var _a2;
    if (!v || v.duration > 0 && v.at >= v.duration) {
      current = null;
      blank();
      report();
      return;
    }
    const id = (_a2 = v.shot) != null ? _a2 : v.since;
    if (current && current.shotId === id) {
      current.start = v.start;
      current.t0 = performance.now() - v.at * 1e3;
      if (current.file && (video.error || video.paused && !video.ended || video.readyState < 2)) load(true);
      return;
    }
    const t0 = performance.now() - v.at * 1e3;
    current = __spreadProps(__spreadValues({}, v), { t0, shotId: id });
    lastError = null;
    clearInterval(clipTimer);
    if (v.file) {
      load(v.at >= 1);
    } else if (devMode) {
      stopVideo();
      clipLabel.textContent = v.label;
      clip.hidden = false;
      const tick = () => {
        const left = v.duration - (performance.now() - t0) / 1e3;
        if (left <= 0) {
          current = null;
          blank();
          return;
        }
        clipTime.textContent = fmt(left);
      };
      tick();
      clipTimer = setInterval(tick, 250);
    } else {
      stopVideo();
      lastError = "\xAB".concat(v.label, "\xBB no tiene v\xEDdeo en media/");
    }
    report();
  }
  video.addEventListener("loadedmetadata", () => {
    if (!current) return;
    const at = elapsed();
    if ((current.join || at > 0.1) && at < video.duration) video.currentTime = at;
  });
  video.addEventListener("ended", () => {
    current = null;
    blank();
    report();
  });
  video.addEventListener("playing", () => {
    lastError = null;
    waiting = false;
    report();
  });
  video.addEventListener("waiting", () => {
    waiting = true;
    report();
  });
  video.addEventListener("pause", report);
  let retryTimer = null;
  video.addEventListener("error", () => {
    var _a2, _b;
    if (!video.getAttribute("src") || !current) return;
    const code = (_a2 = video.error) == null ? void 0 : _a2.code;
    const what = (_b = { 1: "cortado", 2: "de red", 3: "al decodificar", 4: "de red o de fichero" }[code]) != null ? _b : "";
    lastError = "no puedo poner \xAB".concat(current.label, "\xBB (error ").concat(what || code, ")");
    if (devMode) say("".concat(name, " \xB7 ").concat(lastError, " (").concat(video.getAttribute("src"), ")"), { fade: 1e4 });
    report();
    if (code === 2 || code === 4) {
      const shot = current.shotId;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if ((current == null ? void 0 : current.shotId) === shot && elapsed() < current.duration - 1) load(true);
      }, 3e3);
      return;
    }
    current = null;
    blank();
    setTimeout(status, devMode ? 10500 : 0);
  });
  let stallTimer = null;
  let lastTime = -1;
  function armStall() {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (!(current == null ? void 0 : current.file) || video.ended) return;
      if (elapsed() >= current.duration - 1) return;
      load(true);
    }, 8e3);
  }
  video.addEventListener("timeupdate", () => {
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      armStall();
    }
  });
  const awake = $("awake");
  const SAFARI = navigator.vendor === "Apple Computer, Inc.";
  if (TOUCH) {
    awake.src = "/despierta.mp4";
    awake.hidden = false;
  }
  function mainKeepsAwake() {
    if (video.hidden || video.paused || video.ended) return false;
    if (!SAFARI) return true;
    if (video.readyState < 1) return true;
    return !video.muted && video.volume > 0 && !(video.audioTracks && video.audioTracks.length === 0);
  }
  function awakeTick() {
    if (!TOUCH || document.hidden) return;
    if (mainKeepsAwake()) {
      if (!awake.paused) awake.pause();
      return;
    }
    awake.muted = !(SAFARI && sound);
    if (awake.paused) awake.play().catch(() => {
    });
  }
  awake.addEventListener("ended", awakeTick);
  let lock = null;
  function keepAwake() {
    return __async(this, null, function* () {
      if (lock || !("wakeLock" in navigator)) return;
      try {
        lock = yield navigator.wakeLock.request("screen");
        lock.addEventListener("release", () => {
          lock = null;
        });
      } catch (e) {
      }
    });
  }
  function fullscreen() {
    var _a2, _b, _c, _d;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    if (IPAD) return;
    const el = document.documentElement;
    try {
      (_d = (_c = (_b = (_a2 = el.requestFullscreen) != null ? _a2 : el.webkitRequestFullscreen) == null ? void 0 : _b.call(el, { navigationUI: "hide" })) == null ? void 0 : _c.catch) == null ? void 0 : _d.call(_c, () => {
      });
    } catch (e) {
    }
  }
  function touch() {
    if (!sound) {
      sound = true;
      video.muted = false;
      video.playbackRate = 1;
      if (current == null ? void 0 : current.file) video.play().catch(() => {
      });
      else video.load();
      report();
    }
    keepAwake();
    awakeTick();
    fullscreen();
    status();
  }
  document.addEventListener("touchend", touch);
  document.addEventListener("click", touch);
  document.addEventListener("visibilitychange", () => {
    report();
    if (document.hidden) return;
    keepAwake();
    samples = [];
    for (let i = 0; i < 3; i += 1) setTimeout(askTime, i * 150);
    if (!(current == null ? void 0 : current.file)) return;
    if (elapsed() >= current.duration) {
      current = null;
      blank();
      report();
      return;
    }
    if (video.paused && !video.ended) {
      if (Number.isFinite(video.duration) && elapsed() < video.duration) video.currentTime = elapsed();
      start();
    }
  });
  let identTimer = null;
  function identify(seconds = 8) {
    ident.textContent = name;
    ident.hidden = false;
    clearTimeout(identTimer);
    identTimer = setTimeout(() => {
      ident.hidden = true;
    }, seconds * 1e3);
  }
  let retry = 1e3;
  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const s = new WebSocket("".concat(proto, "://").concat(location.host, "/ws"));
    sock = s;
    let gone = false;
    let beatMs = 0;
    const lost = () => {
      if (gone) return;
      gone = true;
      clearTimeout(watchdog);
      try {
        s.close();
      } catch (e) {
      }
      online = false;
      status();
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 1e4);
    };
    let watchdog = setTimeout(lost, 8e3);
    s.addEventListener("open", () => {
      retry = 1e3;
      lastReport = "";
      s.send(JSON.stringify({ type: "hello", role: "screen", name }));
      startClock();
    });
    s.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg.beat > 0) beatMs = msg.beat * 1e3;
      clearTimeout(watchdog);
      watchdog = setTimeout(lost, beatMs ? beatMs * 2.5 : 25e3);
      if (msg.type === "snapshot") {
        devMode = Boolean(msg.dev);
        online = true;
        status();
      }
      if (msg.cat && msg.cat !== catVisto) {
        if (catVisto) leerSoloSonido();
        catVisto = msg.cat;
      }
      if (msg.type === "snapshot" || msg.type === "video") show(msg.video);
      if (msg.type === "time") onTime(msg);
      if (msg.type === "identify") identify(msg.seconds);
      if (msg.type === "reload") location.reload();
      if (msg.type === "snapshot") report();
    });
    s.addEventListener("close", lost);
    s.addEventListener("error", lost);
  }
  status();
  keepAwake();
  if (name) connect();
  canSoundWithoutTouch().then((ok) => {
    if (!ok || sound) return;
    sound = true;
    video.muted = false;
    video.playbackRate = 1;
    status();
    report();
  });
})();
