import assert from 'node:assert/strict';
import test from 'node:test';
import menuModule from '../src/electron-native-menu.cjs';

const { applicationMenuInventory } = menuModule;

test('native menu inventory exposes bounded metadata without click handlers', () => {
  const inventory = applicationMenuInventory({
    items: [{
      id: 'file',
      label: 'File',
      type: 'submenu',
      enabled: true,
      visible: true,
      submenu: {
        items: [{
          id: 'open',
          label: 'Open',
          type: 'normal',
          accelerator: 'Ctrl+O',
          enabled: false,
          visible: true,
          checked: false,
          click() { throw new Error('must not be exposed'); }
        }]
      }
    }]
  });

  assert.equal(inventory.truncated, false);
  assert.equal(inventory.items.length, 2);
  assert.deepEqual(inventory.items[0], {
    index: 0,
    parentIndex: null,
    depth: 0,
    id: 'file',
    label: 'File',
    role: null,
    type: 'submenu',
    accelerator: null,
    enabled: true,
    visible: true,
    checked: false,
    hasSubmenu: true
  });
  assert.deepEqual(inventory.items[1], {
    index: 1,
    parentIndex: 0,
    depth: 1,
    id: 'open',
    label: 'Open',
    role: null,
    type: 'normal',
    accelerator: 'Ctrl+O',
    enabled: false,
    visible: true,
    checked: false,
    hasSubmenu: false
  });
  assert.equal(Object.hasOwn(inventory.items[1], 'click'), false);
});

test('native menu inventory caps item count and depth', () => {
  const wide = applicationMenuInventory({
    items: [
      { id: 'one', label: 'One' },
      { id: 'two', label: 'Two' },
      { id: 'three', label: 'Three' }
    ]
  }, { maxItems: 2 });
  assert.equal(wide.items.length, 2);
  assert.equal(wide.truncated, true);

  const deep = applicationMenuInventory({
    items: [{
      id: 'root',
      submenu: {
        items: [{
          id: 'child',
          submenu: { items: [{ id: 'grandchild' }] }
        }]
      }
    }]
  }, { maxDepth: 1 });
  assert.deepEqual(deep.items.map((item) => item.id), ['root', 'child']);
  assert.equal(deep.truncated, true);
});
