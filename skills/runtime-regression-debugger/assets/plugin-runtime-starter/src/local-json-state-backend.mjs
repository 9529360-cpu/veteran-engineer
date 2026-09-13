import { StateStore } from './state-store.mjs';
import { STATE_BACKEND_CONTRACT } from './state-backend-contract.mjs';

export class LocalJsonStateBackend extends StateStore {
  constructor(options = {}) {
    super(options);
    this.backendContract = STATE_BACKEND_CONTRACT;
    this.backendKind = 'local-json';
  }
}
