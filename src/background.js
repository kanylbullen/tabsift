// Service worker. Handles keyboard commands and the automatic-cleanup alarm —
// the palette does everything else itself in its own popup context, so there is
// no message channel to abuse and no state that can go stale.

import { getSettings } from './lib/settings.js';
import { queryTabs, planDedupe, applyDedupe, applyGrouping } from './lib/tabs.js';
import { planGrouping } from './lib/grouping.js';
import { registerOmnibox } from './lib/omnibox.js';
import { planAutoClose, applyAutoClose } from './lib/autoclose.js';

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

// ------------------------------------------------------------ automatic cleanup

const SWEEP = 'auto-close';

/** Make sure the sweep alarm exists whenever the worker starts. On browser
 *  start `fresh` recreates it, so the first sweep waits a few minutes and the
 *  restored tabs get time to settle instead of an overdue alarm firing at once. */
async function ensureSweepAlarm(fresh = false) {
  if (fresh || !(await chrome.alarms.get(SWEEP))) {
    await chrome.alarms.create(SWEEP, { delayInMinutes: 5, periodInMinutes: 5 });
  }
}

async function runAutoClose() {
  const { autoClose } = await getSettings();
  if (!autoClose.enabled) return;
  const tabs = await queryTabs({ allWindows: true });
  const plan = planAutoClose(tabs, Date.now(), autoClose);
  await applyAutoClose(plan);
}

// Registered at the top level so the worker is woken for it.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SWEEP) return;
  runAutoClose().catch((err) => console.error('[tabsift] auto-close', err));
});
ensureSweepAlarm().catch((err) => console.error('[tabsift] alarm', err));
chrome.runtime.onStartup.addListener(() => {
  ensureSweepAlarm(true).catch((err) => console.error('[tabsift] alarm', err));
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
