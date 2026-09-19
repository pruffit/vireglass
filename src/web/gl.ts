// Low-level GL helpers for the pipeline: program compilation, textures, FBOs, the fullscreen
// triangle. Knows nothing about VireGlass — a reusable layer on top of WebGL2.

/** The same trick as in `scripts/check-glsl.mjs`: three vertices with no buffer, indexed by
 *  `gl_VertexID`. One vertex shader works for EVERY pass of the pipeline, because each fragment
 *  shader pulls its own coordinate from `gl_FragCoord`. */
export const FULLSCREEN_TRIANGLE_VERTEX_SOURCE = `#version 300 es
const vec2 VG_POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(VG_POS[gl_VertexID], 0.0, 1.0);
}
`;

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('vireglass/web: gl.createShader returned null');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '(no log)';
    gl.deleteShader(shader);
    throw new Error(`vireglass/web: shader failed to compile:\n${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('vireglass/web: gl.createProgram returned null');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '(no log)';
    gl.deleteProgram(program);
    throw new Error(`vireglass/web: program failed to link:\n${log}`);
  }
  return program;
}

/** Draws the fullscreen triangle with the current program. No attributes — the vertices are
 *  baked into the shader, so even a VAO isn't needed. */
export function drawFullscreenTriangle(gl: WebGL2RenderingContext): void {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export type TextureOptions = {
  width: number;
  height: number;
  /** RGBA8 by default; the probe needs float when it needs more than 8 bits of precision. */
  internalFormat?: number;
  format?: number;
  type?: number;
};

/**
 * content/probe texture: LINEAR on MIN and MAG, no mipmaps, CLAMP_TO_EDGE. Skia's `.eval` is
 * bilinear by default — NEAREST would break the disc gather into pixel-stepped bands (spec §4).
 */
export function createTexture(gl: WebGL2RenderingContext, options: TextureOptions): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('vireglass/web: gl.createTexture returned null');
  const internalFormat = options.internalFormat ?? gl.RGBA8;
  const format = options.format ?? gl.RGBA;
  const type = options.type ?? gl.UNSIGNED_BYTE;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    internalFormat,
    options.width,
    options.height,
    0,
    format,
    type,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

export function createFramebuffer(gl: WebGL2RenderingContext, texture: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('vireglass/web: gl.createFramebuffer returned null');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`vireglass/web: FBO incomplete, status ${status}`);
  }
  return fbo;
}

/** The one texture unit any pipeline pass needs here — a bind with no extra slot bookkeeping. */
export function bindTextureAt(
  gl: WebGL2RenderingContext,
  unit: number,
  texture: WebGLTexture,
  program: WebGLProgram,
  uniformName: string,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const loc = gl.getUniformLocation(program, uniformName);
  gl.uniform1i(loc, unit);
}
