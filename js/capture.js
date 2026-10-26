/*
 * 学习内容的语音 / 拍照识别录入。
 * - 语音：浏览器自带的 Web Speech API（SpeechRecognition），不需要密钥。
 * - 拍照：Tesseract.js 在本机浏览器里做文字识别（首次使用时才从 CDN 加载），照片不会上传。
 * 文本处理的纯函数可在 Node 中测试，浏览器相关的部分只在调用时才访问 window。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Capture = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
  const OCR_LANG = 'chi_sim+eng';
  const MAX_SIDE = 2000;
  const MAX_FILE_BYTES = 30 * 1024 * 1024;
  const INIT_TIMEOUT_MS = 120000;
  const MAX_SILENT_ROUNDS = 3;

  // ---------------- 文本处理（纯函数） ----------------
  const CJK = '\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef\\u3000-\\u303f';
  const SPACE_BEFORE_CJK = new RegExp(`[ \\t\\u00a0]+(?=[${CJK}])`, 'g');
  const SPACE_AFTER_CJK = new RegExp(`([${CJK}])[ \\t\\u00a0]+`, 'g');
  const END_PUNCT = /[，。！？；：、,.!?;:\n）)」”’…]$/;

  // 中文识别结果里汉字之间常带多余空格，去掉与汉字相邻的空格，保留英文单词间的空格
  function squeezeCjkSpaces(s) {
    return String(s || '').replace(SPACE_BEFORE_CJK, '').replace(SPACE_AFTER_CJK, '$1');
  }

  function cleanOcrText(raw) {
    const lines = String(raw || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => squeezeCjkSpaces(l).replace(/[ \t ]{2,}/g, ' ').trim())
      // 丢弃只有零星符号的噪声行（如 "|"、"—"、"~"）
      .filter((l) => l && /[\p{L}\p{N}]/u.test(l));
    return lines.join('\n');
  }

  // 语音识别的一段话接到已有内容后面
  function appendSpeech(existing, text, lang) {
    const add = squeezeCjkSpaces(String(text || '').trim());
    if (!add) return existing || '';
    const base = String(existing || '').replace(/[ \t]+$/, '');
    if (!base.trim()) return add;
    if (base.endsWith('\n')) return base + add;
    const zh = /^(zh|yue|ja|ko)/i.test(lang || '');
    if (zh) return base + (END_PUNCT.test(base) ? '' : '，') + add;
    return `${base} ${add}`;
  }

  // 拍照识别的一整块文字另起一行
  function appendBlock(existing, text) {
    const add = String(text || '').trim();
    if (!add) return existing || '';
    const base = String(existing || '').replace(/\s+$/, '');
    return base ? `${base}\n${add}` : add;
  }

  function fitText(text, max) {
    if (text.length <= max) return { text, truncated: false };
    return { text: text.slice(0, max), truncated: true };
  }

  // 拉伸灰度对比度，让阴影、偏暗的手机照片更容易识别。px 是 canvas 的 RGBA 数据，原地修改
  function enhanceGray(px) {
    const n = px.length / 4;
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const g = ((px[o] * 299 + px[o + 1] * 587 + px[o + 2] * 114) / 1000) | 0;
      px[o] = g;
      hist[g]++;
    }
    const at = (p) => {
      const target = n * p;
      let acc = 0;
      for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc >= target) return v;
      }
      return 255;
    };
    const lo = at(0.01);
    const hi = at(0.99);
    const span = hi - lo;
    const k = span >= 40 ? 255 / span : 1;
    const base = span >= 40 ? lo : 0;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      let v = (px[o] - base) * k;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      px[o] = px[o + 1] = px[o + 2] = v;
      px[o + 3] = 255;
    }
  }

  function voiceLangFor(subjectId) {
    return subjectId === 'english' ? 'en-US' : 'zh-CN';
  }

  function describeVoiceError(code) {
    switch (code) {
      case 'not-allowed':
        return '没有麦克风权限。请点浏览器地址栏左边的图标，允许使用麦克风后再试。';
      case 'service-not-allowed':
        return '语音识别服务没有开启。iPhone 请到「设置 → 通用 → 键盘」打开「启用听写」，微信等内置浏览器请改用 Safari / Chrome 打开。';
      case 'audio-capture':
        return '找不到麦克风，请检查设备。';
      case 'network':
        return '语音识别服务连不上（需要联网，部分浏览器的语音服务在国内不可用）。可以换 Safari / Edge 浏览器，或用输入法键盘上的话筒键说话。';
      case 'language-not-supported':
        return '这个浏览器不支持所选的语言。';
      case 'no-speech':
        return '一直没有听到声音，已停止。再点一次 🎤 重新开始。';
      case 'unsupported':
        return '当前浏览器不支持语音输入。可以用 Chrome / Edge / Safari 打开，或直接用输入法键盘上的话筒键说话。';
      default:
        return `语音识别出错了（${code}），请再试一次。`;
    }
  }

  function describeOcrError(err) {
    const code = err && err.code;
    if (code === 'not-image') return '请选择一张图片。';
    if (code === 'too-large') return '图片太大了（超过 30MB），请换一张。';
    if (code === 'decode') return '这张图片打不开，请换一张或重新拍一张。';
    if (code === 'engine' || code === 'timeout') return '识别引擎没能加载成功，请检查网络后再试（首次使用需要联网下载约 5MB）。';
    return '识别失败了，请重新拍一张试试。';
  }

  // ---------------- 语音 ----------------
  const FATAL_VOICE_ERRORS = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'];

  const voice = (function () {
    let rec = null;
    let wanted = false;
    let h = null;
    let gotResult = false;
    let silentRounds = 0;

    function Ctor() {
      return typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    function finish() {
      wanted = false;
      rec = null;
      if (h) {
        h.onInterim('');
        h.onState(false);
      }
    }

    function begin() {
      const R = Ctor();
      rec = new R();
      gotResult = false;
      rec.lang = h.lang;
      // 单句模式 + 自动续听，避免部分安卓浏览器在连续模式下重复返回同一句话
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onstart = () => h.onState(true);
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            gotResult = true;
            h.onText(r[0].transcript);
          } else {
            interim += r[0].transcript;
          }
        }
        h.onInterim(interim);
      };
      rec.onerror = (e) => {
        const code = e.error;
        if (code === 'aborted') return;
        if (code === 'no-speech') return; // 由 onend 统计静音轮数
        h.onError(code);
        if (FATAL_VOICE_ERRORS.includes(code)) wanted = false;
      };
      rec.onend = () => {
        rec = null;
        h.onInterim('');
        if (!wanted) return h.onState(false);
        silentRounds = gotResult ? 0 : silentRounds + 1;
        if (silentRounds >= MAX_SILENT_ROUNDS) {
          h.onError('no-speech');
          return finish();
        }
        setTimeout(() => {
          if (wanted && !rec) {
            try { begin(); } catch (err) { h.onError('start-failed'); finish(); }
          }
        }, 150);
      };
      rec.start();
    }

    return {
      supported: () => !!Ctor(),
      isListening: () => !!rec || wanted,
      // handlers: { lang, onText(text), onInterim(text), onState(bool), onError(code) }
      start(handlers) {
        if (!Ctor()) return handlers.onError('unsupported');
        if (wanted) return;
        h = handlers;
        wanted = true;
        silentRounds = 0;
        try {
          begin();
        } catch (e) {
          h.onError('start-failed');
          finish();
        }
      },
      stop() {
        if (!wanted && !rec) return;
        wanted = false;
        if (rec) {
          try { rec.stop(); } catch (e) { finish(); }
        } else if (h) {
          h.onState(false);
        }
      },
    };
  })();

  // ---------------- 拍照识别 ----------------
  const ocr = (function () {
    let libPromise = null;
    let worker = null;
    let workerLang = null;
    let progress = () => {};

    function fail(code, cause) {
      const e = new Error(code);
      e.code = code;
      e.cause = cause;
      return e;
    }

    function loadLib() {
      if (window.Tesseract) return Promise.resolve();
      if (!libPromise) {
        libPromise = new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = TESSERACT_URL;
          s.onload = () => resolve();
          s.onerror = () => reject(fail('engine'));
          document.head.appendChild(s);
        }).catch((e) => {
          libPromise = null;
          throw e;
        });
      }
      return libPromise;
    }

    function onLog(m) {
      const s = String(m.status || '');
      const pct = Math.round((m.progress || 0) * 100);
      if (s.startsWith('loading language')) progress({ text: `正在下载识别模型（首次约 5MB，之后不用再下）${pct ? ` ${pct}%` : '…'}`, percent: pct });
      else if (s.startsWith('recognizing')) progress({ text: `正在识别文字 ${pct}%`, percent: pct });
      else if (s.startsWith('loading') || s.startsWith('initializ')) progress({ text: '正在准备识别引擎…', percent: null });
    }

    async function getWorker(lang) {
      await loadLib();
      if (worker && workerLang === lang) return worker;
      if (worker) {
        await worker.terminate().catch(() => {});
        worker = null;
      }
      let timer;
      try {
        const created = window.Tesseract.createWorker(lang, 1, { logger: onLog });
        const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(fail('timeout')), INIT_TIMEOUT_MS); });
        worker = await Promise.race([created, timeout]);
        workerLang = lang;
        return worker;
      } catch (e) {
        worker = null;
        throw e.code ? e : fail('engine', e);
      } finally {
        clearTimeout(timer);
      }
    }

    async function decode(file) {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) {
        // 老版本浏览器不支持 createImageBitmap 的选项，改用 <img>（会自动按 EXIF 旋转）
        const url = URL.createObjectURL(file);
        try {
          return await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(fail('decode'));
            img.src = url;
          });
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
    }

    async function prepare(file) {
      const src = await decode(file);
      const w = src.width || src.naturalWidth;
      const h = src.height || src.naturalHeight;
      if (!w || !h) throw fail('decode');
      const k = Math.min(1, MAX_SIDE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * k));
      canvas.height = Math.max(1, Math.round(h * k));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      if (src.close) src.close();
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      enhanceGray(img.data);
      ctx.putImageData(img, 0, 0);
      return canvas;
    }

    return {
      // onProgress({ text, percent })；返回识别出的原始文字
      async recognize(file, onProgress) {
        if (!file || !/^image\//.test(file.type || '')) throw fail('not-image');
        if (file.size > MAX_FILE_BYTES) throw fail('too-large');
        progress = onProgress || (() => {});
        progress({ text: '正在处理照片…', percent: null });
        const canvas = await prepare(file);
        const w = await getWorker(OCR_LANG);
        const { data } = await w.recognize(canvas);
        return { text: data.text || '', confidence: data.confidence };
      },
    };
  })();

  return {
    squeezeCjkSpaces, cleanOcrText, appendSpeech, appendBlock, fitText, enhanceGray,
    voiceLangFor, describeVoiceError, describeOcrError,
    voice, ocr,
  };
});
