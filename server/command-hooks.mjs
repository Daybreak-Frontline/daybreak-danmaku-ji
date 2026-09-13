const HOOK_NAMES = ['onOrderAccepted', 'onOrderRejected', 'onSkip'];
const hooks = Object.fromEntries(HOOK_NAMES.map(name => [name, []]));

export function registerHook(name, fn) {
  if (!hooks[name]) throw new Error(`unknown command hook: ${name}`);
  if (typeof fn !== 'function') throw new Error('command hook must be a function');
  hooks[name].push(fn);
  return () => {
    const list = hooks[name];
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  };
}

export function runHooks(name, payload) {
  for (const fn of hooks[name] || []) {
    try { fn(payload); }
    catch (error) { console.warn(`[command-hooks] ${name}`, error?.message || error); }
  }
}

export function listHookNames() {
  return [...HOOK_NAMES];
}
