/**
 * MAITEMBATH GANG PARTY - Backward-Compatibility Entry Bridge (public/app.js)
 * 
 * Bridges the existing script tag in public/index.html:
 *   <script src="/app.js?v=30"></script>
 * directly to the new ES module application architecture under public/js/main.js.
 * 
 * Works seamlessly whether loaded as a classic script or as an ES module:
 * - Dynamic import() is supported in classic scripts across all modern browsers (Chrome 63+, Safari 11.1+, Firefox 67+, Edge 79+).
 * - Leaves index.html 100% untouched with zero broken bindings.
 */

(function bootstrapModularApp() {
    import('./js/main.js').catch((err) => {
        console.error('[MAITEMBATH] Fatal error bootstrapping application via app.js bridge:', err);
    });
})();
