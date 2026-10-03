// Único punto de entrada de librerías externas. Se empaqueta una vez con
// esbuild (npm run build) en public/js/vendor.js y se sirve desde el propio
// servidor, porque en la sala no hay Internet ni CDN.
export { select, selectAll, pointer } from 'd3-selection';
export { zoom, zoomIdentity, zoomTransform } from 'd3-zoom';
