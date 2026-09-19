// WebGL2 target. Translates the same AGSL text (SDF + body, see `targets/agsl.ts`) into GLSL
// ES 3.0. Each conversion rule is its own function with its own test in
// `__tests__/targets.test.ts`. Three spots are NOT mechanical: the coordinate origin, units of
// measure (settled in the web renderer's own setup, not here), and sampler filtering (also the
// renderer's concern). What's here is text conversion only.

/**
 * The sampler-size uniform's name, for translating `NAME.eval(coord)` → `texture(NAME, coord / SIZE)`.
 * A new uniform — there's no equivalent in AGSL: `.eval()` has the size implicitly known to the
 * shader, while GLSL's `texture()` needs a normalized coordinate. One per `uniform shader`/
 * `uniform sampler2D`, its name derived from the sampler's name rather than hardcoded.
 */
function sizeUniformName(sampler: string): string {
  return sampler.startsWith('u_') ? `${sampler}Size` : `u_${sampler}Size`;
}

/** float2/float3/float4 → vec2/vec3/vec4. */
export function convertVecTypes(src: string): string {
  return src.replace(/\bfloat([234])\b/g, 'vec$1');
}

/** half/half2/half3/half4 → float/vec2/vec3/vec4, including half(x) → float(x) casts. */
export function convertHalfTypes(src: string): string {
  return src.replace(/\bhalf([234])\b/g, 'vec$1').replace(/\bhalf\b/g, 'float');
}

/** `uniform shader NAME;` → `uniform sampler2D NAME;` + a new `uniform vec2 <sizeUniform>;`. */
export function convertShaderUniforms(src: string): string {
  return src.replace(/uniform\s+shader\s+(\w+)\s*;/g, (_match, name: string) => {
    return `uniform sampler2D ${name};\nuniform vec2 ${sizeUniformName(name)};`;
  });
}

/**
 * `NAME.eval(coord)` → `texture(NAME, (coord) / <sizeUniform>)` for each declared
 * `uniform sampler2D`. The bounds of `coord` are found by scanning parens, not with a regex: the
 * arguments are nested calls (`content.eval(vgInContent(s + dR - e))`) with commas and
 * parentheses inside.
 */
export function convertEvalCalls(src: string): string {
  const samplers = new Set<string>();
  const declRe = /uniform\s+sampler2D\s+(\w+)\s*;/g;
  for (let m = declRe.exec(src); m; m = declRe.exec(src)) samplers.add(m[1]);
  if (samplers.size === 0) return src;

  const callRe = /(\w+)\.eval\(/g;
  let out = '';
  let cursor = 0;
  for (let m = callRe.exec(src); m; m = callRe.exec(src)) {
    const name = m[1];
    if (!samplers.has(name)) continue;
    const argStart = m.index + m[0].length;
    let depth = 1;
    let i = argStart;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') depth -= 1;
      i += 1;
    }
    const args = src.slice(argStart, i - 1);
    out += src.slice(cursor, m.index);
    out += `texture(${name}, (${args}) / ${sizeUniformName(name)})`;
    cursor = i;
    callRe.lastIndex = i;
  }
  out += src.slice(cursor);
  return out;
}

/**
 * Early `return <expression>;` inside `main` → `fragColor = <expression>; return;`. Takes ONLY
 * the body of main (see `convertEntryPoint`) — ordinary `return`s in helper functions live
 * outside this text and are untouched. Expressions never contain a `;` of their own (shaders have
 * none — the only `;` lives inside `for(...)`, which isn't a return), so `[^;]+` is safe.
 */
export function convertReturns(mainBody: string): string {
  return mainBody.replace(/\breturn\s+([^;]+);/g, 'fragColor = $1; return;');
}

const ENTRY_RE = /half4\s+main\s*\(\s*float2\s+(\w+)\s*\)\s*\{/;

/**
 * `half4 main(float2 xy) { ... }` → `void main() { vec2 xy = <Y-flipped coordinate>; ...; }`.
 * AGSL gives `xy` in screen pixels, top-left origin, y down; `gl_FragCoord` is bottom-left
 * origin, y up. The flip via `u_resolution.y - gl_FragCoord.y` restores the original convention
 * (both coordinate systems center the pixel at `+0.5`, so no X shift or constant is needed).
 * `out vec4 fragColor` and `uniform vec2 u_resolution` are declared in the prologue (`addPrologue`).
 */
export function convertEntryPoint(src: string): string {
  const match = ENTRY_RE.exec(src);
  if (!match) {
    throw new Error('vireglass/targets/glsl: entry point "half4 main(float2 xy)" not found');
  }
  const bodyStart = match.index + match[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
    i += 1;
  }
  const bodyEnd = i - 1;
  const param = match[1];
  const body = convertReturns(src.slice(bodyStart, bodyEnd));
  const head = src.slice(0, match.index);
  const tail = src.slice(i);
  return (
    `${head}void main() {\n` +
    `  vec2 ${param} = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);\n` +
    `${body}}${tail}`
  );
}

/** `#version 300 es` + `precision highp float;` — no equivalent in AGSL, WebGL2 requires them as
 *  the file's first lines. `out vec4 fragColor` and `uniform vec2 u_resolution` ride along here
 *  too: both new, with no counterpart in the source, needed by exactly one entry point
 *  (`convertEntryPoint`). */
export function addPrologue(src: string): string {
  return (
    '#version 300 es\n' +
    'precision highp float;\n\n' +
    'out vec4 fragColor;\n' +
    'uniform vec2 u_resolution;\n\n' +
    src
  );
}

/** Full translation AGSL/SkSL → GLSL ES 3.0. Order matters: the entry point is found by its
 *  literal AGSL signature BEFORE type conversion, otherwise `half4 main(float2 xy)` can't be
 *  found. */
export function toGLSL(shaderSource: string): string {
  let out = shaderSource;
  out = convertEntryPoint(out);
  out = convertShaderUniforms(out);
  out = convertEvalCalls(out);
  out = convertVecTypes(out);
  out = convertHalfTypes(out);
  out = addPrologue(out);
  return out;
}
