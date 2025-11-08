import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'PagePilot AI',
    description: 'Capture any DOM, collaborate with AI, and personalize the web.',
    permissions: ['storage', 'scripting', 'activeTab'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'PagePilot AI',
    },
  },
});
