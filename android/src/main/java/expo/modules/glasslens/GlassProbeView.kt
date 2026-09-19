package expo.modules.glasslens

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.os.Build
import android.util.Log
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// A diagnostic probe for one question: WHICH pixels actually reach the
// `RenderEffect.createRuntimeShaderEffect` shader. The documentation says "the content of the
// RenderNode the effect is attached to, together with its children," but all of VireGlass's
// architecture rests on that claim, so it's checked by experiment, not by quoting the docs.
//
// The shader is deliberately trivial: it returns the sample as-is, with no optics. Whatever
// shows up on screen is exactly what the shader received.
//
// Doesn't touch the production GlassLensView: a separate class, a separate view name.
private const val PROBE_AGSL = """
uniform shader content;
uniform float2 u_size;
uniform float  u_mode;

half4 main(float2 xy) {
  half4 c = content.eval(xy);

  // mode 0 — raw sample: shows exactly what arrived in the shader.
  if (u_mode < 0.5) { return c; }

  // mode 1 — shader-liveness marker: diagonal hatching over the sample.
  // Tells "the shader got transparency" apart from "the shader never applied at all."
  if (u_mode < 1.5) {
    float stripe = step(0.5, fract((xy.x + xy.y) / 40.0));
    half3 marker = half3(1.0, 0.0, 1.0) * half(stripe * 0.35);
    return half4(c.rgb + marker * (1.0 - c.a), max(c.a, half(stripe * 0.35)));
  }

  // mode 2 — the sample's alpha map, opaque. An unambiguous answer to question §9: white =
  // opaque content reached the shader, black = nothing reached it at all. A midtone within
  // the view's bounds means a semi-transparent capture (a tinted BlurView).
  return half4(c.a, c.a, c.a, 1.0);
}
"""

@SuppressLint("ViewConstructor")
class GlassProbeView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val shader = try {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) RuntimeShader(PROBE_AGSL) else null
  } catch (e: Throwable) {
    Log.e("GlassProbe", "probe AGSL failed to compile", e)
    null
  }

  /** 0 — raw sample, 1 — sample + shader-liveness marker. */
  var mode = 0f

  fun applyEffect() {
    val effect = shader ?: run {
      Log.w("GlassProbe", "no shader — effect not applied")
      return
    }
    if (width <= 0 || height <= 0) return

    effect.setFloatUniform("u_size", width.toFloat(), height.toFloat())
    effect.setFloatUniform("u_mode", mode)
    setRenderEffect(RenderEffect.createRuntimeShaderEffect(effect, "content"))
    Log.i("GlassProbe", "effect applied: ${width}x$height mode=$mode")
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    applyEffect()
  }
}
