package expo.modules.glasslens

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.os.Build
import android.graphics.Canvas
import android.util.Log
import android.view.View
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// Refraction of a live backdrop can't be computed with either a view transform or a Skia shader
// on top of it: the transform is affine (one coefficient for the whole lens — that's a
// magnifying glass, not a lens), and a Skia canvas can't see the native backdrop's pixels.
// `RenderEffect.createRuntimeShaderEffect` is the only way on Android to hand an AGSL shader
// content the view has ALREADY drawn: a backdrop snapshot arrives here from the BlurView child,
// and the shader samples it at a shifted coordinate.
//
// The shader source arrives as a PROP from JS (`lens-shader.ts`): AGSL and SKSL are one
// language, so the lens's and the surface's geometry are literally the same string. Keeping a
// second copy of the SDF here would be exactly the drift this phase closes off.
@SuppressLint("ViewConstructor")
class GlassLensView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val density = context.resources.displayMetrics.density

  /** Lightness, variegation and color of the backdrop under this glass. The app listens to this
   *  event to recolor the ink once the glass has worked past its own limit (see the probe in
   *  GlassBackdropView). */
  private val onBackdropSample by EventDispatcher()

  private val screenAt = IntArray(2)
  private val selfAt = IntArray(2)
  private val backdropAt = IntArray(2)

  // A ViewGroup doesn't draw itself by default, and drawing the backdrop is now this view's job.
  init { setWillNotDraw(false) }

  private var backdrop: GlassBackdropView? = null

  /** Tag of the TARGET (the app's own blur-target wrapper), not of the capture itself: a
   *  fallback wrapper sits outside for below Android 13, and our GlassBackdropView lies inside
   *  it. */
  var backdropId: Int? = null
    set(value) {
      if (field == value) return
      field = value
      backdrop?.unregister(this)
      backdrop = null
      attach(value, RESOLVE_TRIES)
      invalidate()
    }

  /** Looks for the capture view with retries across frames: the tag arrives before the target
   *  manages to register, and the setter won't let a second set of the same tag through anyway. */
  private fun attach(id: Int?, tries: Int) {
    if (id == null || id != backdropId || backdrop != null) return
    backdrop = appContext.findView<View>(id)?.let(::findBackdrop)
    if (backdrop != null) {
      backdrop?.register(this)
      invalidate()
      return
    }
    if (tries > 0) {
      postOnAnimation { attach(id, tries - 1) }
      return
    }
    Log.e("GlassLens", "backdrop $id not found, glass is left without refraction")
  }

  private fun findBackdrop(view: View, depth: Int = 0): GlassBackdropView? {
    if (view is GlassBackdropView) return view
    if (depth >= 3 || view !is ViewGroup) return null
    for (i in 0 until view.childCount) {
      findBackdrop(view.getChildAt(i), depth + 1)?.let { return it }
    }
    return null
  }

  private var shader: RuntimeShader? = null
  private var compiledSource: String? = null

  var shaderSource: String? = null

  /** Size of the VISIBLE glass in dp: the lightness probe's rectangle is computed from it.
   *  Everything else about the material arrives through the shared channel below. */
  var glassWidth = 0f
  var glassHeight = 0f

  // THE SHARED UNIFORM CHANNEL. There used to be a separate Prop per material value, and adding
  // a phenomenon to the shader meant a Kotlin edit, an APK rebuild, and — on a typo — the lens
  // silently turning off: Expo swallows an unknown prop without a word (material-lab.md E-01,
  // which is how refraction ended up disabled in production for an entire phase). Now name, size
  // and value arrive TOGETHER, and a mismatch with the shader gets logged by name.
  var uniformNames: List<String> = emptyList()
  var uniformValues: List<Double> = emptyList()
  var uniformSizes: List<Int> = emptyList()

  // Compiling AGSL is expensive and must only happen when the source actually changes: props
  // arrive in a batch on every render, while the string itself stays the same.
  private fun ensureShader(): RuntimeShader? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return null
    val src = shaderSource ?: return null
    if (src == compiledSource) return shader
    compiledSource = src
    // A compile error arrives as an exception from the constructor and crashes the view if left
    // uncaught. But it can't be silent either: without the effect, BlurView draws its own
    // RECTANGLE across the whole view, and the symptom looks nothing like the error text.
    shader = try {
      RuntimeShader(src)
    } catch (e: Throwable) {
      Log.e("GlassLens", "AGSL failed to compile, lens is disabled", e)
      null
    }
    return shader
  }

  /** The single call made after any prop changes — uniforms only take effect through a fresh
   *  `setRenderEffect`; mutating the `RuntimeShader` itself doesn't invalidate the view. */
  fun applyEffect() {
    // The view can ONLY be hidden when there's no shader at all: the BlurView inside stops
    // capturing the backdrop if hidden, and doesn't come back to life on its own. A transitional
    // state just waits for the next call.
    val effect = ensureShader()
    if (effect == null) {
      visibility = INVISIBLE
      return
    }
    visibility = VISIBLE
    if (width <= 0 || height <= 0 || glassWidth <= 0f || glassHeight <= 0f) return

    try {
      // The view sets ONLY what it alone knows: its own size and its own place on screen.
      effect.setFloatUniform("u_center", width / 2f, height / 2f)
      // How far content actually extends: the lens view is wider than the glass by a margin,
      // beyond that it's empty.
      effect.setFloatUniform("u_reach", min(width, height) / 2f)

      // The capture ends at the screen's edge, while the surface's lens view runs its full width
      // past it. Hand the shader the rectangle where content actually exists, in ITS OWN
      // coordinates — otherwise a band along such edges is left without refraction.
      getLocationOnScreen(screenAt)
      val metrics = resources.displayMetrics
      val minX = maxOf(-screenAt[0], 0).toFloat() + 1f
      val minY = maxOf(-screenAt[1], 0).toFloat() + 1f
      val maxX = minOf(metrics.widthPixels - screenAt[0], width).toFloat() - 1f
      val maxY = minOf(metrics.heightPixels - screenAt[1], height).toFloat() - 1f
      effect.setFloatUniform("u_contentMin", minX, minY)
      effect.setFloatUniform("u_contentMax", maxX, maxY)
      // Backdrop estimate under the glass. It can't be computed in the shader from a handful of
      // taps: body density is a nonlinear function of lightness, and at the kink the estimate's
      // spread between neighboring pixels used to turn into GHOST COPIES of text lying under the
      // glass, one sampling radius away. Here it's one value for the whole surface, coming from
      // the probe and smoothed over time — there's nowhere for a comb artifact to come from.
      effect.setFloatUniform("u_probeLuma", probeLuma)
      effect.setFloatUniform("u_probeBusy", probeBusy)
      effect.setFloatUniform("u_probeRange", probeLo, probeHi)
      effect.setFloatUniform("u_probeSlope", probeSlopeX, probeSlopeY)
      effect.setFloatUniform("u_probe", probeR, probeG, probeB)
      applyChannel(effect)
    } catch (e: Throwable) {
      Log.e("GlassLens", "lens uniforms drifted out of sync with the shader", e)
      setRenderEffect(null)
      return
    }

    setRenderEffect(RenderEffect.createRuntimeShaderEffect(effect, "content"))
  }

  /** The shared channel: name, size and values are already reconciled on the JS side
   *  (`adapters.ts`). The error isn't swallowed — otherwise the lens turns off silently and the
   *  symptom looks like nothing in particular. */
  private fun applyChannel(effect: RuntimeShader) {
    var at = 0
    for (k in uniformNames.indices) {
      val name = uniformNames[k]
      val size = uniformSizes.getOrElse(k) { 1 }
      if (at + size > uniformValues.size) break
      try {
        val v0 = uniformValues[at].toFloat()
        when (size) {
          1 -> effect.setFloatUniform(name, v0)
          2 -> effect.setFloatUniform(name, v0, uniformValues[at + 1].toFloat())
          3 -> effect.setFloatUniform(
            name,
            v0,
            uniformValues[at + 1].toFloat(),
            uniformValues[at + 2].toFloat(),
          )
          4 -> effect.setFloatUniform(
            name,
            v0,
            uniformValues[at + 1].toFloat(),
            uniformValues[at + 2].toFloat(),
            uniformValues[at + 3].toFloat(),
          )
        }
      } catch (e: Throwable) {
        Log.e("GlassLens", "uniform $name (size $size) was rejected by the shader", e)
      }
      at += size
    }
  }

  /** The lens's content is a backdrop snapshot, and it draws it itself: `RenderEffect` works off
   *  what the view has drawn. The offset is taken from screen position — it accounts for
   *  transforms, and when the glass moves, a different patch of backdrop ends up underneath it. */
  override fun onDraw(canvas: Canvas) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val source = backdrop ?: return
    // Registration is idempotent and self-healing: the backdrop can reconnect.
    source.register(this)
    val n = source.content ?: return
    getLocationOnScreen(selfAt)
    source.getLocationOnScreen(backdropAt)
    canvas.save()
    canvas.translate((backdropAt[0] - selfAt[0]).toFloat(), (backdropAt[1] - selfAt[1]).toFloat())
    canvas.drawRenderNode(n)
    canvas.restore()
  }

  /** The probe has taken a fresh grid. Pull OUR OWN rectangle out of it — the tab bar and the
   *  mini-player have different things underneath them — and report outward only if it moved
   *  noticeably: an event into JS costs more than the measurement itself. */
  fun onBackdropProbed() {
    val source = backdrop ?: return
    val luma = source.lumaGrid ?: return
    val color = source.colorGrid ?: return
    if (source.width <= 0 || source.height <= 0) return

    getLocationOnScreen(selfAt)
    source.getLocationOnScreen(backdropAt)
    val halfW = glassWidth * density / 2f
    val halfH = glassHeight * density / 2f
    val cx = (selfAt[0] - backdropAt[0]) + width / 2f
    val cy = (selfAt[1] - backdropAt[1]) + height / 2f

    val gw = GlassBackdropView.PROBE_W
    val gh = GlassBackdropView.PROBE_H
    val sx = gw / source.width.toFloat()
    val sy = gh / source.height.toFloat()
    val x0 = max(((cx - halfW) * sx).toInt(), 0)
    val x1 = min(((cx + halfW) * sx).toInt() + 1, gw)
    val y0 = max(((cy - halfH) * sy).toInt(), 0)
    val y1 = min(((cy + halfH) * sy).toInt() + 1, gh)
    if (x1 <= x0 || y1 <= y0) return

    var sum = 0f
    var r = 0f
    var g = 0f
    var b = 0f
    var count = 0
    val bins = IntArray(BINS)
    // Lightness slope across the surface. Tinting must be GRADIENT: where one half under the
    // glass is light and the other dark, one density for the whole element gives no separation
    // on either half. A plane is the crudest model that describes this, and the only one that's
    // smooth by construction: a point estimate at the density kink used to turn into ghost
    // copies of text (material-lab.md E-36).
    var sumU = 0f
    var sumV = 0f
    var uu = 0f
    var vv = 0f
    val midX = (x0 + x1 - 1) * 0.5f
    val midY = (y0 + y1 - 1) * 0.5f
    val halfCellsX = max((x1 - 1 - x0) * 0.5f, 0.5f)
    val halfCellsY = max((y1 - 1 - y0) * 0.5f, 0.5f)
    for (y in y0 until y1) {
      for (x in x0 until x1) {
        val i = y * gw + x
        val l = luma[i]
        sum += l
        bins[((l * (BINS - 1)).toInt()).coerceIn(0, BINS - 1)]++
        val u = (x - midX) / halfCellsX
        val v = (y - midY) / halfCellsY
        sumU += l * u
        sumV += l * v
        uu += u * u
        vv += v * v
        r += color[i * 3]
        g += color[i * 3 + 1]
        b += color[i * 3 + 2]
        count++
      }
    }
    val n = count.toFloat()
    val mean = sum / n
    // The coordinates are centered, so the normal equations decouple: the slope along each axis
    // is computed independently.
    val slopeX = if (uu > 0.001f) sumU / uu else 0f
    val slopeY = if (vv > 0.001f) sumV / vv else 0f

    // The edges are taken as PERCENTILES, not min/max: a single white dot under the glass's edge
    // shouldn't read as "there's a white field under the glass." Judging by the average is even
    // worse — right over a black/white border it gives a gray that's formally fine, while the
    // ink drowns over the light half.
    var lo = 0f
    var hi = 1f
    var acc = 0
    val loAt = (count * 0.1f).toInt()
    val hiAt = (count * 0.9f).toInt()
    var loSet = false
    for (k in 0 until BINS) {
      val next = acc + bins[k]
      if (!loSet && next > loAt) {
        lo = k / (BINS - 1f)
        loSet = true
      }
      if (next > hiAt) {
        hi = k / (BINS - 1f)
        break
      }
      acc = next
    }

    // Variegation is the mean deviation from average lightness, doubled (a field that's half
    // black and half white comes out to exactly 1). Range doesn't work for this: a page of dark
    // text gets the same value as a checkerboard, even though light makes up a fraction of a
    // percent of it.
    var dev = 0f
    for (k in 0 until BINS) {
      dev += bins[k] * kotlin.math.abs(k / (BINS - 1f) - mean)
    }
    val busy = (2f * dev / n).coerceIn(0f, 1f)

    // The smoothing target. The value itself travels to it frame by frame (see `settle`): the
    // probe's step is 180 ms, and without in-between frames the adaptation reads as steps.
    targetLuma = mean
    targetBusy = busy
    targetLo = lo
    targetHi = hi
    targetSlopeX = slopeX
    targetSlopeY = slopeY
    targetR = r / n
    targetG = g / n
    targetB = b / n
    if (probeLuma < 0f) {
      probeLuma = mean
      probeBusy = busy
      probeLo = lo
      probeHi = hi
      probeSlopeX = slopeX
      probeSlopeY = slopeY
      probeR = targetR
      probeG = targetG
      probeB = targetB
    }
    settle()

    // The event fires on EVERY measurement, not only on change. There used to be a threshold
    // here, and on a static screen events stopped altogether — while the decision to recolor
    // content needs several confirmations in a row and so never accumulated any. The rate is
    // already low (PROBE_INTERVAL_MS); filtering it is the consumer's job.
    emitSample(mean, busy, lo, hi, r / n, g / n, b / n)
  }

  private fun emitSample(
    luma: Float,
    busy: Float,
    lo: Float,
    hi: Float,
    r: Float,
    g: Float,
    b: Float,
  ) {
    onBackdropSample(
      mapOf("luma" to luma, "busy" to busy, "lo" to lo, "hi" to hi, "r" to r, "g" to g, "b" to b),
    )
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attach(backdropId, RESOLVE_TRIES)
  }

  override fun onDetachedFromWindow() {
    backdrop?.unregister(this)
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    applyEffect()
  }


  // Smoothed backdrop estimate. Negative lightness = the probe hasn't reported anything yet,
  // and the shader falls back on its own samples.
  private var probeLuma = -1f
  private var probeBusy = 0f
  private var probeLo = 0f
  private var probeHi = 0f
  private var probeSlopeX = 0f
  private var probeSlopeY = 0f
  private var probeR = 0f
  private var probeG = 0f
  private var probeB = 0f
  private var targetLuma = 0f
  private var targetBusy = 0f
  private var targetLo = 0f
  private var targetHi = 0f
  private var targetSlopeX = 0f
  private var targetSlopeY = 0f
  private var targetR = 0f
  private var targetG = 0f
  private var targetB = 0f
  private var settling = false

  /** Exponential approach to the latest measurement, frame by frame. Stops on its own once
   *  there's nowhere left to go: while the value is holding still, the effect isn't recreated
   *  at all. */
  private fun settle() {
    if (settling) return
    settling = true
    post(object : Runnable {
      override fun run() {
        // The condition looks at EVERY quantity the loop moves: on luma alone it used to stall
        // when only the hue of the backdrop changed. Maximum, not sum: the threshold is set for
        // ONE quantity and summing would tighten it with every added term — extra frames of
        // `applyEffect()` for nothing.
        val d = maxOf(
          maxOf(abs(targetLuma - probeLuma), abs(targetBusy - probeBusy), abs(targetLo - probeLo)),
          maxOf(abs(targetHi - probeHi), abs(targetSlopeX - probeSlopeX), abs(targetSlopeY - probeSlopeY)),
          maxOf(abs(targetR - probeR), abs(targetG - probeG), abs(targetB - probeB)),
        )
        probeLuma += (targetLuma - probeLuma) * SETTLE
        probeBusy += (targetBusy - probeBusy) * SETTLE
        probeLo += (targetLo - probeLo) * SETTLE
        probeHi += (targetHi - probeHi) * SETTLE
        probeSlopeX += (targetSlopeX - probeSlopeX) * SETTLE
        probeSlopeY += (targetSlopeY - probeSlopeY) * SETTLE
        probeR += (targetR - probeR) * SETTLE
        probeG += (targetG - probeG) * SETTLE
        probeB += (targetB - probeB) * SETTLE
        applyEffect()
        if (d > SETTLE_EPS) postOnAnimation(this) else settling = false
      }
    })
  }

  private companion object {
    /** How many frames to wait for the capture view to appear before declaring it absent. */
    const val RESOLVE_TRIES = 10

    /** Number of histogram bins. Enough for both percentiles and mean deviation: the statistics
     *  don't need to be any more precise than this — they drive smoothly varying quantities. */
    const val BINS = 32

    /** Fraction of the way to the target covered per frame. A time constant of roughly a third
     *  of a second — the adaptation has to be unnoticeable, not instant. */
    const val SETTLE = 0.08f

    /** Below this difference, the value is considered to have arrived, and the frame-by-frame
     *  approach stops. */
    const val SETTLE_EPS = 0.002f
  }
}

