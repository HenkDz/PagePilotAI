import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'PagePilot AI',
    description: 'Capture any DOM, collaborate with AI, and personalize the web.',
    permissions: ['storage', 'scripting', 'activeTab', 'tabs', 'sidePanel', 'userScripts'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'PagePilot AI',
    },
    side_panel: {
      default_path: 'sidepanel/index.html',
    },
    options_ui: {
      page: 'options/index.html',
      open_in_tab: true,
    },
  },
});
