/**
 * One place for the human face of a job's type — so the list, the detail
 * header and any future surface all show the same icon + label. `isVisit`
 * mirrors the backend rule (a "visit" is any job the shop travels for; only a
 * carry-in has no travel leg).
 */
import type { JobType } from "../../lib/jobsApi";

export interface JobTypeBadge {
  icon: string;
  label: string;
}

export function jobTypeBadge(type: JobType): JobTypeBadge {
  switch (type) {
    case "home-visit":
      return { icon: "🏠", label: "Visit" };
    case "pickup-delivery":
      return { icon: "🚚", label: "Pickup" };
    case "carry-in":
      return { icon: "🏪", label: "Carry-in" };
  }
}

/** True for the job types the shop travels for (home-visit, pickup-delivery). */
export function isVisitType(type: JobType): boolean {
  return type !== "carry-in";
}
