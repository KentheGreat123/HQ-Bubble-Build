/* Injected at document start by AndroidX, never loaded from a remote script. */
(() => {
  if (window !== window.top || location.origin !== 'https://kenthegreat123.github.io' ||
      !location.pathname.startsWith('/1st-Rate-Parts-App/') ||
      location.pathname.split('/').some(part => part === '.' || part === '..' || part.includes('\\')) ||
      !window.__HqNativeTransport) return;
  const token = '__HQ_TOKEN__';
  const transport = window.__HqNativeTransport;
  const query = window.prompt.bind(window);
  const dispatch = method => { transport.postMessage(JSON.stringify({method, token})); };
  const native = Object.freeze({
    openHcp: () => { dispatch('openHcp'); },
    stopBubble: () => { dispatch('stopBubble'); },
    isBubbleAllowed: () => query('hq-native:overlay-permission', token) === 'true',
    requestBubblePermission: () => { dispatch('requestBubblePermission'); }
  });
  Object.defineProperty(window, 'HQNative', {value: native, writable: false, configurable: false});
  // The currently deployed HQ page consumes HQ directly. Also support newer pages
  // which build HQ themselves from the exact HQNative method names.
  if (!window.HQ) window.HQ = Object.freeze({openHcp: native.openHcp, bubble: Object.freeze({
    stop: native.stopBubble, isAllowed: native.isBubbleAllowed,
    requestPermission: native.requestBubblePermission
  })});
  window.dispatchEvent(new Event('hq-ready'));
})();
