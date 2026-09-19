// Android target. AGSL and SkSL are the same language, so `lens-shader.ts`/`surface-shader.ts`
// already assemble the finished AGSL text as a string (SDF + body via `${VG_SDF}`) — there's
// nothing to translate. The identity function here fixes the "input = output" contract as a
// target in its own right, symmetric with `targets/glsl.ts`, and guards the native path against
// an accidental edit in some future refactor.
export function toAGSL(shaderSource: string): string {
  return shaderSource;
}
