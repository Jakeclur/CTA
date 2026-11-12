// Resolve the browser import map when running the regression checks in Node.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: new URL('../lib/three.module.min.js', import.meta.url).href, shortCircuit: true };
  }
  if (specifier.startsWith('three/addons/')) {
    return { url: new URL('../lib/addons/' + specifier.slice(13), import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
