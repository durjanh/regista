/** True when this browser can draw WebGL (false in tests and on some locked-down machines). Checked once. */
let cached: boolean | undefined;
export function webglAvailable(): boolean {
  if (cached === undefined) {
    try {
      const c = document.createElement("canvas");
      cached = !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch {
      cached = false;
    }
  }
  return cached;
}
