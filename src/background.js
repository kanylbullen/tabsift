// Service worker. Only handles keyboard commands — the palette does everything
// else itself in its own popup context, so there is no message channel to abuse
// and no state that can go stale.

import { getSettings } from './lib/settings.js';
import { queryTabs, planDedupe, applyDedupe, applyGrouping } from './lib/tabs.js';
import { planGrouping } from './lib/grouping.js';
import { registerOmnibox } from './lib/omnibox.js';

// Must be registered synchronously at the top of the module — otherwise the
// service worker isn't woken when the user types the keyword in the address bar.
registerOmnibox();

async function flashBadge(text, color = '#2563eb') {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text: String(text) });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}

async function runDedupe() {
  const settings = await getSettings();
  const tabs = await queryTabs({ allWindows: settings.dedupe.allWindows });
  const plan = planDedupe(tabs, settings.dedupe);
  const { closed } = await applyDedupe(plan);
  await flashBadge(closed ? `-${closed}` : '0', closed ? '#dc2626' : '#6b7280');
}

async function runGrouping() {
  const settings = await getSettings();
  const plan = await planGrouping(settings);

  const assignments = new Map(plan.groups.map((g) => [g.title, g.tabs]));
  const { grouped } = await applyGrouping(assignments, {
    collapseNew: settings.grouping.collapseNew,
  });

  if (plan.aiError) console.warn('[tabsift]', plan.aiError);
  await flashBadge(grouped ? `${grouped}` : '0', grouped ? '#16a34a' : '#6b7280');
}

chrome.commands.onCommand.addListener((command) => {
  const run = command === 'dedupe-tabs' ? runDedupe
    : command === 'group-tabs' ? runGrouping
    : null;
  if (!run) return;

  run().catch((err) => {
    console.error('[tabsift]', command, err);
    flashBadge('!', '#dc2626');
  });
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
