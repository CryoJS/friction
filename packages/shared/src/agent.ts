/**
 * The one agent. Friction drives a single browser agent through the task: no
 * personas, no role-play. The agent is a competent first-time visitor, so what
 * it stumbles on is what a real, capable newcomer would stumble on.
 */

export interface AgentDefinition {
  displayName: string;
  /** One line, shown in the UI while the live view is still coming up. */
  description: string;
  /**
   * Deterministic abandonment threshold: after this many failed attempts (dead
   * clicks, focus that would not move, actions that could not be executed) the
   * agent gives up and the run ends with outcome "failure". Enforced by the
   * orchestrator so the behaviour does not depend on the model remembering to quit.
   */
  maxFailedAttempts: number;
  /** Prepended to the planner instructions on every step. */
  systemPrompt: string;
}

export const AGENT: AgentDefinition = {
  displayName: "First-time visitor",
  description: "A competent first-time visitor attempting the task on the live site.",
  maxFailedAttempts: 4,
  systemPrompt:
    "You are a competent adult visiting this website for the first time, trying to complete the task you are given. " +
    "You are comfortable with the web: you scan headings, navigation and button labels, use search when it is the quickest route, and dismiss banners and popups that get in your way. " +
    "You have never seen this site before, so you rely only on what the page shows you; you do not know its URLs, its layout or any shortcuts in advance. " +
    "Work towards the task efficiently and sensibly. If something you try does not work, notice it, and try a reasonable alternative rather than repeating yourself indefinitely. " +
    "Use the mouse or the keyboard, whichever a typical person would use for that control. " +
    "Keep your rationale to one plain sentence in the first person describing what you see and why you are taking this action.",
};
