import { logger } from '../src/core/logger';
import { runtimeEnv } from '../src/shared/env';

const log = logger.child('background');

export default defineBackground(() => {
  log.info('Service worker initialized.', {
    runtimeId: browser.runtime.id,
    mode: runtimeEnv.mode,
    version: runtimeEnv.version,
  });
});
