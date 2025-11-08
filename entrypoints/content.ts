import { logger } from '../src/core/logger';

const log = logger.child('content');

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    log.debug('Content script ready.');
  },
});
