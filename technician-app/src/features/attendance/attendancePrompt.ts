/**
 * A one-slot signal carrying "the tech tapped a clock-in/out prompt" from the
 * notification handler to the ClockScreen. The screen reads it on focus to
 * highlight the matching action — so arriving from the prompt lands on a
 * one-tap, already-primed button instead of a cold screen.
 *
 * Deliberately tiny and outside React (the notification handler isn't in the
 * tree); the screen subscribes and re-renders.
 */

import type { AttendanceAction } from "./attendanceNotifications";

let pending: AttendanceAction | null = null;
const listeners = new Set<() => void>();

export function setAttendancePrompt(action: AttendanceAction): void {
  pending = action;
  listeners.forEach((l) => l());
}

export function getAttendancePrompt(): AttendanceAction | null {
  return pending;
}

export function clearAttendancePrompt(): void {
  if (pending === null) return;
  pending = null;
  listeners.forEach((l) => l());
}

export function subscribeAttendancePrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
