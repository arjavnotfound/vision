const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  session,
} = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
// The renderer draws each surface centred inside a window of exactly this size.
const MODE_BOUNDS = {
  // Orb column: [hint 34] 12 [orb 68] 12 [chip 32] + margins.
  orb: { width: 112, height: 182 },
  // Orb + its hover hint label. Bottom-anchored, so the disc does not move.
  'orb-hint': { width: 380, height: 182 },
  strip: { width: 640, height: 182 },
  console: { width: 1200, height: 780 },
};
const BOTTOM_MARGIN = 12;

// Preferred first; if another app already owns a chord, fall back to the next.
// The renderer and tray always show whichever one actually registered.
const HOTKEY_CANDIDATES = [
  process.env.VISION_HOTKEY,
  'Control+Alt+Space',
  'Control+Shift+Space',
  'Control+Alt+V',
  'Alt+Shift+V',
].filter(Boolean);
const labelFor = (accelerator) => accelerator.replace(/CommandOrControl|Control/g, 'Ctrl');
let HOTKEY = null;
let HOTKEY_LABEL = labelFor(HOTKEY_CANDIDATES[0]);

function registerHotkey() {
  for (const accelerator of HOTKEY_CANDIDATES) {
    try {
      if (globalShortcut.register(accelerator, activate)) {
        HOTKEY = accelerator;
        HOTKEY_LABEL = labelFor(accelerator);
        console.log(`[ELECTRON] Talk hotkey: ${HOTKEY_LABEL}`);
        return true;
      }
    } catch (e) {
      console.error(`[ELECTRON] Invalid hotkey ${accelerator}:`, e.message);
    }
    console.error(`[ELECTRON] Hotkey ${accelerator} is taken by another app`);
  }
  return false;
}

const APP_ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'vision.ico' : 'icon.png');

// Started by C:\VISION\VISION.bat as part of the one VISION app: Face Control owns the
// tray and quitting, and this overlay reports the voice state over the VISION bus.
const ONE_APP = process.env.VISION_ONE_APP === '1';
const BUS_PORT = Number(process.env.VISION_BUS_PORT || 0);
const BUS_TOKEN = process.env.VISION_BUS_TOKEN || '';
const voiceState = { connected: false, live: false };

function postVoiceState() {
  if (!BUS_PORT || !BUS_TOKEN) return;
  const body = JSON.stringify(voiceState);
  const req = http.request(
    {
      host: '127.0.0.1',
      port: BUS_PORT,
      path: '/assistant',
      method: 'POST',
      timeout: 1500,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-vision-token': BUS_TOKEN,
      },
    },
    (res) => res.resume()
  );
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.end(body);
}

let mainWindow = null;
let tray = null;
let currentMode = 'orb';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

function getBoundsForMode(mode) {
  const { workArea } = screen.getPrimaryDisplay();
  const size = MODE_BOUNDS[mode] || MODE_BOUNDS.orb;
  // The console is centred. The orb/strip windows are RIGHT-anchored where the resting
  // orb window's right edge sits, so the strip grows to the left and the mark stays put.
  const orbRight = workArea.x + workArea.width / 2 + MODE_BOUNDS.orb.width / 2;
  const x = Math.round(
    mode === 'console' ? workArea.x + (workArea.width - size.width) / 2 : orbRight - size.width
  );
  const y =
    mode === 'console'
      ? Math.round(workArea.y + (workArea.height - size.height) / 2)
      : Math.round(workArea.y + workArea.height - size.height - BOTTOM_MARGIN);
  return { x, y, ...size };
}

function applyMode(mode) {
  if (!mainWindow || !MODE_BOUNDS[mode]) return;
  currentMode = mode;
  mainWindow.setBounds(getBoundsForMode(mode), false);
}

// ---------------------------------------------------------------------------
// Single instance
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    mainWindow.showInactive();
    activate();
  });
}

