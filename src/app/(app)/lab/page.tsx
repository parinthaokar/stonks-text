import { MoodLab } from "@/components/lab/mood-lab";
import { PipelineInfoCard } from "@/components/lab/pipeline-info";

export const metadata = { title: "Mood Lab — Stonks & Texts" };

export default function LabPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Mood Lab</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The rules engine decides what an asset says. This asks a trained model to do the same
          job from the numbers alone — a scikit-learn Pipeline running on Modal, called live from
          your browser. Move the sliders and it re-predicts.
        </p>
      </div>

      <MoodLab />
      <PipelineInfoCard />

      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground">How to read this.</strong> The model was
        trained on labels produced by this project&apos;s own rules engine, so a high score means it
        successfully imitated hand-written rules — not that it discovered something about markets.
        What is genuine is that no rule threshold was ever given to it: the transformer emits only
        magnitude, direction, curvature and volume, and the model had to find the boundaries itself.
      </p>
    </div>
  );
}
