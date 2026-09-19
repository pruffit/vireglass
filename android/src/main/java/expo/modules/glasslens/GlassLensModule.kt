package expo.modules.glasslens

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GlassLensModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GlassLens")

    // `createRuntimeShaderEffect` arrived in Android 13. Below it, the view works as an ordinary
    // container, and JS keeps the old affine magnification as a fallback.
    Constants("isSupported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU))

    View(GlassLensView::class) {
      Name("GlassLensView")

      // Lightness of the backdrop under the glass. An event, not a prop: the app has to learn
      // the limit past which the glass can no longer separate itself from the ink, and recolor
      // the ink itself.
      Events("onBackdropSample")

      Prop("backdropId") { view: GlassLensView, value: Int? -> view.backdropId = value }
      Prop("shaderSource") { view: GlassLensView, value: String -> view.shaderSource = value }
      Prop("glassWidth") { view: GlassLensView, value: Float -> view.glassWidth = value }
      Prop("glassHeight") { view: GlassLensView, value: Float -> view.glassHeight = value }
      // The whole material as one channel: name ↔ size ↔ value arrive together, so drifting out
      // of sync with the shader silently is no longer possible (see `applyChannel`).
      Prop("uniformNames") { view: GlassLensView, value: List<String> -> view.uniformNames = value }
      Prop("uniformValues") { view: GlassLensView, value: List<Double> -> view.uniformValues = value }
      Prop("uniformSizes") { view: GlassLensView, value: List<Int> -> view.uniformSizes = value }

      OnViewDidUpdateProps { view: GlassLensView -> view.applyEffect() }
    }

    // Backdrop capture: writes its children into a RenderNode, the lens takes it as content.
    View(GlassBackdropView::class) {
      Name("GlassBackdropView")
    }

    // Diagnostic probe (docs/adr-001-rendering.md): shows which pixels actually reach
    // `createRuntimeShaderEffect`. Not used in production UI.
    View(GlassProbeView::class) {
      Name("GlassProbeView")
      Prop("mode") { view: GlassProbeView, value: Float -> view.mode = value }
      OnViewDidUpdateProps { view: GlassProbeView -> view.applyEffect() }
    }
  }
}
