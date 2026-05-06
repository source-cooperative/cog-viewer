/**
 * Custom luma.gl shader modules that fill in capabilities not shipped by
 * `@developmentseed/deck.gl-raster/gpu-modules`. They follow the same
 * `{ name, fs, inject, uniformTypes, getUniforms }` shape as the upstream
 * modules so they slot into a `RasterModule[]` render pipeline directly.
 *
 * GLSL is injected at deck.gl's `DECKGL_FILTER_COLOR` extension point, which
 * runs after the upstream `CompositeBands` (or `CreateTexture`) has populated
 * `color`. Order matters: rescale → gamma → sigmoidal contrast is the
 * standard rio-color / marblecutter chain.
 */

type RescaleProps = { rescaleMin: [number, number, number]; rescaleMax: [number, number, number] };
type GammaProps = { gamma: number };
type SigmoidalProps = { contrast: number; bias: number };

/** Per-channel `LinearRescale`. Same idea as the shipped `LinearRescale`,
 * but min/max are vec3 so each band gets its own range. */
export const PerBandLinearRescale = {
  name: "perBandRescale",
  fs: `uniform perBandRescaleUniforms {
  vec3 rescaleMin;
  vec3 rescaleMax;
} perBandRescale;
`,
  inject: {
    "fs:DECKGL_FILTER_COLOR": `
  color.rgb = clamp(
    (color.rgb - perBandRescale.rescaleMin) /
      max(perBandRescale.rescaleMax - perBandRescale.rescaleMin, vec3(1e-9)),
    0.0, 1.0);
`,
  },
  uniformTypes: {
    rescaleMin: "vec3<f32>",
    rescaleMax: "vec3<f32>",
  },
  getUniforms: (props: Partial<RescaleProps>) => ({
    rescaleMin: props.rescaleMin ?? [0, 0, 0],
    rescaleMax: props.rescaleMax ?? [1, 1, 1],
  }),
} as const;

/** Power-law gamma correction. `gamma > 1` lifts shadows; `< 1` deepens them.
 * Apply post-rescale (input expected in 0..1). */
export const Gamma = {
  name: "gammaModule",
  fs: `uniform gammaModuleUniforms {
  float gammaValue;
} gammaModule;
`,
  inject: {
    "fs:DECKGL_FILTER_COLOR": `
  color.rgb = pow(clamp(color.rgb, 0.0, 1.0), vec3(1.0 / max(gammaModule.gammaValue, 0.0001)));
`,
  },
  uniformTypes: {
    gammaValue: "f32",
  },
  getUniforms: (props: Partial<GammaProps>) => ({
    gammaValue: props.gamma ?? 1.0,
  }),
} as const;

/** Sigmoidal contrast (rio-color formula). `contrast` is the slope (typical
 * 1–20); `bias` shifts the inflection point (0..1, typical 0.5). Apply
 * post-rescale; input expected in 0..1, output normalized back to 0..1. */
export const Sigmoidal = {
  name: "sigmoidal",
  fs: `uniform sigmoidalUniforms {
  float contrast;
  float bias;
} sigmoidal;
`,
  inject: {
    "fs:DECKGL_FILTER_COLOR": `
  {
    float c = sigmoidal.contrast;
    float b = sigmoidal.bias;
    float alpha = 1.0 / (1.0 + exp(c * b));
    float beta = 1.0 / (1.0 + exp(c * (b - 1.0)));
    vec3 num = 1.0 / (1.0 + exp(c * (b - clamp(color.rgb, 0.0, 1.0))));
    color.rgb = clamp((num - alpha) / max(beta - alpha, 1e-9), 0.0, 1.0);
  }
`,
  },
  uniformTypes: {
    contrast: "f32",
    bias: "f32",
  },
  getUniforms: (props: Partial<SigmoidalProps>) => ({
    contrast: props.contrast ?? 1.0,
    bias: props.bias ?? 0.5,
  }),
} as const;
