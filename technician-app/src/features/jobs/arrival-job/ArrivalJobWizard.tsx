/**
 * The 5-step on-site wizard (F8–F14): arrival evidence → voice summary →
 * diagnosis → materials → outcome & time. The wizard OWNS the collected data
 * (steps are dumb), persists a per-job draft across process death, uploads
 * evidence eagerly (falling back to the pending-media queue when offline),
 * and submits the completion through the outbox before opening the bill.
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View, SafeAreaView, StatusBar } from 'react-native';

import { api, ApiError, type MediaType, type Phase } from "../../../lib/api";
import { jobsApi, type JobType } from "../../../lib/jobsApi";
import type { RootStackParamList } from "../../../lib/navigation";
import { makeItem } from "../../../lib/outbox";
import { sendOrQueue } from "../../../lib/outboxSync";
import { enqueuePendingMedia, removePendingMedia } from "../../media/pendingMedia";
import { uploadMedia } from "../../media/uploadMedia";
import {
  clearArrivalDraft,
  EMPTY_DRAFT,
  loadArrivalDraft,
  saveArrivalDraft,
  type ArrivalDraft,
  type UploadState,
} from './arrivalDraft';
import { completionFromWizard } from './completionFromWizard';
import { ArrivalCapturesScreen } from './ArrivalCapturesScreen';
import { ArrivalJobStep2 } from './ArrivalJobStep2';
import { ArrivalJobStep3 } from './ArrivalJobStep3';
import { ArrivalJobStep4 } from './ArrivalJobStep4';
import { ArrivalJobStep5 } from './ArrivalJobStep5';

type Props = NativeStackScreenProps<RootStackParamList, "ArrivalWizard">;

export function ArrivalJobWizard({ route, navigation }: Props) {
  const { id, token } = route.params;

  const [draft, setDraft] = useState<ArrivalDraft | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [jobType, setJobType] = useState<JobType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const draftRef = useRef<ArrivalDraft | null>(null);
  draftRef.current = draft;

  // Restore the per-job draft (killed app ⇒ captured evidence survives) and
  // learn the job's category for the pickers — best-effort, offline-tolerant.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await loadArrivalDraft(id);
      let job = null;
      try {
        job = await jobsApi.get(id);
      } catch {
        /* offline — pickers fall back to unscoped/local behaviour, neutral copy */
      }
      if (cancelled) return;
      if (job) {
        setCategoryId(job.category_id);
        setJobType(job.job_type);
      }

      // Anchor the on-site clock ONCE, then persist it so a killed/reopened
      // wizard keeps the true elapsed time instead of restarting from now.
      // Priority: the arrival nav param → the arrive_customer punch → now.
      let next = saved ?? { ...EMPTY_DRAFT };
      if (next.arrivalAtMs == null) {
        const arrivePunch = job?.locations.find((l) => l.kind === "arrive_customer");
        const startedMs =
          route.params.arrivalTime ??
          (arrivePunch ? Date.parse(arrivePunch.captured_at) : Date.now());
        next = { ...next, arrivalAtMs: startedMs };
        void saveArrivalDraft(id, next);
      }
      setDraft(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const update = useCallback(
    (patch: Partial<ArrivalDraft>) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        void saveArrivalDraft(id, next);
        return next;
      });
    },
    [id],
  );

  /**
   * Eager evidence upload. Online it lands now; offline / flaky it joins the
   * pending-media queue keyed by the job token — either way the tile state is
   * honest and nothing is silently dropped.
   */
  const uploadEvidence = useCallback(
    async (slot: string, phase: Phase, type: MediaType, uri: string, contentType: string) => {
      const setSlot = (state: UploadState) => {
        const current = draftRef.current;
        if (!current) return;
        update({ uploads: { ...current.uploads, [slot]: state } });
      };
      setSlot("uploading");
      const ext = contentType.startsWith("image/")
        ? "jpg"
        : contentType.startsWith("video/")
          ? "mp4"
          : "m4a";
      const filename = `${slot.replace(/[^a-z0-9]/gi, "-")}-${Date.now()}.${ext}`;
      try {
        const item = await uploadMedia({
          jobId: String(token),
          phase,
          type,
          uri,
          filename,
          contentType,
        });
        setSlot("done");
        if (phase === "remark") update({ remarkMediaId: item.id });
      } catch (e) {
        if (e instanceof ApiError && e.status < 500 && e.status !== 429) {
          setSlot("failed"); // definitive — visible, the tech can recapture
          return;
        }
        await enqueuePendingMedia({
          id: `arrival:${id}:${slot}`,
          jobClientId: id,
          jobToken: String(token),
          phase,
          type,
          uri,
          filename,
          contentType,
        });
        setSlot("queued"); // uploads when the network returns
      }
    },
    [id, token, update],
  );

  const submit = useCallback(
    async (outcome: string, timeSpentMins: number, adjustReason: string | null) => {
      const current = draftRef.current;
      if (!current || submitting) return;
      setSubmitting(true);
      try {
        const body = completionFromWizard(current, { outcome, timeSpentMins, adjustReason });
        try {
          await sendOrQueue(
            makeItem({ id: `completion:${id}`, kind: "completion", jobId: id, payload: { body } }),
            () => jobsApi.submitCompletion(id, body),
          );
        } catch (e) {
          const detail =
            e instanceof ApiError
              ? (/"detail"\s*:\s*"([^"]+)"/.exec(e.message)?.[1] ?? `rejected (${e.status})`)
              : "rejected";
          Alert.alert("Couldn't submit the completion", detail);
          return;
        }
        await clearArrivalDraft(id);
        navigation.goBack();
        setTimeout(() => {
          navigation.navigate('BillSheet', { id, token });
        }, 300);
      } finally {
        setSubmitting(false);
      }
    },
    [id, token, navigation, submitting],
  );

  if (!draft) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#2563eb" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      <View style={styles.contentArea}>
        {draft.step === 1 && (
          <ArrivalCapturesScreen
            draft={draft}
            jobType={jobType}
            onCapture={(slot, patch, phase, type, uri, contentType) => {
              update(patch);
              void uploadEvidence(slot, phase, type, uri, contentType);
            }}
            onPatch={update}
            onNext={() => update({ step: 2 })}
          />
        )}
        {draft.step === 2 && (
          <ArrivalJobStep2
            voiceUri={draft.voiceUri}
            onRecorded={(uri) => {
              update({ voiceUri: uri });
              void uploadEvidence("voice", "remark", "audio", uri, "audio/mp4");
            }}
            onDeleted={() => {
              // The eager upload may already be server-side — delete it there
              // too (best-effort: offline leaves the row and the next clip
              // simply supersedes it as the completion's link), and drop any
              // still-queued offline copy so a deleted note can't upload later.
              const mediaId = draftRef.current?.remarkMediaId;
              if (mediaId) void api.deleteMedia(String(token), mediaId).catch(() => {});
              void removePendingMedia(`arrival:${id}:voice`);
              const uploads = { ...(draftRef.current?.uploads ?? {}) };
              delete uploads.voice;
              update({ voiceUri: null, remarkMediaId: null, uploads });
            }}
            onNext={() => update({ step: 3 })}
          />
        )}
        {draft.step === 3 && (
          <ArrivalJobStep3
            categoryId={categoryId}
            faultId={draft.faultId}
            actionId={draft.actionId}
            onPick={(faultId, actionId) => update({ faultId, actionId })}
            onNext={() => update({ step: 4 })}
          />
        )}
        {draft.step === 4 && (
          <ArrivalJobStep4
            categoryId={categoryId}
            materials={draft.materials}
            setMaterials={(materials) => update({ materials })}
            onNext={() => update({ step: 5 })}
          />
        )}
        {draft.step === 5 && (
          <ArrivalJobStep5
            arrivalTime={draft.arrivalAtMs ?? Date.now()}
            submitting={submitting}
            onComplete={(outcome, timeSpentMins, adjustReason) =>
              void submit(outcome, timeSpentMins, adjustReason)
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  center: { alignItems: 'center', justifyContent: 'center' },
  contentArea: { flex: 1 },
});
