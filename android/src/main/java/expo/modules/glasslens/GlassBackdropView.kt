package expo.modules.glasslens

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.HardwareRenderer
import android.graphics.PixelFormat
import android.graphics.RenderNode
import android.graphics.drawable.ColorDrawable
import android.hardware.HardwareBuffer
import android.media.ImageReader
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewTreeObserver
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.util.Collections
import java.util.WeakHashMap

/**
 * Backdrop capture for the lens: screen content is written into a `RenderNode` WITHOUT blur.
 *
 * `BlurView` from expo-blur used to play this role, and it produced a dithered copy. Measured in
 * the lab: a one-to-one sample from its capture gives noise of 6.4–8.0 against 0.000 on the same
 * screen area right next to it. The cause is the path itself: on Android 13+ the library routes
 * the capture through `RenderEffect.createBlurEffect`, and Skia dithers the blur's output to
 * hide banding. At zero radius there's no blur, but the dithering stays. There's no blur here at
 * all.
 *
 * Four things this implementation has already broken on — keep them in mind when editing:
 *
 * 1. The write must happen from `dispatchDraw`. `onPreDraw` doesn't yet have a valid drawing
 *    context, and `super.dispatchDraw` into a separately created canvas produces EMPTINESS.
 * 2. The node can't be drawn onto the same canvas that just recorded it: the screen gets a stale
 *    frame, and the scene looks frozen even though the animation is running. Children are drawn
 *    directly; the node is handed only to the lens.
 * 3. A re-record has to be requested every frame from `onPreDraw`: this view's own display list
 *    doesn't rebuild itself when only its children change — it just references their nodes.
 * 4. `setPosition` is mandatory. A node is clipped by its own bounds, and a freshly created one
 *    has EMPTY bounds: `beginRecording(w, h)` only sets the recording's size, not its bounds.
 *    Without this, `drawRenderNode` draws nothing, `content.eval` in the lens returns zero
 *    alpha, and the glass turns transparent — while reading as "clean" on any noise metric,
 *    because there's nothing there for it to show (exactly the E-27 trap in material-lab.md).
 */
