'use strict';

const fs = require('node:fs');
const readline = require('node:readline');
const { app, BrowserWindow, webContents } = require('electron');

const CONTRACT = 'veteran-electron-bridge-v1';
const MAX_SURFACES = 64;
const MAX_MESSAGE_BYTES = 256 * 1024;

const input = fs.createReadStream(null, { fd: 3, autoClose: false });
const output = fs.createWriteStream(null, { fd: 4, autoClose: false });
const rl = readline.createInterface({ input, crlfDelay: Infinity });

function reply(message) {
  try {
    output.write(`${JSON.stringify(message)}\n`);
  } catch {}
}

function boundedText(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function listSurfaceEntries(type) {
  if (type === 'window') {
    return BrowserWindow.getAllWindows()
      .filter((win) => {
        try { return !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed(); } catch { return false; }
      })
      .sort((left, right) => left.webContents.id - right.webContents.id)
      .slice(0, MAX_SURFACES)
      .map((win, index) => {
        const contents = win.webContents;
        return {
          index,
          id: contents.id,
          type: 'window',
          title: boundedText(contents.getTitle(), 240),
          url: boundedText(contents.getURL(), 2000),
          hostId: null,
          contents
        };
      });
  }
  return webContents.getAllWebContents()
    .filter((contents) => {
      try { return !contents.isDestroyed() && contents.getType() === 'webview'; } catch { return false; }
    })
    .sort((left, right) => left.id - right.id)
    .slice(0, MAX_SURFACES)
    .map((contents, index) => ({
      index,
      id: contents.id,
      type: 'webview',
      title: boundedText(contents.getTitle(), 240),
      url: boundedText(contents.getURL(), 2000),
      hostId: contents.hostWebContents?.id || null,
      contents
    }));
}

function publicSurface(surface) {
  if (!surface) return null;
  return {
    index: surface.index,
    id: surface.id,
    type: surface.type,
    title: surface.title,
    url: surface.url,
    hostId: surface.hostId
  };
}

function inventory() {
  return {
    windows: listSurfaceEntries('window').map(publicSurface),
    webviews: listSurfaceEntries('webview').map(publicSurface)
  };
}

function resolveTarget(target) {
  const type = target?.type === 'webview' ? 'webview' : 'window';
  const index = Number.isInteger(target?.index) && target.index >= 0 ? target.index : 0;
  const titleIncludes = typeof target?.titleIncludes === 'string' ? target.titleIncludes : null;
  const urlIncludes = typeof target?.urlIncludes === 'string' ? target.urlIncludes : null;
  const candidates = listSurfaceEntries(type).filter((surface) => {
    if (titleIncludes !== null && !surface.title.includes(titleIncludes)) return false;
    if (urlIncludes !== null && !surface.url.includes(urlIncludes)) return false;
    return true;
  });
  return candidates[index] || null;
}

function focusSurface(surface) {
  try {
    const contents = surface.contents;
    const owner = surface.type === 'window'
      ? BrowserWindow.fromWebContents(contents)
      : BrowserWindow.fromWebContents(contents.hostWebContents || contents);
    if (owner && !owner.isDestroyed()) {
      owner.show();
      owner.focus();
    }
    if (typeof contents.focus === 'function') contents.focus();
  } catch {}
}

async function runDom(contents, operation, params) {
  const payload = {
    operation,
    selector: typeof params?.selector === 'string' ? params.selector : null
  };
  const source = `(() => {
    const p = ${JSON.stringify(payload)};
    const el = p.selector ? document.querySelector(p.selector) : null;
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
    };
    if (p.operation === 'inspect') {
      if (!el) return { found: false, visible: false, text: null, value: null, rect: null };
      const rect = el.getBoundingClientRect();
      return {
        found: true,
        visible: visible(el),
        text: el.textContent ?? '',
        value: 'value' in el ? String(el.value ?? '') : null,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    }
    if (p.operation === 'focus-clear') {
      if (!el) return { found: false };
      el.focus();
      if ('value' in el) {
        const proto = Object.getPrototypeOf(el);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, ''); else el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return { found: true };
    }
    if (p.operation === 'focus') {
      if (!el) return { found: false };
      el.focus();
      return { found: true };
    }
    return { found: false };
  })()`;
  return contents.executeJavaScript(source, true);
}

async function invoke(target, operation, params = {}) {
  const surface = resolveTarget(target);
  if (!surface) return { ok: false, code: 'ELECTRON_SURFACE_NOT_FOUND' };
  const contents = surface.contents;
  if (operation === 'inventory') return { ok: true, surface: publicSurface(surface) };
  if (operation === 'url') return { ok: true, url: surface.url };
  if (operation === 'inspect') return { ok: true, ...(await runDom(contents, 'inspect', params)) };
  if (operation === 'click') {
    const inspected = await runDom(contents, 'inspect', params);
    if (!inspected.found || !inspected.visible || !inspected.rect) {
      return { ok: false, code: 'ELECTRON_SELECTOR_NOT_INTERACTABLE' };
    }
    focusSurface(surface);
    const x = Math.floor(inspected.rect.x + inspected.rect.width / 2);
    const y = Math.floor(inspected.rect.y + inspected.rect.height / 2);
    contents.sendInputEvent({ type: 'mouseMove', x, y, movementX: 0, movementY: 0 });
    contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    return { ok: true };
  }
  if (operation === 'fill') {
    const focused = await runDom(contents, 'focus-clear', params);
    if (!focused.found) return { ok: false, code: 'ELECTRON_SELECTOR_NOT_FOUND' };
    focusSurface(surface);
    await contents.insertText(String(params?.value ?? ''));
    return { ok: true };
  }
  if (operation === 'press') {
    if (params?.selector) {
      const focused = await runDom(contents, 'focus', params);
      if (!focused.found) return { ok: false, code: 'ELECTRON_SELECTOR_NOT_FOUND' };
    }
    focusSurface(surface);
    const pieces = String(params?.key || '').split('+').filter(Boolean);
    const keyCode = pieces.pop() || '';
    const modifiers = pieces.map((part) => ({
      Control: 'control', Ctrl: 'control', Shift: 'shift', Alt: 'alt', Meta: 'meta', Command: 'meta'
    }[part] || part.toLowerCase()));
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    return { ok: true };
  }
  if (operation === 'screenshot') {
    const image = await contents.capturePage();
    return { ok: true, pngBase64: image.toPNG().toString('base64') };
  }
  return { ok: false, code: 'ELECTRON_OPERATION_INVALID' };
}

let chain = Promise.resolve();
rl.on('line', (line) => {
  if (!line || Buffer.byteLength(line) > MAX_MESSAGE_BYTES) return;
  chain = chain.then(async () => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!Number.isInteger(message?.id) || message.id <= 0) return;
    try {
      if (message.operation === 'inventory') {
        reply({ id: message.id, ok: true, inventory: inventory() });
        return;
      }
      if (message.operation === 'quit') {
        reply({ id: message.id, ok: true });
        setImmediate(() => app.quit());
        return;
      }
      const result = await invoke(message.target, message.operation, message.params || {});
      reply({ id: message.id, ...result });
    } catch (error) {
      reply({ id: message.id, ok: false, code: error?.code || 'ELECTRON_BRIDGE_OPERATION_FAILED' });
    }
  }).catch(() => {});
});

input.on('error', () => {});
output.on('error', () => {});
reply({ type: 'ready', contract: CONTRACT });
