/**
 * Pure submit-routing for the execution-mode composer.
 *
 * Mirrors ExecutionControlComposer enter intent:
 * - active + steerable → steer_turn on session_log
 * - active + not steerable → local queue (flush into next resume)
 * - not running → resume via dispatchIssueAgent
 */

export type ExecutionComposerRoute = "steer" | "queue" | "resume" | "noop";

export interface ExecutionComposerRouteInput {
  /** Run is live/waiting and accepts steer_turn. */
  canSteer: boolean;
  /** Run is active (live/waiting/idle) — guidance must queue, not resume. */
  isActive: boolean;
  /** True when the submit carries text, attachments, or context refs. */
  hasContent: boolean;
  /** An in-flight stop/resume/hard_reset blocks further dispatch. */
  dispatchPending?: boolean;
}

/**
 * Decide where a composer submit should go in execution mode.
 *
 * Empty submits are noop while steerable or active (queue/steer need content).
 * Empty resume is allowed when idle so Enter can restart the last run.
 */
export function resolveExecutionComposerRoute(input: ExecutionComposerRouteInput): ExecutionComposerRoute {
  if (input.dispatchPending) return "noop";

  if (input.canSteer) {
    return input.hasContent ? "steer" : "noop";
  }

  if (input.isActive) {
    return input.hasContent ? "queue" : "noop";
  }

  // Idle / no-run: resume (or start). Empty submit is intentional (re-run).
  return "resume";
}
