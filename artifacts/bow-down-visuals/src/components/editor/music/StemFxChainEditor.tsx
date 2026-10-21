import { Trash2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Field, Chip } from "@/components/editor/controls";
import type { FxStep, FxStepType } from "@/lib/arrangement";
import {
  addEqBand,
  addFxStep,
  moveStemFxStep,
  patchFxBand,
  patchFxStep,
  removeEqBand,
  removeFxStep,
  FX_CHAIN_MAX_STEPS,
  FX_EQ_MAX_BANDS,
} from "@/lib/stem-fx-chain";

/* ── Per-stem parametric FX chain editor (Wave 3 #16) ───────────────────
   Docked inside the stem's Effects panel in the Music Studio desk, under
   the preset controls. Same chain model, ranges and render semantics as
   the arrangement's chain editor: steps run in the order shown; a
   non-empty chain replaces the stem's preset effects in the preview and
   in the server render. Every slider here maps to a real FFmpeg/Web
   Audio parameter — nothing is decorative. */

const FX_STEP_LABELS: Record<FxStepType, string> = {
  eq: "EQ",
  compressor: "Compressor",
  saturation: "Saturation",
  reverb: "Reverb",
  delay: "Delay",
};

const FX_STEP_TYPES = Object.keys(FX_STEP_LABELS) as FxStepType[];