function activate() {
  if (!mainWindow) return;
  if (!mainWindow.isVisible()) mainWindow.showInactive();
  mainWindow.webContents.send('vision-activate');
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  const initialMode = argValue('--mode') || 'orb';
  currentMode = MODE_BOUNDS[initialMode] ? initialMode : 'orb';
  const initialBounds = getBoundsForMode(currentMode);

  mainWindow = new BrowserWindow({
    ...initialBounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    focusable: true,
    show: false,
    title: 'VISION',
    // Window + taskbar icon: the VISION logo (.ico on Windows).
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // Dwell activation is not a user gesture; let the agent's voice play anyway.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // Keep the overlay above regular apps without stealing focus.
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Microphone access for LiveKit (and the optional experimental wake word).
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture');
  });
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === 'media' || permission === 'audioCapture'
  );

  const baseUrl = process.env.VISION_URL || 'http://localhost:3000';
  const route = argValue('--route') || '/';
  loadWhenReady(new URL(route, baseUrl).toString());

  setupScreenshotMode();

  // A crashed or frozen renderer would leave a dead orb that only a hand could fix:
  // reload it instead.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[ELECTRON] Renderer gone:', details.reason, '- reloading');
    if (details.reason !== 'clean-exit') setTimeout(() => mainWindow?.webContents.reload(), 500);
  });
  mainWindow.on('unresponsive', () => {
    console.error('[ELECTRON] Renderer unresponsive - reloading');
    mainWindow?.webContents.forcefullyCrashRenderer();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function loadWhenReady(url) {
  const checkServer = () => {
    http
      .get(url, (res) => {
        res.resume();
        if (!mainWindow) return;
        mainWindow.loadURL(url);
        mainWindow.webContents.once('did-finish-load', () => {
          if (mainWindow && !process.argv.includes('--hidden')) mainWindow.showInactive();
        });
      })
      .on('error', () => setTimeout(checkServer, 500));
  };
  checkServer();
}

// `--screenshot <path> [--exit-after-screenshot] [--route /preview?...] [--mode console]
//  [--size 1200x780] [--delay 2500] [--activate]`
function setupScreenshotMode() {
  const outPath = argValue('--screenshot');
  if (!outPath) return;

  const size = argValue('--size');
  if (size) {
    const [width, height] = size.split('x').map(Number);
    if (width && height) mainWindow.setBounds({ ...getBoundsForMode(currentMode), width, height });
  }
  const delay = Number(argValue('--delay') || 2500);

  mainWindow.webContents.once('did-finish-load', () => {
    if (process.argv.includes('--activate')) setTimeout(activate, 600);
    setTimeout(async () => {
      try {
        const image = await mainWindow.webContents.capturePage();
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, image.toPNG());
        console.log(`[ELECTRON] Screenshot written to: ${outPath}`);
      } catch (e) {
        console.error('[ELECTRON] Screenshot failed:', e);
      }
      if (process.argv.includes('--exit-after-screenshot')) app.quit();
    }, delay);
  });
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function createTray() {
  // .ico carries 16/24/32/48 px; Electron picks the right one for the tray.
  const iconPath = process.platform === 'win32' ? APP_ICON : path.join(__dirname, 'assets', 'tray.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip(`VISION — ${HOTKEY_LABEL} to talk`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show VISION', click: () => mainWindow && mainWindow.showInactive() },
      { label: `Talk  (${HOTKEY_LABEL})`, click: () => activate() },
      { label: 'Hide', click: () => mainWindow && mainWindow.hide() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
  );
  tray.on('click', () => mainWindow && mainWindow.showInactive());
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.on('vision-mode', (_event, mode) => applyMode(mode));
ipcMain.handle('vision-hotkey', () => (HOTKEY ? HOTKEY_LABEL : ''));
ipcMain.handle('vision-one-app', () => ONE_APP);
// Stage: the agent gates on "Hey Vision"; the overlay keeps the session listening.
ipcMain.handle('vision-wake-mode', () => process.env.VISION_STAGE === '1' || process.env.VISION_WAKE_GATE === '1');
ipcMain.on('vision-hide', () => mainWindow && mainWindow.hide());
ipcMain.on('vision-quit', () => app.quit());
// { connected, live }: live = the mic is open (strip/console showing and not muted).
ipcMain.on('vision-voice-state', (_event, state) => {
  const next = { connected: Boolean(state?.connected), live: Boolean(state?.live) };
  if (next.connected === voiceState.connected && next.live === voiceState.live) return;
  Object.assign(voiceState, next);
  postVoiceState();
});

ipcMain.handle('vision-capture', async (_event, outPath) => {
  if (!mainWindow) return false;
  const image = await mainWindow.webContents.capturePage();
  fs.writeFileSync(outPath, image.toPNG());
  return true;
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  createWindow();
  if (!argValue('--screenshot')) {
    registerHotkey();
    if (!ONE_APP) {
      try {
        createTray();
      } catch (e) {
        console.error('[ELECTRON] Tray unavailable:', e);
      }
    }
    // Heartbeat: Face Control treats a silent overlay as voice off.
    postVoiceState();
    setInterval(postVoiceState, 4000).unref();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  voiceState.connected = false;
  voiceState.live = false;
  postVoiceState();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('[ELECTRON ERROR]', err);
});
