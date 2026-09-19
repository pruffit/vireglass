#!/usr/bin/env node
/**
 * Checks the AGSL → GLSL transpiler (`../src/targets/glsl.ts`): spins up headless Chromium,
 * compiles both fragment shaders (lens, surface) in a real WebGL2 context, and prints
 * getShaderInfoLog/getProgramInfoLog on failure. The vertex shader is a trivial fullscreen
 * triangle with no buffers, just gl_VertexID.
 *
 * Run: pnpm --filter @vire/vireglass check:glsl (or `tsx scripts/check-glsl.mjs` from the package).
 */
import { chromium } from 'playwright';
import { toGLSL } from '../src/targets/glsl.ts';
import { LENS_SHADER } from '../src/lens-shader.ts';
import { SURFACE_SHADER } from '../src/surface-shader.ts';

const VERTEX_SOURCE = `#version 300 es
const vec2 VG_CHECK_POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(VG_CHECK_POS[gl_VertexID], 0.0, 1.0);
}
`;

function compileCheck({ vertexSource, fragmentSource }) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { contextOk: false };

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return {
      shader,
      ok: gl.getShaderParameter(shader, gl.COMPILE_STATUS),
      log: gl.getShaderInfoLog(shader) ?? '',
    };
  }

  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);

  let linkOk = false;
  let linkLog = '';
  if (vertex.ok && fragment.ok) {
    const program = gl.createProgram();
    gl.attachShader(program, vertex.shader);
    gl.attachShader(program, fragment.shader);
    gl.linkProgram(program);
    linkOk = gl.getProgramParameter(program, gl.LINK_STATUS);
    linkLog = gl.getProgramInfoLog(program) ?? '';
  }

  return {
    contextOk: true,
    renderer: gl.getParameter(gl.RENDERER),
    shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    vertexOk: vertex.ok,
    vertexLog: vertex.log,
    fragmentOk: fragment.ok,
    fragmentLog: fragment.log,
    linkOk,
    linkLog,
  };
}

async function checkOne(page, label, fragmentSource) {
  const result = await page.evaluate(compileCheck, { vertexSource: VERTEX_SOURCE, fragmentSource });
  if (!result.contextOk) {
    console.error(`[${label}] WebGL2 unavailable in the headless browser`);
    return false;
  }
  console.log(`[${label}] renderer: ${result.renderer}`);
  console.log(`[${label}] GLSL: ${result.shadingLanguageVersion}`);
  console.log(`[${label}] vertex: ${result.vertexOk ? 'OK' : 'FAIL'}`);
  if (!result.vertexOk) console.error(result.vertexLog);
  console.log(`[${label}] fragment: ${result.fragmentOk ? 'OK' : 'FAIL'}`);
  if (!result.fragmentOk) console.error(result.fragmentLog);
  console.log(`[${label}] link: ${result.linkOk ? 'OK' : 'FAIL'}`);
  if (!result.linkOk && result.vertexOk && result.fragmentOk) console.error(result.linkLog);
  return result.vertexOk && result.fragmentOk && result.linkOk;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const lensOk = await checkOne(page, 'lens', toGLSL(LENS_SHADER));
  const surfaceOk = await checkOne(page, 'surface', toGLSL(SURFACE_SHADER));

  await browser.close();

  if (!lensOk || !surfaceOk) {
    console.error('check-glsl: some shaders fail to compile');
    process.exitCode = 1;
    return;
  }
  console.log('check-glsl: both shaders compile and link with no errors');
}

await main();
