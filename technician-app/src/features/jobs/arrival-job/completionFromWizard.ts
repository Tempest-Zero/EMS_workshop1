/**
 * Maps the arrival wizard's collected data to the backend completion form.
 * Pure — the wizard's submit stays a one-liner and this stays unit-testable.
 *
 * Fuel is deliberately OMITTED: an absent fuel_paisa tells the server to
 * bill the derived round-trip route fuel (0035); sending 0 would read as an
 * explicit manual zero and suppress it.
 */

import type { CompletionInput } from "../../../lib/jobsApi";
import type { ArrivalDraft } from "./arrivalDraft";

export interface WizardOutcome {
  outcome: string;
  timeSpentMins: number;
  /** Present when the tech overrode the stopwatch — reason is required. */
  adjustReason: string | null;
}

export function completionFromWizard(draft: ArrivalDraft, result: WizardOutcome): CompletionInput {
  const remarkBits = [`Outcome: ${result.outcome}`];
  if (result.adjustReason) {
    remarkBits.push(`Time adjusted — ${result.adjustReason.trim()}`);
  }
  if (draft.voiceUri && !draft.remarkMediaId) {
    // The voice summary is still queued for upload; leave a discoverable
    // trace so the bill reviewer knows audio exists (no backend field links
    // a not-yet-uploaded clip).
    remarkBits.push("[voice summary pending upload]");
  }

  return {
    materials: draft.materials.filter((m) => m.name.trim() && m.qty > 0 && m.unit_paisa >= 0),
    time_spent_mins: Math.max(0, Math.round(result.timeSpentMins)),
    remarks_text: remarkBits.join(" · "),
    ...(draft.remarkMediaId ? { remarks_audio_media_id: draft.remarkMediaId } : {}),
    // Only server-sourced ids are ever sent (offline fallback chips don't
    // exist in the seeded vocabulary and must not reach the FK).
    ...(draft.faultId ? { fault_code_id: draft.faultId } : {}),
    ...(draft.actionId ? { action_code_id: draft.actionId } : {}),
  };
}
