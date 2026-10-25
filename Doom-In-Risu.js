//@name DOOM WASM
//@display-name DOOM 플레이
//@api 3.0
//@version 0.2.3

// RisuAI Plugin API v3. Actual engine adapter for franckferman/doom-wasm.
// Automatically downloads doom.wasm from this repository; local file selection remains available as a fallback.
const risu = globalThis.Risuai || globalThis.risuai;
let root = null;
let running = false;
let intervalId = null;
let activeCanvas = null;
let activeInstance = null;
let keyHandlers = null;

const WASM_URL = 'https://raw.githubusercontent.com/Pyser08/Doom-in-RisuAI/main/doom.wasm';

function removeGame() {
  if (intervalId !== null) clearInterval(intervalId);
  intervalId = null;
  if (activeCanvas && keyHandlers) {
    activeCanvas.removeEventListener('keydown', keyHandlers.down);
    activeCanvas.removeEventListener('keyup', keyHandlers.up);
    activeCanvas.removeEventListener('click', keyHandlers.focus);
  }
  activeCanvas = null;
  keyHandlers = null;
  activeInstance = null;
  running = false;
}

function closeUI() {
  removeGame();
  if (root) root.remove();
  root = null;
  try { risu.hideContainer(); } catch (_) {}
}

function mountUI() {
  if (root) return;
  root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;box-sizing:border-box;display:flex;flex-direction:column;background:#050505;color:#eee;font:14px/1.4 system-ui,sans-serif;';

  const logo = document.createElement('div');
  logo.textContent = 'DOOM IN RISUAI';
  logo.style.cssText = 'flex:0 0 auto;text-align:center;padding:15px 12px 13px;background:linear-gradient(180deg,#191919,#090909);color:#f3c36a;font:900 clamp(20px,3.4vw,32px)/1.1 Impact, Haettenschweiler, \"Arial Narrow\", sans-serif;letter-spacing:3px;text-shadow:0 2px 0 #6b1a12,0 0 14px #a33b19;border-bottom:1px solid #4b241b;';

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 12px;background:#171717;border-bottom:1px solid #383838;';
  const heading = document.createElement('strong');
  heading.textContent = 'DOOM · WebAssembly 엔진';
  bar.appendChild(heading);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.wasm,application/wasm';
  fileInput.style.cssText = 'max-width:min(48vw,360px);color:#ddd;';
  fileInput.setAttribute('aria-label', '자동 다운로드 실패 시 doom.wasm 파일 선택');
  fileInput.title = '자동 다운로드가 실패하면 로컬 파일을 선택하세요.';
  bar.appendChild(fileInput);

  const retry = document.createElement('button');
  retry.textContent = '다운로드 다시 시도';
  retry.style.display = 'none';
  bar.appendChild(retry);
  const restart = document.createElement('button');
  restart.textContent = '엔진 다시 시작';
  bar.appendChild(restart);
  const close = document.createElement('button');
  close.textContent = '닫기';
  bar.appendChild(close);
  for (const b of [retry, restart, close]) b.style.cssText = 'padding:6px 10px;border:1px solid #555;border-radius:5px;background:#292929;color:#fff;cursor:pointer;';

  const progressWrap = document.createElement('div');
  progressWrap.style.cssText = 'display:none;padding:7px 12px 9px;background:#101010;';
  const progressTrack = document.createElement('div');
  progressTrack.style.cssText = 'height:8px;overflow:hidden;border-radius:5px;background:#303030;border:1px solid #444;';
  const progressFill = document.createElement('div');
  progressFill.style.cssText = 'width:0%;height:100%;background:linear-gradient(90deg,#9e2b1b,#f3c36a);transition:width .12s linear;';
  progressTrack.appendChild(progressFill);
  const progressLabel = document.createElement('div');
  progressLabel.style.cssText = 'margin-top:4px;color:#c8c8c8;font-size:11px;';
  progressLabel.textContent = '다운로드 준비 중…';
  progressWrap.append(progressTrack, progressLabel);

  const status = document.createElement('div');
  status.style.cssText = 'padding:5px 12px;color:#b9c8d8;background:#101010;';
  status.textContent = 'GitHub에서 DOOM 엔진을 자동으로 불러옵니다…';

  const stage = document.createElement('div');
  stage.style.cssText = 'flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;';
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;outline:none;';
  stage.appendChild(canvas);
  const help = document.createElement('div');
  help.style.cssText = 'padding:7px 12px;background:#171717;color:#ccc;font-size:12px;';
  help.textContent = '조작: 방향키 이동/회전 · Ctrl 발사 · Space 사용 · Shift 달리기 · Alt+방향키 횡이동 · Tab 지도 · Esc 메뉴 · 1–7 무기';

  root.append(logo, bar, progressWrap, status, stage, help);
  document.body.appendChild(root);

  async function start(source, sourceName = 'doom.wasm') {
    removeGame();
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) { status.textContent = '오류: Canvas 2D를 사용할 수 없습니다.'; return; }
    status.textContent = `WASM 읽는 중: ${sourceName}…`;
    try {
      const bytes = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
      let memory = null;
      let imageData = null;
      let frameWidth = 0;
      let frameHeight = 0;
      let logLines = 0;
      const readString = (ptr, len) => {
        if (!memory) return '';
        return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len));
      };
      const imports = {
        loading: {
          onGameInit(width, height) {
            frameWidth = width | 0;
            frameHeight = height | 0;
            canvas.width = frameWidth;
            canvas.height = frameHeight;
            imageData = ctx.createImageData(frameWidth, frameHeight);
            status.textContent = `엔진 초기화: ${frameWidth}×${frameHeight}. 캔버스를 클릭하고 플레이하세요.`;
          },
          // This upstream build embeds the freely distributable shareware WAD.
          wadSizes() {},
          readWads() {}
        },
        ui: {
          drawFrame(ptr) {
            if (!memory || !imageData || frameWidth <= 0 || frameHeight <= 0) return;
            const src = new Uint8Array(memory.buffer, ptr >>> 0, frameWidth * frameHeight * 4);
            const dst = imageData.data;
            // Upstream framebuffer is BGRA in little-endian memory; Canvas expects RGBA.
            for (let i = 0; i < dst.length; i += 4) {
              dst[i] = src[i + 2];
              dst[i + 1] = src[i + 1];
              dst[i + 2] = src[i];
              dst[i + 3] = 255;
            }
            ctx.putImageData(imageData, 0, 0);
          }
        },
        runtimeControl: { timeInMilliseconds: () => BigInt(Math.trunc(performance.now())) },
        console: {
          onInfoMessage(ptr, len) {
            if (logLines++ < 3) console.info('[DOOM WASM]', readString(ptr, len));
          },
          onErrorMessage(ptr, len) {
            const message = readString(ptr, len);
            console.error('[DOOM WASM]', message);
            status.textContent = `엔진 메시지: ${message.slice(0, 240)}`;
          }
        },
        gameSaving: {
          sizeOfSaveGame: () => 0,
          readSaveGame: () => 0,
          writeSaveGame: () => 0
        }
      };
      const result = await WebAssembly.instantiate(bytes, imports);
      const instance = result.instance || result;
      const e = instance.exports;
      if (!e.memory || typeof e.initGame !== 'function' || typeof e.tickGame !== 'function' || typeof e.reportKeyDown !== 'function' || typeof e.reportKeyUp !== 'function') {
        throw new Error('지원하지 않는 WASM 모듈입니다. franckferman/doom-wasm의 doom.wasm이 필요합니다.');
      }
      memory = e.memory;
      activeInstance = instance;
      const keyMap = new Map([
        ['ArrowLeft', e.KEY_LEFTARROW], ['ArrowRight', e.KEY_RIGHTARROW],
        ['ArrowUp', e.KEY_UPARROW], ['ArrowDown', e.KEY_DOWNARROW],
        [',', e.KEY_STRAFE_L], ['.', e.KEY_STRAFE_R],
        ['Control', e.KEY_FIRE], [' ', e.KEY_USE], ['Shift', e.KEY_SHIFT],
        ['Tab', e.KEY_TAB], ['Escape', e.KEY_ESCAPE], ['Enter', e.KEY_ENTER],
        ['Backspace', e.KEY_BACKSPACE], ['Alt', e.KEY_ALT]
      ]);
      const toDoomKey = event => {
        if (keyMap.has(event.key)) return keyMap.get(event.key);
        if (event.key && event.key.length === 1) return event.key.charCodeAt(0);
        return null;
      };
      const down = event => {
        const key = toDoomKey(event);
        if (key !== null && key !== undefined) {
          event.preventDefault(); event.stopPropagation();
          e.reportKeyDown(key);
        }
      };
      const up = event => {
        const key = toDoomKey(event);
        if (key !== null && key !== undefined) {
          event.preventDefault(); event.stopPropagation();
          e.reportKeyUp(key);
        }
      };
      const focus = () => canvas.focus();
      keyHandlers = { down, up, focus };
      activeCanvas = canvas;
      canvas.addEventListener('keydown', down);
      canvas.addEventListener('keyup', up);
      canvas.addEventListener('click', focus);
      canvas.focus();
      e.initGame();
      running = true;
      intervalId = setInterval(() => {
        if (!running || !activeInstance) return;
        try { e.tickGame(); }
        catch (err) {
          removeGame();
          status.textContent = `게임 루프 오류: ${err?.message || String(err)}`;
        }
      }, 1000 / 35);
      status.textContent = '실제 DOOM 엔진 실행 중 · 캔버스를 클릭해 키보드 입력을 활성화하세요.';
    } catch (err) {
      removeGame();
      status.textContent = `실행 실패: ${err?.message || String(err)}`;
      console.error('[DOOM WASM] 시작 실패:', err);
    }
  }

  async function loadRemote() {
    retry.disabled = true;
    retry.style.display = 'none';
    progressWrap.style.display = 'block';
    progressFill.style.width = '0%';
    progressLabel.textContent = 'GitHub에서 doom.wasm 다운로드 중…';
    status.textContent = 'GitHub에서 DOOM 엔진을 다운로드하고 있습니다…';
    try {
      // RisuAI 공식 API의 nativeFetch를 우선 사용해 플러그인 환경의 CORS/프록시 처리를 활용합니다.
      const request = typeof risu.nativeFetch === 'function' ? risu.nativeFetch.bind(risu) : fetch;
      const response = await request(WASM_URL, { method: 'GET' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const totalHeader = response.headers && response.headers.get ? response.headers.get('content-length') : null;
      const total = Number(totalHeader) || 0;
      let bytes;
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          chunks.push(part.value);
          received += part.value.byteLength;
          if (total > 0) {
            const percent = Math.min(100, received / total * 100);
            progressFill.style.width = `${percent}%`;
            progressLabel.textContent = `다운로드 중… ${percent.toFixed(1)}% (${(received / 1048576).toFixed(2)} / ${(total / 1048576).toFixed(2)} MiB)`;
          } else {
            progressFill.style.width = `${Math.max(5, (received / (received + 2 * 1048576)) * 95)}%`;
            progressLabel.textContent = `다운로드 중… ${(received / 1048576).toFixed(2)} MiB`;
          }
        }
        const merged = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
        bytes = merged.buffer;
      } else {
        // 일부 nativeFetch 구현은 스트림을 제공하지 않아 실제 수신량을 표시할 수 없습니다.
        progressFill.style.width = '35%';
        progressLabel.textContent = '파일 수신 완료 대기 중…';
        bytes = await response.arrayBuffer();
      }
      if (bytes.byteLength < 8 || new DataView(bytes).getUint32(0, false) !== 0x0061736d) {
        throw new Error('다운로드한 파일이 올바른 WebAssembly 모듈이 아닙니다.');
      }
      progressFill.style.width = '100%';
      progressLabel.textContent = `다운로드 완료 · ${(bytes.byteLength / 1048576).toFixed(2)} MiB`;
      await start(bytes, `GitHub (${(bytes.byteLength / 1048576).toFixed(2)} MiB)`);
    } catch (err) {
      status.textContent = `자동 다운로드 실패: ${err?.message || String(err)} · 다시 시도하거나 아래에서 doom.wasm 파일을 직접 선택하세요.`;
      progressLabel.textContent = '다운로드 실패';
      progressFill.style.width = '0%';
      retry.disabled = false;
      retry.style.display = 'inline-block';
      console.error('[DOOM WASM] GitHub 다운로드 실패:', err);
    }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) start(file, file.name);
  });
  retry.addEventListener('click', loadRemote);
  restart.addEventListener('click', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) start(file, file.name);
    else loadRemote();
  });
  close.addEventListener('click', closeUI);
  loadRemote();
}

