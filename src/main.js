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
const RAZER_REPORT_ARGUMENT_OFFSET = 8;
const POLL_INTERVAL_MS = 3000;
const rootPath = app.getAppPath();

let tray = null;
let settingsWindow = null;
let pollTimer = null;
let isUpdatingTray = false;

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
  const previousActiveKey = activeKey;

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

  ensureActiveDevice();

  console.log('DEVICES:', [...devices.values()].map(d => d.productName));

  return previousActiveKey !== activeKey;
}

function ensureActiveDevice() {
  if (activeKey && devices.has(activeKey)) return;

  const batteryDevice = [...devices.values()].find(device => device.hasBattery);
  activeKey = batteryDevice?.key || [...devices.keys()][0] || null;
}

/* =========================
   TRAY
   ========================= */

function rebuildTrayMenu() {
  ensureActiveDevice();
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
  refreshDevices();
  rebuildTrayMenu();
  updateTray();

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
  ensureActiveDevice();

  return {
    devices: [...devices.values()],
    activeKey
  };
});

ipcMain.handle('devices:refresh', () => {
  refreshDevices();
  rebuildTrayMenu();
  updateTray();
  return {
    devices: [...devices.values()],
    activeKey
  };
});

ipcMain.handle('devices:request', () => {
  refreshDevices();
  rebuildTrayMenu();
  updateTray();
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

  const battery = await readBatteryStatus(device);
  if (!battery) return { status: 'disconnected' };

  if (device.key === activeKey) {
    applyTrayBattery(device, battery);
  }

  return {
    status: battery.isCharging ? 'charging' : 'ok',
    percent: battery.percent
  };
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
  pollTimer = setInterval(updateTray, POLL_INTERVAL_MS);
}

async function updateTray() {
  if (isUpdatingTray) return;
  isUpdatingTray = true;

  const activeChanged = refreshDevices();
  if (activeChanged) rebuildTrayMenu();
  const device = devices.get(activeKey);

  try {
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

    const battery = await readBatteryStatus(device);

    if (!battery) {
      tray.setImage(getIconForPercent(0));
      tray.setToolTip(`${device.productName} – Battery unavailable`);
      return;
    }

    applyTrayBattery(device, battery);
  } catch {
    tray.setImage(getIconForPercent(0));
    tray.setToolTip(`${device?.productName || 'Razer Device'} – Error`);
  } finally {
    isUpdatingTray = false;
  }
}

function applyTrayBattery(device, battery) {
  tray.setImage(battery.isCharging ? getChargingIcon() : getIconForPercent(battery.percent));
  tray.setToolTip(
    `${device.productName} – ${battery.percent}%${battery.isCharging ? ' charging' : ''}`
  );
}

/* =========================
   BATTERY (WebUSB)
   ========================= */

async function readBatteryStatus(info) {
  const percent = await readBatteryPercentWebUSB(info);
  if (percent == null) return null;

  return {
    percent,
    isCharging: await readChargingWebUSB(info)
  };
}

async function readBatteryPercentWebUSB(info) {
  const reply = await sendRazerUsbCommand(info, 0x07, 0x80);
  if (!reply || !reply.data) return null;

  const raw = readRazerArgument(reply, 1);
  if (raw > 255) return null;

  return clampPercent((raw / 255) * 100);
}

async function readChargingWebUSB(info) {
  const reply = await sendRazerUsbCommand(info, 0x07, 0x84);
  if (!reply || !reply.data) return false;

  return readRazerArgument(reply, 1) !== 0;
}

async function sendRazerUsbCommand(info, commandClass, commandId) {
  let device = null;
  let isOpen = false;

  try {
    const webusb = new WebUSB({
      devicesFound: devices =>
        devices.find(d =>
          d.vendorId === info.vendorId &&
          d.productId === info.productId
        )
    });

    device = await webusb.requestDevice({ filters: [{}] });
    if (!device) return null;

    await device.open();
    isOpen = true;
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
      commandClass,
      commandId
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

    return await device.controlTransferIn({
      requestType: 'class',
      recipient: 'interface',
      request: 0x01,
      value: 0x300,
      index: iface
    }, 90);

  } catch {
    return null;
  } finally {
    if (device && isOpen) {
      await device.close().catch(() => {});
    }
  }
}

function readRazerArgument(reply, index) {
  return reply.data.getUint8(RAZER_REPORT_ARGUMENT_OFFSET + index);
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
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

function getChargingIcon() {
  return nativeImage.createFromPath(
    path.join(rootPath, 'src/assets/generated', 'battery_charging.png')
  );
}
