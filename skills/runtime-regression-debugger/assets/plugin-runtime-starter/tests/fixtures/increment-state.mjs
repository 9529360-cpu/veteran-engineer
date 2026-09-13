import { StateStore } from '../../src/state-store.mjs';

const root = process.argv[2];
const store = await new StateStore({ root }).init();
await store.transaction('cross_process_increment', async (state) => {
  const before = Number(state.runtime.counter || 0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  state.runtime.counter = before + 1;
});