@SuppressLint("ViewConstructor")
class GlassBackdropView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val node: RenderNode? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) RenderNode("vireglass-backdrop") else null

  // Weak references: the lens leaves the screen before the backdrop does, and holding onto it
  // here would mean holding its whole subtree.
  private val lenses = Collections.newSetFromMap(WeakHashMap<GlassLensView, Boolean>())

  private var capturing = false

  private val onPreDraw = ViewTreeObserver.OnPreDrawListener {
    if (lenses.isNotEmpty()) invalidate()
    true
  }

  /** The frame's snapshot, or null before the first recording. */
  val content: RenderNode?
    get() = node?.takeIf { it.hasDisplayList() }

  fun register(lens: GlassLensView) {
    if (lenses.add(lens)) invalidate()
  }

  fun unregister(lens: GlassLensView) {
    lenses.remove(lens)
  }

  override fun dispatchDraw(canvas: Canvas) {
    val n = node
    if (n == null || capturing || lenses.isEmpty() ||
      !canvas.isHardwareAccelerated || width <= 0 || height <= 0
    ) {
      super.dispatchDraw(canvas)
      return
    }

    capturing = true
    try {
      n.setPosition(0, 0, width, height)
      val recording = n.beginRecording(width, height)
      try {
        // The screen's background comes from a style on the PARENT view, and only our children
        // land in the node. Without the fill, the lens over an unpainted spot would sample
        // transparency instead of a backdrop.
        (parent as? View)?.background?.let { if (it is ColorDrawable) recording.drawColor(it.color) }
        super.dispatchDraw(recording)
      } finally {
        n.endRecording()
      }
    } finally {
      capturing = false
    }

    super.dispatchDraw(canvas)

    // The lens rebuilds its own display list: it holds the offset to the backdrop, and that
    // changes as the glass moves. The node's content is picked up by reference even without this.
    for (lens in lenses) lens.invalidate()

    scheduleProbe()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnPreDrawListener(onPreDraw)
    // The failure latch is only cleared here, on the view's new lifetime: resetting it inside
    // `releaseProbe` would mean recreating the thread and the renderer every 180 ms on a stable
    // failure.
    probeFailed = false
  }

  override fun onDetachedFromWindow() {
    viewTreeObserver.removeOnPreDrawListener(onPreDraw)
    // The lens set is NOT cleared: the references are weak, and the backdrop can reconnect to a
    // window, in which case the lenses would otherwise be left without updates forever.
    node?.discardDisplayList()
    releaseProbe()
    super.onDetachedFromWindow()
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LIGHTNESS PROBE
  //
  // The glass can adjust its own body to the backdrop, but there's a limit: when the backdrop is
  // light AND the ink over it is light, no amount of body density will separate them by
  // lightness anymore. Past that point the decision belongs not to the glass but to the APP — it
  // recolors the ink. For that, the app needs to know the backdrop's lightness UNDER the glass,
  // and only this view knows it.
  //
  // We don't read from the screen (the glass itself is already drawn there — that would create
  // feedback) but from our own capture node: it holds exactly the backdrop and nothing else. The
  // node is downscaled to a 16×32 grid and rendered into an `ImageReader` via a
  // `HardwareRenderer` — the same mechanism Compose uses to snapshot its own layers. Once every
  // PROBE_INTERVAL_MS, so it never enters the frame budget.
  // ─────────────────────────────────────────────────────────────────────────────

  private var probeNode: RenderNode? = null
  private var probeReader: ImageReader? = null
  private var probeRenderer: HardwareRenderer? = null
  private var probeThread: HandlerThread? = null
  private var probeHandler: Handler? = null
  private var probeFailed = false
  private var lastProbeAt = 0L
  private var probePending = false

  /** Lightness grid of the latest snapshot, PROBE_W×PROBE_H, values 0..1. */
  @Volatile
  var lumaGrid: FloatArray? = null
    private set

  /** Average color of the same snapshot, per cell: the lens tints the rim with the content's
   *  color. */
  @Volatile
  var colorGrid: FloatArray? = null
    private set

  private val mainHandler = Handler(Looper.getMainLooper())

  private fun scheduleProbe() {
    if (probeFailed || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    if (probePending) return
    val now = android.os.SystemClock.uptimeMillis()
    if (now - lastProbeAt < PROBE_INTERVAL_MS) return
    lastProbeAt = now
    probePending = true
    // Not from inside the draw pass: `syncAndDraw` synchronizes the node tree, and we're right
    // in the middle of traversing it. `post` schedules the render right after the frame.
    post { renderProbe() }
  }

  private fun renderProbe() {
    probePending = false
    val n = content ?: return
    if (width <= 0 || height <= 0) return
    try {
      ensureProbe() ?: return
      val pn = probeNode ?: return
      pn.setPosition(0, 0, SHOT_W, SHOT_H)
      val c = pn.beginRecording(SHOT_W, SHOT_H)
      try {
        c.scale(SHOT_W.toFloat() / width, SHOT_H.toFloat() / height)
        c.drawRenderNode(n)
      } finally {
        pn.endRecording()
      }
      probeRenderer?.createRenderRequest()?.setWaitForPresent(false)?.syncAndDraw()
    } catch (e: Throwable) {
      // The probe isn't a required part: without it, the glass only loses theme auto-inversion.
      Log.w("GlassLens", "lightness probe disabled", e)
      probeFailed = true
      releaseProbe()
    }
  }

  private fun ensureProbe(): HardwareRenderer? {
    probeRenderer?.let { return it }
    val thread = HandlerThread("vireglass-probe").apply { start() }
    probeThread = thread
    val handler = Handler(thread.looper)
    probeHandler = handler
    val reader = ImageReader.newInstance(
      SHOT_W,
      SHOT_H,
      PixelFormat.RGBA_8888,
      2,
      HardwareBuffer.USAGE_GPU_COLOR_OUTPUT or HardwareBuffer.USAGE_CPU_READ_OFTEN,
    )
    reader.setOnImageAvailableListener({ r -> readProbe(r) }, handler)
    probeReader = reader
    val pn = RenderNode("vireglass-probe")
    probeNode = pn
    val renderer = HardwareRenderer().apply {
      setSurface(reader.surface)
      setContentRoot(pn)
    }
    probeRenderer = renderer
    return renderer
  }

  private fun readProbe(reader: ImageReader) {
    val image = try {
      reader.acquireLatestImage()
    } catch (e: Throwable) {
      Log.w("GlassLens", "probe frame wasn't delivered", e)
      null
    } ?: return
    try {
      val plane = image.planes[0]
      val buf = plane.buffer
      val rowStride = plane.rowStride
      val pixelStride = plane.pixelStride
      val luma = FloatArray(PROBE_W * PROBE_H)
      val color = FloatArray(PROBE_W * PROBE_H * 3)
      val cells = (SHOT_BLOCK * SHOT_BLOCK).toFloat()
      for (y in 0 until PROBE_H) {
        for (x in 0 until PROBE_W) {
          var r = 0f
          var g = 0f
          var b = 0f
          for (dy in 0 until SHOT_BLOCK) {
            for (dx in 0 until SHOT_BLOCK) {
              val o = (y * SHOT_BLOCK + dy) * rowStride + (x * SHOT_BLOCK + dx) * pixelStride
              r += (buf.get(o).toInt() and 0xFF) / 255f
              g += (buf.get(o + 1).toInt() and 0xFF) / 255f
              b += (buf.get(o + 2).toInt() and 0xFF) / 255f
            }
          }
          r /= cells
          g /= cells
          b /= cells
          val i = y * PROBE_W + x
          luma[i] = 0.2126f * r + 0.7152f * g + 0.0722f * b
          color[i * 3] = r
          color[i * 3 + 1] = g
          color[i * 3 + 2] = b
        }
      }
      lumaGrid = luma
      colorGrid = color
    } catch (e: Throwable) {
      Log.w("GlassLens", "probe snapshot failed to read", e)
    } finally {
      // The frame closes on the probe thread and can arrive late: `releaseProbe` from the main
      // thread may have already closed the reader, in which case `close()` throws
      // `IllegalStateException`.
      try {
        image.close()
      } catch (e: Throwable) {
        Log.w("GlassLens", "probe frame failed to close", e)
      }
    }
    mainHandler.post { for (lens in lenses) lens.onBackdropProbed() }
  }

  private fun releaseProbe() {
    probeRenderer?.let {
      it.stop()
      // The surface is detached BEFORE destroy: otherwise the runtime logs "A resource failed to
      // call Surface.release" on every recreated probe.
      it.setSurface(null)
      it.destroy()
    }
    probeRenderer = null
    probeReader?.close()
    probeReader = null
    probeNode?.discardDisplayList()
    probeNode = null
    probeThread?.quitSafely()
    probeThread = null
    probeHandler = null
    lumaGrid = null
    colorGrid = null
  }

  companion object {
    /**
     * The probe's grid. A cell must be SMALLER than the finest texture that needs telling apart:
     * at 16×32 a cell came out to 67 pixels, and an 8 dp checkerboard averaged out to flat gray —
     * the probe honestly reported "the backdrop is uniform," while ink over the glass drowned in
     * the cells. At 48×96 a cell is about 22 pixels, i.e. the size of the product's finest
     * texture. The breakdown runs on a background thread once every PROBE_INTERVAL_MS, so it
     * never enters the frame budget.
     */
    const val PROBE_W = 48
    const val PROBE_H = 96

    /**
     * The snapshot is taken LARGER than the grid, and a cell is then averaged over a
     * SHOT_BLOCK×SHOT_BLOCK block.
     *
     * Downscaling the screen straight to the grid doesn't work: at a twenty-five-fold reduction
     * the rasterizer doesn't average, it filters — at the 0.50 → 0.69 step a cell came out to
     * 0.486, i.e. below BOTH levels. On flat fields this goes unnoticed, but on a gradient the
     * probe used to underestimate the lightness slope by almost a third, and the element's body
     * on Android tracked the backdrop more closely than on the web (issue #113). The web doesn't
     * make this mistake: there, a shader computes the cell by averaging a 5×5 block.
     */
    const val SHOT_BLOCK = 5
    const val SHOT_W = PROBE_W * SHOT_BLOCK
    const val SHOT_H = PROBE_H * SHOT_BLOCK

    /** Snapshot rate. The adaptation travels over roughly half a second regardless, so there's
     *  no point going faster, and this shouldn't touch the frame budget either way. */
    const val PROBE_INTERVAL_MS = 180L
  }
}
