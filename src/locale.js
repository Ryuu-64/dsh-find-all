/** Translate on hosts with the locale service, retaining browser-language support on older hosts. */
export function installClientLocale(ctx, namespace, messages, refresh) {
  const language = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '') ? 'zh' : 'en';
  const fallback = (key, params = {}) => (messages[language][key] ?? messages.en[key] ?? key)
    .replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
  let translate = fallback;
  ctx.inject?.(['locale'], child => {
    const { locale } = child;
    if (typeof locale?.register !== 'function' || typeof locale.bind !== 'function') return;
    child.effect(() => {
      const unregister = locale.register(namespace, messages);
      translate = locale.bind(namespace);
      const stop = locale.subscribe?.(refresh);
      refresh();
      return () => {
        stop?.();
        unregister?.();
        translate = fallback;
        refresh();
      };
    });
  });
  return (key, params) => translate(key, params);
}