async function openUI() {
  try {
    await risu.showContainer('fullscreen');
    mountUI();
  } catch (err) {
    console.error('[DOOM WASM] 화면 열기 실패:', err);
    if (typeof risu.alertError === 'function') await risu.alertError('DOOM 화면 열기 실패: ' + (err?.message || String(err)));
  }
}

(async () => {
  if (!risu) {
    console.error('[DOOM WASM] RisuAI Plugin API v3를 찾을 수 없습니다.');
    return;
  }
  try {
    if (typeof risu.registerSetting === 'function') {
      await risu.registerSetting('DOOM 플레이', openUI, '', 'none', 'doom-wasm-play-setting');
    }
    if (typeof risu.registerButton === 'function') {
      await risu.registerButton({
        name: 'DOOM 플레이', icon: '', iconType: 'none', location: 'hamburger', id: 'doom-wasm-play-button'
      }, openUI);
    }
    await risu.log('DOOM WASM 플러그인이 로드되었습니다. RisuAI 네트워크 API로 GitHub 엔진을 자동으로 불러옵니다.');
  } catch (err) {
    console.error('[DOOM WASM] UI 등록 실패:', err);
    if (typeof risu.alertError === 'function') await risu.alertError('DOOM UI 등록 실패: ' + (err?.message || String(err)));
  }
})();
