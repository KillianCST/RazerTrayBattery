const {
  app,
  Tray,
  Menu,
  BrowserWindow,
  ipcMain,
  nativeImage
} = require('electron');

const path = require('path');
const HID = require('node-hid');
const { WebUSB } = require('usb');

if (require('electron-squirrel-startup')) app.quit();

const RAZER_VENDOR_ID = 0x1532;
const rootPath = app.getAppPath();

let tray = null;
let settingsWindow = null;
let pollTimer = null;

/**
 * devices = Map<key, device>
 * device = {
 *   key,
 *   vendorId,
 *   productId,
 *   productName,
 *   hasBattery
 * }
 */
const devices = new Map();
let activeKey = null;

/* =========================
   APP
   ========================= */

app.whenReady().then(() => {
  tray = new Tray(getIconForPercent(0));
  tray.setToolTip('No device selected');
  tray.on('click', openSettings);

  refreshDevices();
  rebuildTrayMenu();
  startPolling();
});

app.on('window-all-closed', (e) => e.preventDefault());

/* =========================
   DEVICE DETECTION (node-hid)
   ========================= */

function refreshDevices() {
  devices.clear();

  const list = HID.devices().filter(d => d.vendorId === RAZER_VENDOR_ID);

  for (const d of list) {
    const key = `${d.vendorId}:${d.productId}`;

    if (!devices.has(key)) {
      devices.set(key, {
        key,
        vendorId: d.vendorId,
        productId: d.productId,
        productName: d.product || 'Razer Device',
        hasBattery: !d.product?.toLowerCase().includes('essential') //temp?
      });
    }
  }

  if (!activeKey && devices.size > 0) {
    activeKey = [...devices.keys()][0];
  }

  console.log('DEVICES:', [...devices.values()].map(d => d.productName));
}

/* =========================
   TRAY
   ========================= */

function rebuildTrayMenu() {
  const active = devices.get(activeKey);

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Razer Battery', enabled: false },
    { type: 'separator' },
    active
      ? { label: `Active: ${active.productName}`, enabled: false }
      : { label: 'No device selected', enabled: false },
    { type: 'separator' },
    { label: 'Settings…', click: openSettings },
    {
        label: 'Quit',
            click: () => {
                tray.destroy();
                app.exit(0);
        }
    }
  ]));
}

/* =========================
   SETTINGS WINDOW
   ========================= */

function openSettings() {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    title: 'Razer Battery – Settings',
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js')
    }
  });

  settingsWindow.setMenu(null);
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.on('close', e => {
    e.preventDefault();
    settingsWindow.hide();
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

/* =========================
   IPC – SETTINGS
   ========================= */

ipcMain.handle('devices:list', () => {
  return {
    devices: [...devices.values()],
    activeKey
  };
});

ipcMain.handle('devices:refresh', () => {
  refreshDevices();
  rebuildTrayMenu();
  return {
    devices: [...devices.values()],
    activeKey
  };
});

ipcMain.handle('devices:request', () => {
  refreshDevices();
  rebuildTrayMenu();
  return {
    devices: [...devices.values()],
    activeKey
  };
});


ipcMain.handle('devices:setActive', (_e, key) => {
  if (devices.has(key)) {
    activeKey = key;
    rebuildTrayMenu();
    updateTray();
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle('devices:batteryStatus', async (_e, key) => {
  const device = devices.get(key);
  if (!device) return { status: 'disconnected' };
  if (!device.hasBattery) return { status: 'no-battery' };

  const pct = await readBatteryWebUSB(device);
  if (pct == null) return { status: 'connected' };

  return { status: 'ok', percent: pct };
});

ipcMain.handle('settings:getAutoStart', () => {
  const settings = app.getLoginItemSettings();
  return settings.openAtLogin;
});

ipcMain.handle('settings:setAutoStart', (_evt, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true
  });
  return true;
});

/* =========================
   POLLING / TRAY UPDATE
   ========================= */

function startPolling() {
  updateTray();
  pollTimer = setInterval(updateTray, 15000);
}

async function updateTray() {
  const device = devices.get(activeKey);

  if (!device) {
    tray.setImage(getIconForPercent(0));
    tray.setToolTip('No active device');
    return;
  }

  if (!device.hasBattery) {
    tray.setImage(getIconForPercent(0));
    tray.setToolTip(`${device.productName} – No battery`);
    return;
  }

  try {
    const percent = await readBatteryWebUSB(device);

    if (percent == null) {
      tray.setImage(getIconForPercent(0));
      tray.setToolTip(`${device.productName} – Connected`);
      return;
    }

    tray.setImage(getIconForPercent(percent));
    tray.setToolTip(`${device.productName} – ${percent}%`);
  } catch {
    tray.setImage(getIconForPercent(0));
    tray.setToolTip(`${device.productName} – Error`);
  }
}

/* =========================
   BATTERY (WebUSB)
   ========================= */

async function readBatteryWebUSB(info) {
  try {
    const webusb = new WebUSB({
      devicesFound: devices =>
        devices.find(d =>
          d.vendorId === info.vendorId &&
          d.productId === info.productId
        )
    });

    const device = await webusb.requestDevice({ filters: [{}] });
    if (!device) return null;

    await device.open();
    if (!device.configuration) await device.selectConfiguration(1);

    const iface = device.configuration.interfaces[0].interfaceNumber;
    await device.claimInterface(iface);

    const transactionId = 0x1f;

    let msg = Buffer.from([
      0x00,
      transactionId,
      0x00, 0x00,
      0x00,
      0x02,
      0x07,
      0x80
    ]);

    let crc = 0;
    for (let i = 2; i < msg.length; i++) crc ^= msg[i];

    msg = Buffer.concat([
      msg,
      Buffer.alloc(80),
      Buffer.from([crc, 0x00])
    ]);

    await device.controlTransferOut({
      requestType: 'class',
      recipient: 'interface',
      request: 0x09,
      value: 0x300,
      index: iface
    }, msg);

    await new Promise(r => setTimeout(r, 300));

    const reply = await device.controlTransferIn({
      requestType: 'class',
      recipient: 'interface',
      request: 0x01,
      value: 0x300,
      index: iface
    }, 90);

    await device.close();

    if (!reply || !reply.data) return null;

    const raw = reply.data.getUint8(9);
    if (raw === 0 || raw > 255) return null;

    return Math.round((raw / 255) * 100);
  } catch {
    return null;
  }
}

/* =========================
   ICONS
   ========================= */

function getIconForPercent(percent) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return nativeImage.createFromPath(
    path.join(rootPath, 'src/assets/generated', `battery_${p}.png`)
  );
}
