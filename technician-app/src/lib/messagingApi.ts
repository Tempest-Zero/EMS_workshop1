/**
 * Customer-messaging endpoints (mirrors the backend `customer_messaging`
 * slice). v1 is click-to-chat: the backend composes the message and mints a
 * wa.me deep link; the phone opens WhatsApp with it and then WITNESSES the
 * send on the job timeline via send-log. Consent-gated server-side — the
 * preview says whether this customer may be messaged at all.
 */

import { request } from "./api";
import type { JobDetail } from "./jobsApi";

export type WhatsAppKind = "intake_ack" | "bill" | "ready";

export interface MessagePreview {
  kind: WhatsAppKind;
  to_phone_e164: string | null;
  /** False = no opt-in on record; the Send button must stay disabled. */
  consent: boolean;
  whatsapp_opt_in_at: string | null;
  body: string;
  /** Click-to-chat deep link; null when consent/phone is missing. */
  wa_me_url: string | null;
  cloud_enabled: boolean;
}

export const messagingApi = {
  preview(jobId: string, kind: WhatsAppKind): Promise<MessagePreview> {
    return request<MessagePreview>(
      `/api/messaging/jobs/${jobId}/whatsapp/preview?kind=${kind}`,
    );
  },

  /** Record a click-to-chat send on the job timeline (after WhatsApp opened). */
  logSend(jobId: string, kind: WhatsAppKind): Promise<JobDetail> {
    return request<JobDetail>(`/api/messaging/jobs/${jobId}/whatsapp/send-log`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    });
  },
};
