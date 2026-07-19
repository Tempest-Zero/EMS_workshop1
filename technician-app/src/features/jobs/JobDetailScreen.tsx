/**
 * Job Detail — the lean hub of the job flow (F9). It shows customer, problem,
 * evidence and the live timeline, and holds ONLY the actions no other screen
 * owns:
 *   - the flow entry points: Travel and the on-site arrival wizard
 *   - notes · Mark Ready · Close + video · Abandon · Customer unreachable
 *   - void/correct a payment, and the failed-outbox recovery list
 * Everything else moved to its dedicated home: capture + diagnosis +
 * completion live in the arrival wizard, negotiate/payments/WhatsApp-bill/
 * close live on the BillSheet ("View bill / take payment"), and route punches
 * live on the Travel screen. Every action calls the live backend and
 * re-renders from the authoritative JobDetail it returns; writes ride the
 * outbox with a client_id so an offline retry never double-records.
 */

import { useFocusEffect, type CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { EvidenceStrip } from "../media/EvidenceStrip";
import { ApiError } from "../../lib/api";
import { coalesce } from "../../lib/coalesce";
import { jobsApi, type JobDetail, type TransitionAction } from "../../lib/jobsApi";
import { cacheStamp, loadJobDetail, saveJobDetail } from "../../lib/jobsCache";
import { messagingApi, type WhatsAppKind } from "../../lib/messagingApi";
import { formatPaisa } from "../../lib/money";
import type { RootStackParamList } from "../../lib/navigation";
import {
  discardItem,
  makeItem,
  onOutboxChange,
  retryItem,
  type OutboxItem,
} from "../../lib/outbox";
import { sendOrQueue, type PaymentPayload } from "../../lib/outboxSync";
import { useJobOutbox } from "../../lib/useJobOutbox";
import { closeJobWithVideo } from "./closeJobWithVideo";
import { jobTypeBadge } from "./jobType";
import { SchedulePickerModal } from "./SchedulePickerModal";
import type { JobsStackParamList } from "./types";

const OFFLINE_MSG = "Saved offline — will sync when reconnected.";

/** The server's human-readable rejection (FastAPI `detail`), if present. */
function apiDetail(e: ApiError): string | null {
  return /"detail"\s*:\s*"([^"]+)"/.exec(e.message)?.[1] ?? null;
}

/** Human label for a queued/failed outbox entry in the overlay lists. */
function itemLabel(item: OutboxItem): string {
  switch (item.kind) {
    case "create":
      return "New job (intake)";
    case "payment": {
      const p = item.payload as PaymentPayload;
      return `Payment ${formatPaisa(p.amountPaisa)} (${p.method})`;
    }
    case "completion":
      return "Completion form";
    case "negotiate":
      return `Negotiated ${formatPaisa((item.payload as { amountPaisa: number }).amountPaisa)}`;
    case "void":
      return "Payment correction (void)";
    case "location":
      return "GPS punch";
    case "customer_pin":
      return "Customer home pin";
    case "ready":
      return "Mark Ready";
    case "note":
      return "Note";
    case "transition": {
      const a = (item.payload as { action: string }).action;
      if (a === "wait") return "Put on hold";
      if (a === "reschedule") return "Reschedule";
      if (a === "haul") return "Convert to carry-in";
      return "Status change";
    }
  }
}

// Composite: this screen lives in the Jobs stack but also opens the ROOT
// stack's arrival-wizard modal (the post-arrival evidence flow).
type Props = CompositeScreenProps<
  NativeStackScreenProps<JobsStackParamList, "JobDetail">,
  NativeStackScreenProps<RootStackParamList>
>;

type Busy =
  | "note"
  | "ready"
  | "close"
  | "abandon"
  | "void"
  | "whatsapp"
  | "transition"
  | null;

const STATUS_COLOR: Record<string, string> = {
  open: "#2563eb",
  waiting: "#d97706",
  ready: "#059669",
  closed: "#64748b",
};

