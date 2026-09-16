import assert from 'node:assert/strict';
import test from 'node:test';
import dialogModule from '../src/electron-native-dialog.cjs';

const { normalizeOpenDialogRequest } = dialogModule;

test('native file dialog filters require an explicit bounded name', () => {
  assert.throws(
    () => normalizeOpenDialogRequest({ filters: [{ extensions: ['txt'] }] }),
    (error) => error.code === 'ELECTRON_FILE_DIALOG_REQUEST_INVALID'
  );
});
