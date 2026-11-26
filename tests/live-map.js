import { createMap } from '../assets/js/map.js';
document.body.innerHTML = '<div id="map" style="position:fixed;inset:0;background:#0b1220"></div><div id="map-loading" style="position:fixed;top:8px;left:8px;color:#fff;font:12px sans-serif;z-index:9">loading</div>';
const st = document.createElement('style');
st.textContent = '.map-label{font-family:system-ui;pointer-events:none;text-align:center;color:#fff;text-shadow:0 1px 2px #000;white-space:nowrap}.map-label .n{font-size:12.5px;font-weight:700}.map-label .z{font-size:11px;color:#cfe3ff}.map-label .v{display:inline-block;margin-top:3px;padding:2px 7px;border-radius:999px;font-size:11.5px;font-weight:800;color:#071020;background:#dff3ff}.map-label.village .n{font-size:14px;text-transform:uppercase;letter-spacing:.08em}';
document.head.appendChild(st);
window.__m = createMap('map', { onReady: () => { window.__mapReady = true; } });