export function JobDetailScreen({ route, navigation }: Props) {
  const { id, token } = route.params;
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Busy>(null);

  // Void/correct a payment — the one money write that has no other home
  // (the BillSheet only logs payments; corrections stay here on the hub).
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  // Abandon (the no-completion exit the close guard assumes exists).
  const [abandoning, setAbandoning] = useState(false);
  const [abandonReason, setAbandonReason] = useState("");

  // Customer-unreachable actions (hold / reschedule / haul-to-workshop).
  const [unreachableOpen, setUnreachableOpen] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // Set when the detail on screen is the offline cache, not server truth.
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  // Mirrors `job` for the load callback: reading state there would change the
  // callback's identity on every load and re-trigger the focus effect.
  const jobRef = useRef<JobDetail | null>(null);
  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  const load = useCallback(async () => {
    try {
      const fresh = await jobsApi.get(id);
      setJob(fresh);
      setError(null);
      setCachedAt(null);
      void saveJobDetail(fresh); // refresh the offline copy (best-effort)
    } catch {
      // Cold start with no signal: fall back to the last synced copy so the
      // tech still has the customer's address/phone — clearly labelled stale.
      // If a live copy is already on screen, keep it (don't downgrade).
      if (jobRef.current === null) {
        const cached = await loadJobDetail(id);
        if (cached) {
          setJob(cached.data);
          setCachedAt(cached.savedAt);
          setError(null);
          return;
        }
      }
      setError("Couldn't load this job — check your connection.");
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // When the outbox drains (a queued write synced), reload so the authoritative
  // bill / cash / route appears in place of the optimistic "saved offline" note.
  // notify() fires per queue mutation, so a drain settling N items would mean N
  // reloads — coalesce the burst into one fetch after a quiet gap.
  useEffect(() => {
    const reload = coalesce(() => void load(), 400);
    const unsubscribe = onOutboxChange(reload.call);
    return () => {
      unsubscribe();
      reload.cancel();
    };
  }, [load]);

  // The pending overlay: queued/failed outbox items for THIS job, rendered on
  // top of server truth so an offline tech sees what they recorded.
  const outboxView = useJobOutbox(id);
  const pendingPayments = outboxView.queued.filter((i) => i.kind === "payment");
  const pendingPaisa = pendingPayments.reduce(
    (s, i) => s + (i.payload as PaymentPayload).amountPaisa,
    0,
  );
  const pendingCompletion = outboxView.queued.some((i) => i.kind === "completion");
  const pendingReady = outboxView.queued.some((i) => i.kind === "ready");
  const pendingTransition = outboxView.queued.find((i) => i.kind === "transition");

  const submitNote = useCallback(async () => {
    const text = note.trim();
    if (!text || busy) return;
    setBusy("note");
    setError(null);
    setInfo(null);
    try {
      const detail = await sendOrQueue(
        makeItem({
          id: `note:${Crypto.randomUUID()}`,
          kind: "note",
          jobId: id,
          payload: { text },
        }),
        () => jobsApi.addNote(id, text),
      );
      if (detail) setJob(detail);
      else setInfo(OFFLINE_MSG);
      setNote("");
    } catch {
      setError("Couldn't add the note — try again.");
    } finally {
      setBusy(null);
    }
  }, [id, note, busy]);

  const markReady = useCallback(async () => {
    if (busy) return;
    setBusy("ready");
    setError(null);
    setInfo(null);
    try {
      const detail = await sendOrQueue(
        makeItem({ id: `ready:${id}`, kind: "ready", jobId: id, payload: {} }),
        () => jobsApi.transition(id, "ready"),
      );
      if (detail) setJob(detail);
      else setInfo(OFFLINE_MSG);
    } catch {
      setError("Couldn't mark ready — try again.");
    } finally {
      setBusy(null);
    }
  }, [id, busy]);

  // Closing a job requires a closing video (P3c gate) — the capture/upload/
  // transition flow is the shared closeJobWithVideo (also the bill sheet's
  // close). Here we keep the pre-check that mirrors the server's Phase-4
  // close guard BEFORE recording: a normal close needs the completion form.
  // Checking first means the tech is never sent through a video capture whose
  // close is doomed to 409 — and no orphan closing clip gets uploaded. A
  // completion still syncing counts (the server sees it before the close
  // lands, or the 409 says so).
  const closeWithVideo = useCallback(async () => {
    if (busy) return;
    if (!job?.completion && !pendingCompletion) {
      Alert.alert(
        "Completion form required",
        "Fill the work-completion form before closing. If there is nothing to bill, abandon the job instead.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Abandon job…",
            style: "destructive",
            onPress: () => setAbandoning(true),
          },
          {
            text: "Complete form",
            onPress: () => navigation.navigate("CompleteJob", { id, token }),
          },
        ],
      );
      return;
    }
    setBusy("close");
    setError(null);
    try {
      const result = await closeJobWithVideo(id, token);
      if (result.kind === "closed") setJob(result.job);
      else if (result.kind !== "canceled") setError(result.message);
    } finally {
      setBusy(null);
    }
  }, [id, token, busy, job?.completion, pendingCompletion, navigation]);

  const abandonJob = useCallback(async () => {
    const reason = abandonReason.trim();
    if (!reason || busy) return;
    setBusy("abandon");
    setError(null);
    setInfo(null);
    try {
      setJob(await jobsApi.transition(id, "abandon", reason));
      setAbandoning(false);
      setAbandonReason("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(apiDetail(e) ?? "The job can no longer be abandoned.");
      } else {
        setError("Couldn't abandon the job — check your connection and try again.");
      }
    } finally {
      setBusy(null);
    }
  }, [id, abandonReason, busy]);

  // The customer-unreachable transitions (wait / reschedule / haul). Each rides
  // the outbox so an offline decision survives; the id is per-action so a
  // repeated tap is last-write-wins, never a double.
  const queueTransition = useCallback(
    async (
      action: TransitionAction,
      extra?: { reason?: string; preferred_date?: string; time_window?: string },
    ) => {
      if (busy) return;
      setBusy("transition");
      setError(null);
      setInfo(null);
      try {
        const detail = await sendOrQueue(
          makeItem({
            id: `transition:${action}:${id}`,
            kind: "transition",
            jobId: id,
            payload: { action, ...extra },
          }),
          () =>
            jobsApi.transition(id, action, extra?.reason, {
              preferred_date: extra?.preferred_date,
              time_window: extra?.time_window,
            }),
        );
        if (detail) setJob(detail);
        else setInfo(OFFLINE_MSG);
        setUnreachableOpen(false);
        setHoldReason("");
      } catch (e) {
        if (e instanceof ApiError) {
          setError(apiDetail(e) ?? "Couldn't update the job — try again.");
        } else {
          setError("Couldn't update the job — try again.");
        }
      } finally {
        setBusy(null);
      }
    },
    [id, busy],
  );

  const voidPayment = useCallback(
    async (paymentId: string) => {
      const reason = voidReason.trim();
      if (!reason || busy) return;
      setBusy("void");
      setError(null);
      setInfo(null);
      try {
        const detail = await sendOrQueue(
          makeItem({
            id: `void:${paymentId}`,
            kind: "void",
            jobId: id,
            payload: { paymentId, reason },
          }),
          () => jobsApi.voidPayment(id, paymentId, reason),
        );
        if (detail) setJob(detail);
        else setInfo(OFFLINE_MSG);
        setVoidingId(null);
        setVoidReason("");
      } catch {
        setError("Couldn't void the payment — try again.");
      } finally {
        setBusy(null);
      }
    },
    [id, voidReason, busy],
  );

  // v1 WhatsApp is click-to-chat: the backend composes the text + wa.me link
  // (consent-gated), the phone opens WhatsApp, and send-log witnesses it on
  // the job timeline. Online-only by nature — there is no offline wa.me.
  const sendWhatsApp = useCallback(
    async (kind: WhatsAppKind) => {
      if (busy) return;
      setBusy("whatsapp");
      setError(null);
      setInfo(null);
      try {
        const preview = await messagingApi.preview(id, kind);
        if (!preview.consent) {
          setError("No WhatsApp consent on record for this customer.");
          return;
        }
        if (!preview.wa_me_url) {
          setError("No WhatsApp-capable phone number on this job.");
          return;
        }
        await Linking.openURL(preview.wa_me_url);
        setJob(await messagingApi.logSend(id, kind));
      } catch (e) {
        if (e instanceof ApiError) {
          setError(apiDetail(e) ?? "Couldn't prepare the WhatsApp message — try again.");
        } else {
          setError("Couldn't open WhatsApp — check your connection and try again.");
        }
      } finally {
        setBusy(null);
      }
    },
    [id, busy],
  );

  if (error && !job) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!job) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const statusColor = STATUS_COLOR[job.status] ?? "#64748b";
  const isReady = job.status === "ready";
  const canClose = job.status !== "closed";
  const open = job.status !== "closed";
  const hasBill = job.bill_original_paisa != null;
  // A "visit" is any job the shop travels for — home-visit AND pickup-delivery
  // (the shop drives both ways). Only a carry-in has no travel leg. Matches the
  // backend's create-time rule.
  const isVisit = job.job_type !== "carry-in";
  const hasArrive = job.locations.some((l) => l.kind === "arrive_customer");
  // Return leg: offer "head back" once they've arrived, until an
  // arrive_workshop punch AFTER the latest customer arrival closes the loop.
  // Deliberately independent of `open` — the drive back usually happens after
  // the job closed, and it still needs recording for the fuel line.
  const lastArriveAt = job.locations
    .filter((l) => l.kind === "arrive_customer")
    .reduce<string | null>((max, l) => (max === null || l.captured_at > max ? l.captured_at : max), null);
  const returned =
    lastArriveAt !== null &&
    job.locations.some((l) => l.kind === "arrive_workshop" && l.captured_at > lastArriveAt);
  const showHeadBack = isVisit && hasArrive && !returned;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.token}>#{job.token}</Text>
        <View style={styles.headerChips}>
          <View style={styles.typeChip}>
            <Text style={styles.typeChipText}>
              {jobTypeBadge(job.job_type).icon} {jobTypeBadge(job.job_type).label}
            </Text>
          </View>
          <View style={[styles.chip, { backgroundColor: statusColor + "1a" }]}>
            <Text style={[styles.chipText, { color: statusColor }]}>{job.status}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.appliance}>
        {job.appliance_type}
        {job.appliance_brand ? ` · ${job.appliance_brand}` : ""}
      </Text>

      {cachedAt ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            Offline — showing the last synced copy ({cacheStamp(cachedAt)}). Anything you record
            here will sync when you reconnect.
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.label}>CUSTOMER</Text>
        <Text style={styles.value}>{job.customer_name}</Text>
        {job.customer_phone ? <Text style={styles.sub}>{job.customer_phone}</Text> : null}
        {job.customer_address ? <Text style={styles.sub}>{job.customer_address}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>PROBLEM</Text>
        <Text style={styles.value}>{job.problem}</Text>
      </View>

      {/* The hub flow: travel first (home visits), then the on-site wizard.
          "Arrived" is server truth — the arrive_customer punch — not a nav
          param, so a killed app or second device shows the same state. */}
      {open ? (
        <View style={styles.card}>
          {isVisit && !hasArrive ? (
            <>
              <Text style={styles.label}>TRAVEL</Text>
              <Text style={styles.sub}>
                Head out, then punch your arrival at the customer's door.
              </Text>
              <Pressable
                style={styles.travelBtn}
                onPress={() => navigation.navigate("Travel", { id, token })}
              >
                <Text style={styles.travelBtnText}>🚀 START TRAVEL</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.label}>{isVisit ? "ON-SITE WORK" : "WORKSHOP WORK"}</Text>
              <Text style={styles.sub}>
                Capture the evidence and diagnosis with the step-by-step wizard.
              </Text>
              <Pressable
                style={styles.wizardBtn}
                onPress={() => navigation.navigate("ArrivalWizard", { id, token })}
              >
                <Text style={styles.btnDarkText}>📋 Open Job Wizard</Text>
              </Pressable>
              {isVisit ? (
                <Pressable
                  style={styles.travelAgainLink}
                  onPress={() => navigation.navigate("Travel", { id, token })}
                >
                  <Text style={styles.travelAgainText}>
                    🚗 Travel again — start a new trip
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {/* The return leg — outside the `open` gate on purpose: the drive back
          usually happens after the job closed, and the fuel line wants it. */}
      {showHeadBack ? (
        <View style={styles.card}>
          <Text style={styles.label}>RETURN TRIP</Text>
          <Text style={styles.sub}>
            Record the drive back — it completes the travel/fuel record for this job.
          </Text>
          <Pressable
            style={styles.travelBtn}
            onPress={() => navigation.navigate("Travel", { id, token, leg: "return" })}
          >
            <Text style={styles.travelBtnText}>🏭 HEAD BACK TO WORKSHOP</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.label}>ACTIONS</Text>
        <TextInput
          style={styles.input}
          value={note}
          onChangeText={setNote}
          placeholder="Add a note…"
          multiline
          editable={busy !== "note"}
        />
        <Pressable
          style={[styles.btn, styles.btnDark, (busy === "note" || !note.trim()) && styles.btnBusy]}
          onPress={() => void submitNote()}
          disabled={busy === "note" || !note.trim()}
        >
          <Text style={styles.btnDarkText}>{busy === "note" ? "Adding…" : "Add note"}</Text>
        </Pressable>

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}
        {info ? <Text style={styles.inlineInfo}>{info}</Text> : null}

        <View style={styles.statusRow}>
          {canClose ? (
            <Pressable
              style={[
                styles.btn,
                styles.btnReady,
                (busy === "ready" || pendingReady || isReady) && styles.btnBusy,
                styles.grow,
              ]}
              onPress={() => void markReady()}
              disabled={!!busy || pendingReady || isReady}
            >
              <Text style={styles.btnReadyText}>
                {busy === "ready"
                  ? "…"
                  : pendingReady
                    ? "Ready · syncing…"
                    : isReady
                      ? "✓ Ready"
                      : "Mark Ready"}
              </Text>
            </Pressable>
          ) : null}
          {canClose ? (
            <Pressable
              style={[
                styles.btn,
                styles.btnOutline,
                busy === "close" && styles.btnBusy,
                styles.grow,
              ]}
              onPress={() => void closeWithVideo()}
              disabled={!!busy}
            >
              <Text style={styles.btnOutlineText}>
                {busy === "close" ? "…" : "Close + video"}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {open ? (
          abandoning ? (
            <View style={styles.voidBox}>
              <TextInput
                style={[styles.input, styles.inlineInput, { marginBottom: 8 }]}
                value={abandonReason}
                onChangeText={setAbandonReason}
                placeholder="Why is this job being abandoned?"
                editable={busy !== "abandon"}
              />
              <View style={styles.statusRow}>
                <Pressable
                  style={[styles.btn, styles.btnOutline, styles.grow]}
                  onPress={() => {
                    setAbandoning(false);
                    setAbandonReason("");
                  }}
                >
                  <Text style={styles.btnOutlineText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.btn,
                    styles.btnDanger,
                    styles.grow,
                    (busy === "abandon" || !abandonReason.trim()) && styles.btnBusy,
                  ]}
                  onPress={() => void abandonJob()}
                  disabled={busy === "abandon" || !abandonReason.trim()}
                >
                  <Text style={styles.btnDarkText}>
                    {busy === "abandon" ? "…" : "Abandon job"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={styles.abandonLink} onPress={() => setAbandoning(true)}>
              <Text style={styles.abandonLinkText}>Abandon job (nothing to bill)…</Text>
            </Pressable>
          )
        ) : null}

        {open && isVisit && !abandoning ? (
          <Pressable style={styles.unreachableLink} onPress={() => setUnreachableOpen(true)}>
            <Text style={styles.unreachableLinkText}>Customer unreachable…</Text>
          </Pressable>
        ) : null}
        {pendingTransition ? (
          <Text style={styles.pendingNote}>{itemLabel(pendingTransition)} · syncing…</Text>
        ) : null}
      </View>

      {outboxView.failed.length > 0 ? (
        <View style={[styles.card, styles.failedCard]}>
          <Text style={[styles.label, styles.failedLabel]}>NEEDS ATTENTION — DID NOT SYNC</Text>
          {outboxView.failed.map((i) => (
            <View key={i.id} style={styles.payRow}>
              <View style={styles.grow}>
                <Text style={styles.payAmt}>{itemLabel(i)}</Text>
                <Text style={styles.failedReason}>{i.failedReason ?? "rejected by the server"}</Text>
              </View>
              <Pressable onPress={() => void retryItem(i.id)} hitSlop={8} style={styles.failedAction}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.alert(
                    "Discard this record?",
                    `${itemLabel(i)} will be permanently removed. It was rejected: ${i.failedReason ?? "unknown reason"}.`,
                    [
                      { text: "Keep", style: "cancel" },
                      { text: "Discard", style: "destructive", onPress: () => void discardItem(i.id) },
                    ],
                  )
                }
                hitSlop={8}
                style={styles.failedAction}
              >
                <Text style={styles.correctText}>Discard</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {/* The money surface, lean: totals + payment history + void/correct.
          Negotiation, logging payments, the WhatsApp bill and the close all
          live on the BillSheet (F15/F16) — this button is the hub's way in.
          A completion queued offline shows here so the tech knows the bill
          is coming even before the server builds it. */}
      {hasBill || pendingCompletion || job.payments.length > 0 || pendingPayments.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.label}>BILL &amp; PAYMENTS</Text>
          {pendingCompletion ? (
            <Text style={styles.pendingNote}>Completion saved offline — syncing…</Text>
          ) : null}
          {hasBill ? (
            <>
              <View style={styles.billGrid}>
                <View style={styles.billBox}>
                  <Text style={styles.billBoxLabel}>Received</Text>
                  <Text style={styles.billBoxValue}>
                    {formatPaisa(job.received_paisa + pendingPaisa)}
                  </Text>
                </View>
                <View style={styles.billBox}>
                  <Text style={styles.billBoxLabel}>Balance</Text>
                  <Text style={styles.billBoxValue}>
                    {formatPaisa(job.balance_paisa - pendingPaisa)}
                  </Text>
                </View>
              </View>
              {pendingPaisa > 0 ? (
                <Text style={styles.pendingNote}>
                  Includes {formatPaisa(pendingPaisa)} still syncing.
                </Text>
              ) : null}
            </>
          ) : null}

          {pendingPayments.map((i) => {
            const p = i.payload as PaymentPayload;
            return (
              <View key={i.id} style={styles.payRow}>
                <View style={styles.grow}>
                  <Text style={styles.payAmt}>
                    {formatPaisa(p.amountPaisa)} · {p.method}
                  </Text>
                  <Text style={styles.pendingBadge}>⏳ syncing…</Text>
                </View>
              </View>
            );
          })}

          {job.payments.length === 0 && pendingPayments.length === 0 ? (
            <Text style={styles.sub}>No payments logged yet.</Text>
          ) : (
            job.payments.map((p) => (
              <View key={p.id} style={styles.payRow}>
                <View style={styles.grow}>
                  <Text style={[styles.payAmt, p.voided && styles.voided]}>
                    {formatPaisa(p.amount_paisa)} · {p.method}
                  </Text>
                  <Text style={styles.eventTime}>
                    {p.recorded_at.slice(0, 10)}
                    {p.voided ? ` · voided${p.void_reason ? ` (${p.void_reason})` : ""}` : ""}
                  </Text>
                </View>
                {!p.voided && open ? (
                  <Pressable
                    onPress={() => {
                      setVoidingId(p.id);
                      setVoidReason("");
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.correctText}>Correct</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}

          {voidingId ? (
            <View style={styles.voidBox}>
              <TextInput
                style={[styles.input, styles.inlineInput, { marginBottom: 8 }]}
                value={voidReason}
                onChangeText={setVoidReason}
                placeholder="Reason for correction"
                editable={busy !== "void"}
              />
              <View style={styles.statusRow}>
                <Pressable
                  style={[styles.btn, styles.btnOutline, styles.grow]}
                  onPress={() => {
                    setVoidingId(null);
                    setVoidReason("");
                  }}
                >
                  <Text style={styles.btnOutlineText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.btn,
                    styles.btnDanger,
                    styles.grow,
                    (busy === "void" || !voidReason.trim()) && styles.btnBusy,
                  ]}
                  onPress={() => void voidPayment(voidingId)}
                  disabled={busy === "void" || !voidReason.trim()}
                >
                  <Text style={styles.btnDarkText}>{busy === "void" ? "…" : "Void entry"}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <Pressable
            style={styles.billBtn}
            onPress={() => navigation.navigate("BillSheet", { id, token })}
          >
            <Text style={styles.btnDarkText}>
              💳 {open ? "View bill / take payment" : "View final bill"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Intake-ack and ready-for-pickup are the hub's ONLY WhatsApp sends —
          the bill message lives on the BillSheet. Consent-gated server-side. */}
      {open && job.customer_phone && (!hasBill || isReady) ? (
        <View style={styles.card}>
          <Text style={styles.label}>CUSTOMER MESSAGING · WHATSAPP</Text>
          <Text style={styles.sub}>
            Opens WhatsApp with the composed message; the send is logged on the timeline.
            Consent-gated — blocked unless the customer opted in.
          </Text>
          <View style={styles.statusRow}>
            {!hasBill ? (
              <Pressable
                style={[styles.btn, styles.btnWhatsApp, styles.grow, busy === "whatsapp" && styles.btnBusy]}
                onPress={() => void sendWhatsApp("intake_ack")}
                disabled={!!busy}
              >
                <Text style={styles.btnReadyText}>
                  {busy === "whatsapp" ? "…" : "Acknowledge intake"}
                </Text>
              </Pressable>
            ) : null}
            {isReady ? (
              <Pressable
                style={[styles.btn, styles.btnWhatsApp, styles.grow, busy === "whatsapp" && styles.btnBusy]}
                onPress={() => void sendWhatsApp("ready")}
                disabled={!!busy}
              >
                <Text style={styles.btnReadyText}>
                  {busy === "whatsapp" ? "…" : "Ready for pickup"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Read-only evidence thumbnails — capture lives in the arrival wizard. */}
      <EvidenceStrip jobKey={String(job.token)} />

      <View style={styles.card}>
        <Text style={styles.label}>TIMELINE</Text>
        {job.events.length === 0 ? (
          <Text style={styles.sub}>No activity yet.</Text>
        ) : (
          [...job.events].reverse().map((e) => (
            <View key={e.id} style={styles.event}>
              <Text style={styles.eventText}>{e.text}</Text>
              <Text style={styles.eventTime}>{e.created_at.slice(0, 10)}</Text>
            </View>
          ))
        )}
      </View>

      {/* Customer-unreachable sheet: hold / reschedule / haul-to-workshop. */}
      <Modal
        visible={unreachableOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setUnreachableOpen(false)}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setUnreachableOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Customer unreachable</Text>
            <Text style={styles.sheetSub}>
              Not home or not answering — keep the job honest without abandoning it.
            </Text>

            <Text style={styles.sheetSectionLabel}>PUT ON HOLD</Text>
            <TextInput
              style={styles.input}
              value={holdReason}
              onChangeText={setHoldReason}
              placeholder="Why is it on hold? (required)"
              editable={busy !== "transition"}
            />
            <Pressable
              style={[
                styles.btn,
                styles.btnDark,
                (busy === "transition" || !holdReason.trim()) && styles.btnBusy,
              ]}
              onPress={() => void queueTransition("wait", { reason: holdReason.trim() })}
              disabled={busy === "transition" || !holdReason.trim()}
            >
              <Text style={styles.btnDarkText}>
                {busy === "transition" ? "…" : "Put on hold"}
              </Text>
            </Pressable>

            <View style={styles.sheetDivider} />
            <Pressable
              style={[styles.btn, styles.btnOutline]}
              onPress={() => setScheduleOpen(true)}
              disabled={busy === "transition"}
            >
              <Text style={styles.btnOutlineText}>Reschedule the visit…</Text>
            </Pressable>

            <View style={styles.sheetDivider} />
            <Pressable
              style={[styles.btn, styles.btnOutline]}
              disabled={busy === "transition"}
              onPress={() =>
                Alert.alert(
                  "Convert to carry-in?",
                  "The customer will bring the unit to the workshop. This drops the visit — the travel flow disappears.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Convert", onPress: () => void queueTransition("haul") },
                  ],
                )
              }
            >
              <Text style={styles.btnOutlineText}>Convert to carry-in (haul to shop)</Text>
            </Pressable>

            <Pressable style={styles.sheetCancel} onPress={() => setUnreachableOpen(false)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <SchedulePickerModal
        visible={scheduleOpen}
        title="Reschedule visit"
        onClose={() => setScheduleOpen(false)}
        onConfirm={(preferredDateISO, windowLabel) => {
          setScheduleOpen(false);
          void queueTransition("reschedule", {
            preferred_date: preferredDateISO,
            time_window: windowLabel,
          });
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc" },
  error: { color: "#b91c1c", fontSize: 14, fontWeight: "600" },
  inlineError: { color: "#b91c1c", fontSize: 13, fontWeight: "600", marginTop: 8 },
  inlineInfo: { color: "#b45309", fontSize: 13, fontWeight: "600", marginTop: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerChips: { flexDirection: "row", alignItems: "center", gap: 6 },
  token: { fontSize: 24, fontWeight: "800", color: "#0f172a" },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  typeChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  typeChipText: { fontSize: 12, fontWeight: "800", color: "#475569" },
  appliance: { fontSize: 13, fontWeight: "600", color: "#64748b", marginTop: 2, marginBottom: 12 },
  card: {
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginBottom: 12,
  },
  label: { fontSize: 11, fontWeight: "800", color: "#94a3b8", letterSpacing: 0.5, marginBottom: 4 },
  value: { fontSize: 15, fontWeight: "600", color: "#1e293b" },
  sub: { fontSize: 13, color: "#64748b", marginTop: 2 },
  billGrid: { flexDirection: "row", gap: 8, marginTop: 8 },
  billBox: { flex: 1, backgroundColor: "#f8fafc", borderRadius: 8, padding: 10 },
  billBoxLabel: { fontSize: 10, fontWeight: "800", color: "#94a3b8", letterSpacing: 0.5 },
  billBoxValue: { fontSize: 16, fontWeight: "800", color: "#0f172a", marginTop: 2 },
  billBtn: {
    marginTop: 12,
    backgroundColor: "#0f172a",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  input: {
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
    marginTop: 6,
    marginBottom: 8,
  },
  inlineInput: { marginTop: 0, marginBottom: 0 },
  btn: { borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  btnBusy: { opacity: 0.5 },
  grow: { flex: 1 },
  btnDark: { backgroundColor: "#0f172a" },
  btnDarkText: { color: "white", fontWeight: "800", fontSize: 14 },
  btnDanger: { backgroundColor: "#b91c1c" },
  statusRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  btnReady: { backgroundColor: "#059669" },
  btnReadyText: { color: "white", fontWeight: "800", fontSize: 14 },
  btnOutline: { backgroundColor: "white", borderWidth: 1, borderColor: "#cbd5e1" },
  btnOutlineText: { color: "#475569", fontWeight: "800", fontSize: 14 },
  payRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  payAmt: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  voided: { textDecorationLine: "line-through", color: "#94a3b8" },
  correctText: { color: "#b91c1c", fontWeight: "800", fontSize: 13 },
  voidBox: { marginTop: 10, backgroundColor: "#fef2f2", borderRadius: 8, padding: 10 },
  abandonLink: { marginTop: 10, alignItems: "center", paddingVertical: 6 },
  abandonLinkText: { color: "#b91c1c", fontWeight: "700", fontSize: 13 },
  unreachableLink: { marginTop: 4, alignItems: "center", paddingVertical: 6 },
  unreachableLinkText: { color: "#b45309", fontWeight: "700", fontSize: 13 },
  sheetOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: "white",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    gap: 8,
  },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: "#0f172a" },
  sheetSub: { fontSize: 13, color: "#64748b", marginBottom: 6 },
  sheetSectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  sheetDivider: { height: 1, backgroundColor: "#f1f5f9", marginVertical: 6 },
  sheetCancel: { alignItems: "center", paddingVertical: 10, marginTop: 4 },
  sheetCancelText: { color: "#64748b", fontWeight: "700", fontSize: 14 },
  offlineBanner: {
    backgroundColor: "#fef3c7",
    borderColor: "#fde68a",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  offlineText: { color: "#92400e", fontSize: 12, fontWeight: "700" },
  event: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  eventText: { fontSize: 13, color: "#334155" },
  eventTime: { fontSize: 11, color: "#94a3b8", marginTop: 1 },
  pendingNote: { fontSize: 12, fontWeight: "700", color: "#b45309", marginTop: 6 },
  pendingBadge: { fontSize: 11, fontWeight: "700", color: "#b45309", marginTop: 1 },
  failedCard: { borderColor: "#fecaca", backgroundColor: "#fef2f2" },
  failedLabel: { color: "#b91c1c" },
  failedReason: { fontSize: 11, color: "#b91c1c", marginTop: 1 },
  failedAction: { paddingHorizontal: 8, paddingVertical: 4 },
  retryText: { color: "#1d4ed8", fontWeight: "800", fontSize: 13 },
  travelBtn: {
    marginTop: 12,
    backgroundColor: "#0f172a",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  travelBtnText: { color: "white", fontSize: 16, fontWeight: "800", letterSpacing: 0.5 },
  travelAgainLink: { marginTop: 8, alignItems: "center", paddingVertical: 6 },
  travelAgainText: { color: "#475569", fontWeight: "700", fontSize: 13 },
  wizardBtn: {
    marginTop: 12,
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  btnWhatsApp: { backgroundColor: "#16a34a" },
});
