import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import dialogModule from '../src/electron-native-dialog.cjs';

const {
  MAX_DIALOG_SELECTIONS,
  normalizeOpenDialogRequest,
  openBoundedFileDialog
} = dialogModule;

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-electron-dialog-'));
  const project = path.join(root, 'project');
  const outside = path.join(root, 'outside');
  await fs.mkdir(path.join(project, 'docs'), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(project, 'docs', 'note.txt'), 'hello');
  await fs.writeFile(path.join(project, 'docs', 'data.json'), '{}');
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
  return { root, project, outside };
}

function owner() {
  return { isDestroyed: () => false };
}

function fakeDialog(result, state = {}) {
  return {
    async showOpenDialog(parent, options) {
      state.parent = parent;
      state.options = options;
      return result;
    }
  };
}

test('native open dialog derives a bounded modal request and returns canonical project-relative paths', async () => {
  const { root, project } = await fixture();
  const state = {};
  const parent = owner();
  try {
    const result = await openBoundedFileDialog({
      dialog: fakeDialog({ canceled: false, filePaths: [path.join(project, 'docs', 'note.txt')] }, state),
      owner: parent,
      root: project,
      request: {
        selection: 'file',
        multiple: false,
        title: 'Choose source',
        buttonLabel: 'Open',
        defaultPath: 'docs',
        filters: [{ name: 'Text', extensions: ['txt'] }]
      }
    });
    assert.deepEqual(result, { ok: true, canceled: false, paths: ['docs/note.txt'] });
    assert.equal(state.parent, parent);
    assert.deepEqual(state.options.properties, ['openFile']);
    assert.equal(state.options.defaultPath, await fs.realpath(path.join(project, 'docs')));
    assert.deepEqual(state.options.filters, [{ name: 'Text', extensions: ['txt'] }]);
    assert.equal(state.options.title, 'Choose source');
    assert.equal(state.options.buttonLabel, 'Open');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native directory dialog supports bounded multi-selection and ignores bookmark-like native result fields', async () => {
  const { root, project } = await fixture();
  const state = {};
  try {
    const result = await openBoundedFileDialog({
      dialog: fakeDialog({
        canceled: false,
        filePaths: [path.join(project, 'docs'), project],
        bookmarks: ['must-not-leak']
      }, state),
      owner: owner(),
      root: project,
      request: { selection: 'directory', multiple: true }
    });
    assert.deepEqual(result, { ok: true, canceled: false, paths: ['docs', '.'] });
    assert.deepEqual(state.options.properties, ['openDirectory', 'multiSelections']);
    assert.equal(Object.hasOwn(result, 'bookmarks'), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native dialog cancellation returns no paths even if the native result carries stale paths', async () => {
  const { root, project } = await fixture();
  try {
    const result = await openBoundedFileDialog({
      dialog: fakeDialog({ canceled: true, filePaths: [path.join(project, 'docs', 'note.txt')] }),
      owner: owner(),
      root: project,
      request: { selection: 'file' }
    });
    assert.deepEqual(result, { ok: true, canceled: true, paths: [] });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native dialog request rejects host-path escape, OS-control options, mixed directory filters, and malformed filters', () => {
  assert.throws(() => normalizeOpenDialogRequest({ defaultPath: '../secret.txt' }), (error) => error.code === 'ELECTRON_FILE_DIALOG_PATH_ESCAPE');
  assert.throws(() => normalizeOpenDialogRequest({ defaultPath: '/etc/passwd' }), (error) => error.code === 'ELECTRON_FILE_DIALOG_PATH_ESCAPE');
  assert.throws(() => normalizeOpenDialogRequest({ defaultPath: 'C:\\Windows\\System32' }), (error) => error.code === 'ELECTRON_FILE_DIALOG_PATH_ESCAPE');
  assert.throws(() => normalizeOpenDialogRequest({ showHiddenFiles: true }), (error) => error.code === 'ELECTRON_FILE_DIALOG_REQUEST_INVALID');
  assert.throws(() => normalizeOpenDialogRequest({ securityScopedBookmarks: true }), (error) => error.code === 'ELECTRON_FILE_DIALOG_REQUEST_INVALID');
  assert.throws(() => normalizeOpenDialogRequest({ selection: 'directory', filters: [{ name: 'Text', extensions: ['txt'] }] }), (error) => error.code === 'ELECTRON_FILE_DIALOG_REQUEST_INVALID');
  assert.throws(() => normalizeOpenDialogRequest({ filters: [{ name: 'Bad', extensions: ['*.txt'] }] }), (error) => error.code === 'ELECTRON_FILE_DIALOG_REQUEST_INVALID');
  assert.throws(() => normalizeOpenDialogRequest({ filters: [{ name: 'Mixed', extensions: ['*', 'txt'] }] }), (error) => error.code === 'ELECTRON_FILE_DIALOG_REQUEST_INVALID');
});

test('native dialog rejects selections outside the project root without leaking the selected absolute path', async () => {
  const { root, project, outside } = await fixture();
  const selected = path.join(outside, 'secret.txt');
  try {
    await assert.rejects(
      () => openBoundedFileDialog({
        dialog: fakeDialog({ canceled: false, filePaths: [selected] }),
        owner: owner(),
        root: project,
        request: { selection: 'file' }
      }),
      (error) => {
        assert.equal(error.code, 'ELECTRON_FILE_DIALOG_SELECTION_OUTSIDE_ROOT');
        assert.equal(String(error.message).includes(selected), false);
        return true;
      }
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native dialog rejects selection type mismatch and excess results fail closed', async () => {
  const { root, project } = await fixture();
  try {
    await assert.rejects(
      () => openBoundedFileDialog({
        dialog: fakeDialog({ canceled: false, filePaths: [path.join(project, 'docs')] }),
        owner: owner(),
        root: project,
        request: { selection: 'file' }
      }),
      (error) => error.code === 'ELECTRON_FILE_DIALOG_SELECTION_INVALID'
    );
    await assert.rejects(
      () => openBoundedFileDialog({
        dialog: fakeDialog({ canceled: false, filePaths: [path.join(project, 'docs', 'note.txt'), path.join(project, 'docs', 'data.json')] }),
        owner: owner(),
        root: project,
        request: { selection: 'file', multiple: false }
      }),
      (error) => error.code === 'ELECTRON_FILE_DIALOG_SELECTION_LIMIT_EXCEEDED'
    );
    const tooMany = Array.from({ length: MAX_DIALOG_SELECTIONS + 1 }, () => path.join(project, 'docs', 'note.txt'));
    await assert.rejects(
      () => openBoundedFileDialog({
        dialog: fakeDialog({ canceled: false, filePaths: tooMany }),
        owner: owner(),
        root: project,
        request: { selection: 'file', multiple: true }
      }),
      (error) => error.code === 'ELECTRON_FILE_DIALOG_SELECTION_LIMIT_EXCEEDED'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native dialog requires a live app-owned window and a native dialog owner', async () => {
  const { root, project } = await fixture();
  try {
    await assert.rejects(
      () => openBoundedFileDialog({ dialog: fakeDialog({ canceled: true, filePaths: [] }), owner: { isDestroyed: () => true }, root: project, request: {} }),
      (error) => error.code === 'ELECTRON_FILE_DIALOG_TARGET_INVALID'
    );
    await assert.rejects(
      () => openBoundedFileDialog({ dialog: {}, owner: owner(), root: project, request: {} }),
      (error) => error.code === 'ELECTRON_FILE_DIALOG_UNAVAILABLE'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
