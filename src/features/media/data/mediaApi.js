/**
 * Job media endpoints on the shared client. The manager JobDetail reads a job's
 * before/after capture (photos + video) through here. The mobile technician app
 * writes it via the same backend routes (`POST /api/jobs/{jobKey}/media`).
 *
 * `jobKey` is the free-text id the technician types into the app's "Job ID"
 * field. For the demo we key on the job's human **token** (e.g. "1051") because
 * it's short and easy to type on a phone; when the mobile app gains real job
 * context (J5) this becomes the job's stable UUID.
 */

import { apiGet } from "@shared/lib/api";

/** List a job's media, grouped `{ before: [...], after: [...] }`. */
export function fetchJobMedia(jobKey) {
  return apiGet(`/api/jobs/${encodeURIComponent(jobKey)}/media`);
}