export function StemFxChainEditor({
  chain,
  onChange,
  stemId,
}: {
  chain: FxStep[];
  onChange: (next: FxStep[]) => void;
  stemId: string;
}) {
  const atMax = chain.length >= FX_CHAIN_MAX_STEPS;
  return (
    <div className="space-y-3" data-testid={`stem-fx-chain-${stemId}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold text-white/50 mr-1">FX chain — add:</span>
        {FX_STEP_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            disabled={atMax}
            onClick={() => onChange(addFxStep(chain, type))}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white/[0.04] text-white/65 hover:text-white transition-colors disabled:opacity-30"
            data-testid={`stem-fx-add-${type}-${stemId}`}
          >
            + {FX_STEP_LABELS[type]}
          </button>
        ))}
        {chain.length === 0 && (
          <span className="text-[11px] text-white/35">
            No chain yet — this stem uses the preset effects above. Add a step and the chain takes
            over: parametric EQ, compression and more, in the order you set.
          </span>
        )}
      </div>

      {chain.length > 0 && (
        <p className="text-[11px] leading-relaxed text-amber-200/70">
          Chain active — exports and the preview render this chain{" "}
          <span className="font-bold">instead of</span> the preset effects above. Steps run top to
          bottom.
        </p>
      )}

      {chain.map((step, idx) => (
        <div
          key={step.id}
          className={`rounded-xl border p-3 space-y-3 ${
            step.enabled
              ? "border-white/[0.09] bg-white/[0.02]"
              : "border-white/[0.05] bg-white/[0.01] opacity-60"
          }`}
          data-testid={`stem-fx-step-${step.id}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-white/85">
              {idx + 1}. {FX_STEP_LABELS[step.type]}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                title="Move earlier in the chain"
                onClick={() => onChange(moveStemFxStep(chain, step.id, idx - 1))}
                className="px-2 py-1 rounded-md text-[11px] font-bold bg-white/[0.04] text-white/60 hover:text-white"
              >
                ↑
              </button>
              <button
                type="button"
                title="Move later in the chain"
                onClick={() => onChange(moveStemFxStep(chain, step.id, idx + 1))}
                className="px-2 py-1 rounded-md text-[11px] font-bold bg-white/[0.04] text-white/60 hover:text-white"
              >
                ↓
              </button>
              <Chip
                active={step.enabled}
                onClick={() => onChange(patchFxStep(chain, step.id, { enabled: !step.enabled }))}
              >
                {step.enabled ? "On" : "Off"}
              </Chip>
              <button
                type="button"
                title="Remove step"
                onClick={() => onChange(removeFxStep(chain, step.id))}
                className="px-2 py-1 rounded-md text-[11px] font-bold bg-white/[0.04] text-red-300 hover:text-red-200"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>

          {step.type === "eq" && (
            <div className="space-y-2">
              {(step.bands ?? []).map((band, bi) => (
                <div key={bi} className="grid grid-cols-[52px_1fr_1fr_1fr_auto] items-center gap-2">
                  <span className="text-[10px] font-bold text-white/45">Band {bi + 1}</span>
                  <Field label="Freq Hz" hint={String(Math.round(band.freq))}>
                    <Slider
                      value={[Math.log10(band.freq)]}
                      min={Math.log10(20)}
                      max={Math.log10(20000)}
                      step={0.01}
                      onValueChange={([v]) =>
                        onChange(
                          patchFxBand(chain, step.id, bi, {
                            freq: Math.round(Math.pow(10, v ?? 3)),
                          }),
                        )
                      }
                    />
                  </Field>
                  <Field label="Gain dB" hint={`${band.gain.toFixed(1)}`}>
                    <Slider
                      value={[band.gain]}
                      min={-24}
                      max={24}
                      step={0.5}
                      onValueChange={([v]) =>
                        onChange(patchFxBand(chain, step.id, bi, { gain: v ?? 0 }))
                      }
                    />
                  </Field>
                  <Field label="Q" hint={band.q.toFixed(1)}>
                    <Slider
                      value={[band.q]}
                      min={0.3}
                      max={12}
                      step={0.1}
                      onValueChange={([v]) =>
                        onChange(patchFxBand(chain, step.id, bi, { q: v ?? 1 }))
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    title="Remove band"
                    onClick={() => onChange(removeEqBand(chain, step.id, bi))}
                    className="text-red-300/70 hover:text-red-200 text-xs font-bold px-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {(step.bands ?? []).length < FX_EQ_MAX_BANDS && (
                <button
                  type="button"
                  onClick={() => onChange(addEqBand(chain, step.id))}
                  className="text-[11px] font-bold text-amber-300/90 hover:text-amber-200"
                >
                  + Add band
                </button>
              )}
            </div>
          )}

          {step.type === "compressor" && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Threshold dB" hint={`${step.thresholdDb ?? -18}`}>
                <Slider
                  value={[step.thresholdDb ?? -18]}
                  min={-60}
                  max={0}
                  step={1}
                  onValueChange={([v]) =>
                    onChange(patchFxStep(chain, step.id, { thresholdDb: v ?? -18 }))
                  }
                />
              </Field>
              <Field label="Ratio" hint={`${(step.ratio ?? 3).toFixed(1)}:1`}>
                <Slider
                  value={[step.ratio ?? 3]}
                  min={1}
                  max={20}
                  step={0.5}
                  onValueChange={([v]) =>
                    onChange(patchFxStep(chain, step.id, { ratio: v ?? 3 }))
                  }
                />
              </Field>
              <Field label="Attack ms" hint={`${step.attackMs ?? 10}`}>
                <Slider
                  value={[step.attackMs ?? 10]}
                  min={0.1}
                  max={500}
                  step={0.1}
                  onValueChange={([v]) =>
                    onChange(patchFxStep(chain, step.id, { attackMs: v ?? 10 }))
                  }
                />
              </Field>
              <Field label="Release ms" hint={`${step.releaseMs ?? 150}`}>
                <Slider
                  value={[step.releaseMs ?? 150]}
                  min={10}
                  max={1000}
                  step={5}
                  onValueChange={([v]) =>
                    onChange(patchFxStep(chain, step.id, { releaseMs: v ?? 150 }))
                  }
                />
              </Field>
            </div>
          )}

          {step.type === "saturation" && (
            <Field label="Drive" hint={(step.drive ?? 1.5).toFixed(1)}>
              <Slider
                value={[step.drive ?? 1.5]}
                min={1}
                max={3}
                step={0.1}
                onValueChange={([v]) =>
                  onChange(patchFxStep(chain, step.id, { drive: v ?? 1.5 }))
                }
              />
            </Field>
          )}

          {step.type === "reverb" && (
            <Field label="Mix %" hint={`${step.mix ?? 25}`}>
              <Slider
                value={[step.mix ?? 25]}
                min={0}
                max={100}
                step={1}
                onValueChange={([v]) =>
                  onChange(patchFxStep(chain, step.id, { mix: v ?? 25 }))
                }
              />
            </Field>
          )}

          {step.type === "delay" && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Time ms" hint={`${step.timeMs ?? 250}`}>
                <Slider
                  value={[step.timeMs ?? 250]}
                  min={10}
                  max={1000}
                  step={5}
                  onValueChange={([v]) =>
                    onChange(patchFxStep(chain, step.id, { timeMs: v ?? 250 }))
                  }
                />
              </Field>
              <Field label="Feedback %" hint={`${step.feedback ?? 30}`}>
                <Slider
                  value={[step.feedback ?? 30]}
                  min={0}
                  max={80}
                  step={1}
                  onValueChange={([v]) =>
                    onChange(patchFxStep(chain, step.id, { feedback: v ?? 30 }))
                  }
                />
              </Field>
              <Field label="Mix %" hint={`${step.mix ?? 20}`}>
                <Slider
                  value={[step.mix ?? 20]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={([v]) =>
                    onChange(patchFxStep(chain, step.id, { mix: v ?? 20 }))
                  }
                />
              </Field>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
