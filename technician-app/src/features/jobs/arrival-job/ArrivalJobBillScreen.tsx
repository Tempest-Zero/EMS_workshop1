/**
 * The bill sheet (F15). Line items come from the job's REAL completion
 * (materials sum, labour = mins × snapshotted rate, fuel + its 0035 basis),
 * totals from the server's bill fields. Negotiation and payments ride the
 * outbox (idempotent client_id — an offline retry never double-charges);
 * WhatsApp is the consent-gated preview → wa.me → send-log flow.
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Crypto from "expo-crypto";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, View, Pressable, SafeAreaView, ScrollView, Platform, TextInput, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ApiError } from "../../../lib/api";
import { jobsApi, type JobDetail } from "../../../lib/jobsApi";
import { loadJobDetail, saveJobDetail } from "../../../lib/jobsCache";
import { messagingApi } from "../../../lib/messagingApi";
import { formatPaisa, rupeesToPaisa } from "../../../lib/money";
import type { RootStackParamList } from "../../../lib/navigation";
import { makeItem } from "../../../lib/outbox";
import { sendOrQueue, type NegotiatePayload, type PaymentPayload } from "../../../lib/outboxSync";
import { useJobOutbox } from "../../../lib/useJobOutbox";
import { closeJobWithVideo } from "../closeJobWithVideo";
import { defaultPayRs, isNegotiateDirty } from "./billMath";

type Props = NativeStackScreenProps<RootStackParamList, "BillSheet">;

type PayChoice = 'cash' | 'transfer' | 'later';
const METHOD_FOR: Record<Exclude<PayChoice, 'later'>, "cash" | "online"> = {
  cash: "cash",
  transfer: "online",
};

export function ArrivalJobBillScreen({ route, navigation }: Props) {
  const { id, token } = route.params;

  const [job, setJob] = useState<JobDetail | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"negotiate" | "payment" | "whatsapp" | "close" | null>(null);

  const [negotiatedRs, setNegotiatedRs] = useState('');
  const [selectedDiscount, setSelectedDiscount] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PayChoice | null>(null);
  const [payRs, setPayRs] = useState('');

  const seededNegotiate = useRef(false);
  const lastBalance = useRef<number | null>(null);

  // Queued/failed outbox writes for THIS job — offline payments show as
  // "syncing" and back the double-charge warning (the server dedups a
  // *retried* tap, but only the UI can catch a doubting tech tapping twice).
  const outboxView = useJobOutbox(id);
  const pendingPayments = outboxView.queued.filter((i) => i.kind === "payment");
  const pendingPaisa = pendingPayments.reduce(
    (s, i) => s + (i.payload as PaymentPayload).amountPaisa,
    0,
  );
  // A negotiate queued offline is, per the outbox contract, already "saved" —
  // it flushes before any later payment (FIFO). Its amount counts as clean in
  // the dirty check below, so an offline tech isn't re-asked to save the same
  // discount forever.
  const pendingNegotiatePaisa =
    (outboxView.queued.find((i) => i.kind === "negotiate")?.payload as NegotiatePayload | undefined)
      ?.amountPaisa ?? null;

  const load = useCallback(async () => {
    try {
      const fresh = await jobsApi.get(id);
      setJob(fresh);
      setStale(false);
      void saveJobDetail(fresh);
    } catch {
      const cached = await loadJobDetail(id);
      if (cached) {
        setJob(cached.data);
        setStale(true);
      } else {
        setError("Couldn't load the bill — check your connection.");
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Seed the negotiated input from server truth exactly once (not on every
  // reload) — it's the technician's scratchpad while they haggle.
  useEffect(() => {
    if (!job || seededNegotiate.current) return;
    seededNegotiate.current = true;
    const current = job.bill_negotiated_paisa ?? job.bill_original_paisa;
    if (current != null) setNegotiatedRs(String(Math.round(current / 100)));
  }, [job]);

  // The payment input FOLLOWS the balance: every reconciled row (initial load,
  // negotiate save, payment, close, WhatsApp log) recomputes the suggested
  // amount. Seeding it once was the reported money bug — after "Save
  // negotiated" the input kept the pre-discount figure, and that's what the
  // payment logged.
  useEffect(() => {
    if (!job || job.balance_paisa === lastBalance.current) return;
    lastBalance.current = job.balance_paisa;
    setPayRs(defaultPayRs(job.balance_paisa));
  }, [job]);

  if (error && !job) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }
  if (!job) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  const completion = job.completion;
  const materialsPaisa = (completion?.materials ?? []).reduce(
    (s, m) => s + m.qty * m.unit_paisa,
    0,
  );
  const labourPaisa = completion
    ? Math.round((completion.time_spent_mins * completion.labour_rate_paisa) / 60)
    : 0;
  const fuelPaisa = completion?.fuel_paisa ?? 0;
  const fuelAuto =
    completion?.fuel_basis === 'estimate' || completion?.fuel_basis === 'breadcrumbs';
  const fuelChip = fuelAuto
    ? completion?.fuel_distance_m != null
      ? `auto · ${(completion.fuel_distance_m / 1000).toFixed(1)} km round trip`
      : 'auto'
    : null;

  // A visit/pickup whose auto fuel resolved to a near-zero route almost always
  // means a missed depart punch (both ends punched on arrival). Surface it so
  // the tech can enter the fuel by hand instead of billing ~Rs 0.
  const isVisit = job.job_type !== 'carry-in';
  const fuelSuspect = isVisit && fuelAuto && (completion?.fuel_distance_m ?? 0) < 1000;

  const originalPaisa = job.bill_original_paisa ?? materialsPaisa + labourPaisa + fuelPaisa;
  const negotiatedPaisa = rupeesToPaisa(negotiatedRs);
  const negotiateDirty =
    isNegotiateDirty(negotiatedPaisa, job.bill_negotiated_paisa, originalPaisa) &&
    negotiatedPaisa !== pendingNegotiatePaisa;

  const applyDiscount = (label: string, amountPaisa: number) => {
    setSelectedDiscount(label);
    setNegotiatedRs(String(Math.max(0, Math.round((originalPaisa - amountPaisa) / 100))));
  };

  /**
   * Persist the negotiated amount through the outbox. Stable id → a repeat is
   * last-write-wins, never a duplicate. Owns no UI state beyond reconciling
   * the returned row; callers layer busy/info/error on the three outcomes.
   */
  const persistNegotiated = async (): Promise<"saved" | "queued" | "failed"> => {
    try {
      const detail = await sendOrQueue(
        makeItem({
          id: `negotiate:${id}`,
          kind: "negotiate",
          jobId: id,
          payload: { amountPaisa: negotiatedPaisa, note: selectedDiscount ?? undefined },
        }),
        () => jobsApi.negotiateBill(id, negotiatedPaisa, selectedDiscount ?? undefined),
      );
      if (detail) {
        setJob(detail); // the balance follower refreshes the suggested payment
        return "saved";
      }
      return "queued";
    } catch {
      return "failed";
    }
  };

  const saveNegotiated = async () => {
    if (!negotiateDirty || busy) return;
    setBusy("negotiate");
    setError(null);
    setInfo(null);
    const result = await persistNegotiated();
    if (result === "queued") setInfo("Negotiated amount saved offline — syncing when reconnected.");
    else if (result === "failed") setError("Couldn't save the negotiated amount — try again.");
    setBusy(null);
  };

  const logPayment = async () => {
    const paisa = rupeesToPaisa(payRs);
    if (!paymentMethod || paymentMethod === 'later' || paisa <= 0 || busy) return;
    // A discount the tech never saved is the second half of the reported bug —
    // auto-save it FIRST (a payment outbox item must never be created before
    // its negotiate item), then STOP: the save just changed the suggested
    // amount under their thumb, so they confirm it before logging.
    if (negotiateDirty) {
      setBusy("payment");
      setError(null);
      setInfo(null);
      const r = await persistNegotiated();
      setBusy(null);
      if (r === "failed") {
        setError("Couldn't save the discount — try again before logging the payment.");
        return;
      }
      if (r === "queued") {
        // Offline: no reconciled row is coming, so derive the new balance —
        // the negotiated total minus what's already been received.
        setPayRs(defaultPayRs(negotiatedPaisa - job.received_paisa));
      }
      setInfo("Discount saved — confirm the updated amount, then tap Log payment.");
      return;
    }
    // Double-charge guard: warn when the same amount is already waiting to
    // sync on this job — each tap mints a fresh client_id, so the server
    // can't tell a deliberate second payment from a doubting re-tap.
    const duplicate = pendingPayments.some(
      (i) => (i.payload as PaymentPayload).amountPaisa === paisa,
    );
    if (duplicate) {
      Alert.alert(
        "Possible duplicate",
        `A payment of ${formatPaisa(paisa)} is already waiting to sync on this job. Log another one?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Log anyway", style: "destructive", onPress: () => void submitPayment(paisa) },
        ],
      );
      return;
    }
    await submitPayment(paisa);
  };

  const submitPayment = async (paisa: number) => {
    if (!paymentMethod || paymentMethod === 'later') return;
    setBusy("payment");
    setError(null);
    setInfo(null);
    try {
      const clientId = Crypto.randomUUID();
      const detail = await sendOrQueue(
        makeItem({
          id: clientId,
          kind: "payment",
          jobId: id,
          payload: { amountPaisa: paisa, method: METHOD_FOR[paymentMethod], clientId },
        }),
        () => jobsApi.logPayment(id, paisa, METHOD_FOR[paymentMethod], clientId),
      );
      if (detail) {
        setJob(detail); // the balance follower refreshes the suggested amount
      } else {
        setInfo("Payment saved offline — syncing when reconnected.");
      }
    } catch {
      setError("Couldn't log the payment — try again.");
    } finally {
      setBusy(null);
    }
  };

  // F16 — close the loop from the bill: closing video (server-gated), then
  // land back on the jobs list with the closed job on the history roster.
  const closeJob = async () => {
    if (busy) return;
    setBusy("close");
    setError(null);
    setInfo(null);
    try {
      // An unsaved discount must land before the close. "queued" may proceed —
      // close carries no amount, and the queued negotiate flushes first (FIFO).
      if (negotiateDirty) {
        const r = await persistNegotiated();
        if (r === "failed") {
          setError("Couldn't save the discount — try again before closing the job.");
          return;
        }
      }
      const result = await closeJobWithVideo(id, token);
      if (result.kind === "closed") {
        setJob(result.job);
        Alert.alert(
          "Job closed ✓",
          "Handover video attached — the job moves to your completed roster.",
          [
            {
              text: "OK",
              onPress: () => navigation.navigate("My Jobs", { screen: "CompletedTasks" }),
            },
          ],
        );
      } else if (result.kind !== "canceled") {
        setError(result.message);
      }
    } finally {
      setBusy(null);
    }
  };

  const sendWhatsApp = async () => {
    if (busy) return;
    setBusy("whatsapp");
    setError(null);
    setInfo(null);
    try {
      // The bill message renders server truth — an unsaved discount would send
      // the OLD amount. Persist first; offline can't proceed (the preview is a
      // live call, and the message must show the discounted figure).
      if (negotiateDirty) {
        const r = await persistNegotiated();
        if (r === "queued") {
          setError(
            "Discount saved offline — reconnect before sending the bill so WhatsApp shows the discounted amount.",
          );
          return;
        }
        if (r === "failed") {
          setError("Couldn't save the discount — try again before sending the bill.");
          return;
        }
      }
      const preview = await messagingApi.preview(id, "bill");
      if (!preview.consent) {
        setError("No WhatsApp consent on record for this customer.");
        return;
      }
      if (!preview.wa_me_url) {
        setError("No WhatsApp-capable phone number on this job.");
        return;
      }
      await Linking.openURL(preview.wa_me_url);
      setJob(await messagingApi.logSend(id, "bill"));
      Alert.alert("Sent", "The bill message was opened in WhatsApp and logged on the timeline.", [
        { text: "OK", onPress: () => navigation.popToTop() },
      ]);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(/"detail"\s*:\s*"([^"]+)"/.exec(e.message)?.[1] ?? "Couldn't prepare the message.");
      } else {
        setError("Couldn't open WhatsApp — check your connection and try again.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* 🧑‍🔧 HEADER */}
          <View style={styles.topHeader}>
            <View>
              <Text style={styles.techName}>{job.customer_name}</Text>
              <View style={styles.badgeRow}>
                <View style={styles.badgeLight}>
                  <Text style={styles.badgeLightText}>
                    {job.appliance_type}
                    {job.appliance_brand ? ` · ${job.appliance_brand}` : ''}
                  </Text>
                </View>
                <View style={styles.badgeDark}>
                  <Text style={styles.badgeDarkText}>
                    {job.status === 'closed' ? 'closed ✓' : completion ? 'work complete' : job.status}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {stale ? (
            <View style={styles.staleBanner}>
              <Text style={styles.staleText}>Offline — showing the last synced bill.</Text>
            </View>
          ) : null}

          {/* 🧾 BILL SHEET TITLE */}
          <View style={styles.billHeader}>
            <Text style={styles.billTitle}>Bill · job #{token}</Text>
            <Text style={styles.autoBuiltText}>{completion ? 'auto-built' : 'no completion yet'}</Text>
          </View>

          {/* 📊 LINE ITEMS */}
          <View style={styles.lineItemsContainer}>
            <View style={styles.lineItem}>
              <View style={styles.lineItemLeft}>
                <Text style={styles.lineItemLabel}>Labour</Text>
                {completion ? (
                  <View style={styles.tbdBadge}>
                    <Text style={styles.tbdText}>{completion.time_spent_mins} min</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.lineItemValue}>{formatPaisa(labourPaisa)}</Text>
            </View>

            <View style={styles.lineItem}>
              <Text style={styles.lineItemLabel}>
                Materials{completion ? ` (${completion.materials.length})` : ''}
              </Text>
              <Text style={styles.lineItemValue}>{formatPaisa(materialsPaisa)}</Text>
            </View>

            <View style={styles.lineItem}>
              <View style={styles.lineItemLeft}>
                <Text style={styles.lineItemLabel}>Fuel</Text>
                {fuelChip ? (
                  <View style={styles.p2Badge}>
                    <Text style={styles.p2Text}>{fuelChip}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.lineItemValue}>{formatPaisa(fuelPaisa)}</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.lineItem}>
              <Text style={styles.originalTotalLabel}>Original</Text>
              <Text style={styles.originalTotalValue}>{formatPaisa(originalPaisa)}</Text>
            </View>
            <View style={styles.lineItem}>
              <Text style={styles.lineItemLabel}>Received</Text>
              <Text style={styles.lineItemValue}>
                {formatPaisa(job.received_paisa + pendingPaisa)}
              </Text>
            </View>
            <View style={styles.lineItem}>
              <Text style={styles.originalTotalLabel}>Balance</Text>
              <Text style={styles.originalTotalValue}>
                {formatPaisa(job.balance_paisa - pendingPaisa)}
              </Text>
            </View>
            {pendingPaisa > 0 ? (
              <Text style={styles.pendingNote}>
                Includes {formatPaisa(pendingPaisa)} still syncing.
              </Text>
            ) : null}
          </View>

          {fuelSuspect ? (
            <Pressable
              style={styles.fuelWarn}
              onPress={() =>
                navigation.navigate('My Jobs', { screen: 'CompleteJob', params: { id, token } })
              }
            >
              <Text style={styles.fuelWarnText}>
                ⚠ Route looks wrong ({((completion?.fuel_distance_m ?? 0) / 1000).toFixed(1)} km) —
                tap to fix the fuel
              </Text>
            </Pressable>
          ) : null}

          {job.status === 'closed' ? (
            <View style={styles.closedBanner}>
              <Ionicons name="checkmark-circle" size={20} color="#166534" />
              <Text style={styles.closedBannerText}>
                Closed — proof video attached. The ledger above is final.
              </Text>
            </View>
          ) : null}

          {job.status !== 'closed' ? (<>
          {/* 🤝 NEGOTIATION */}
          <View style={styles.negotiationContainer}>
            <Text style={styles.inputLabel}>Negotiated</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.currencyPrefix}>Rs</Text>
              <TextInput
                style={styles.priceInput}
                keyboardType="numeric"
                value={negotiatedRs}
                onChangeText={(val) => {
                  setNegotiatedRs(val);
                  setSelectedDiscount(null);
                }}
              />
            </View>
          </View>

          {/* 🏷️ DISCOUNT CHIPS */}
          <View style={styles.discountRow}>
            <Pressable
              style={[styles.discountChip, selectedDiscount === 'loyal customer' && styles.discountChipActive]}
              onPress={() => applyDiscount('loyal customer', 25_000)}
            >
              <Text style={[styles.discountText, selectedDiscount === 'loyal customer' && styles.discountTextActive]}>
                {selectedDiscount === 'loyal customer' ? '− Rs250 · loyal' : 'Loyal'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.discountChip, selectedDiscount === 'matched quote' && styles.discountChipActive]}
              onPress={() => applyDiscount('matched quote', 50_000)}
            >
              <Text style={[styles.discountText, selectedDiscount === 'matched quote' && styles.discountTextActive]}>
                {selectedDiscount === 'matched quote' ? '− Rs500 · quote' : 'Quote'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.discountChip, selectedDiscount === 'goodwill' && styles.discountChipActive]}
              onPress={() => applyDiscount('goodwill', 100_000)}
            >
              <Text style={[styles.discountText, selectedDiscount === 'goodwill' && styles.discountTextActive]}>
                {selectedDiscount === 'goodwill' ? '− Rs1,000 · goodwill' : 'Goodwill'}
              </Text>
            </Pressable>
          </View>

          {negotiateDirty ? (
            <Pressable
              style={[styles.saveNegotiateBtn, busy === 'negotiate' && styles.btnBusy]}
              onPress={() => void saveNegotiated()}
              disabled={!!busy}
            >
              <Text style={styles.saveNegotiateText}>
                {busy === 'negotiate' ? 'Saving…' : `Save negotiated ${formatPaisa(negotiatedPaisa)}`}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.heavyDivider} />

          {/* 💳 PAYMENT */}
          <View style={styles.paymentMethodRow}>
            {(['cash', 'transfer', 'later'] as const).map((m) => (
              <Pressable
                key={m}
                style={[styles.payBtn, paymentMethod === m && styles.payBtnActive]}
                onPress={() => setPaymentMethod(m)}
              >
                <Text style={[styles.payBtnText, paymentMethod === m && styles.payBtnTextActive]}>
                  {m === 'cash' ? 'Cash' : m === 'transfer' ? 'Transfer' : 'Later / partial'}
                </Text>
              </Pressable>
            ))}
          </View>

          {paymentMethod && paymentMethod !== 'later' ? (
            <View style={styles.payRow}>
              <View style={[styles.inputWrapper, styles.payInputWrap]}>
                <Text style={styles.currencyPrefix}>Rs</Text>
                <TextInput
                  style={styles.priceInput}
                  keyboardType="numeric"
                  value={payRs}
                  onChangeText={setPayRs}
                  placeholder="amount"
                  placeholderTextColor="#94a3b8"
                />
              </View>
              <Pressable
                style={[styles.logPayBtn, (busy === 'payment' || rupeesToPaisa(payRs) <= 0) && styles.btnBusy]}
                onPress={() => void logPayment()}
                disabled={busy === 'payment' || rupeesToPaisa(payRs) <= 0}
              >
                <Text style={styles.logPayText}>{busy === 'payment' ? '…' : 'Log payment'}</Text>
              </Pressable>
            </View>
          ) : null}
          {paymentMethod === 'later' ? (
            <Text style={styles.laterNote}>
              No payment now — the balance stays open on the job.
            </Text>
          ) : null}

          {/* ✅ CLOSE THE LOOP (F16) — only once the completion exists; the
              server enforces the closing-video gate either way. */}
          {completion ? (
            <>
              <View style={styles.heavyDivider} />
              <Pressable
                style={[styles.closeBtn, busy === 'close' && styles.btnBusy]}
                disabled={!!busy}
                onPress={() => void closeJob()}
              >
                <Ionicons name="videocam" size={18} color="white" style={{ marginRight: 8 }} />
                <Text style={styles.closeBtnText}>
                  {busy === 'close' ? 'Closing…' : 'Close job — record handover video'}
                </Text>
              </Pressable>
              <Text style={styles.closeHint}>
                The proof clip is required to close; a balance can stay open.
              </Text>
            </>
          ) : null}
          </>) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {info ? <Text style={styles.infoText}>{info}</Text> : null}

        </ScrollView>

        {/* 🚀 STICKY FOOTER */}
        <View style={styles.stickyFooter}>
          <Pressable
            style={[styles.whatsappBtn, busy === 'whatsapp' && styles.whatsappBtnDisabled]}
            disabled={!!busy}
            onPress={() => void sendWhatsApp()}
          >
            <Ionicons name="logo-whatsapp" size={20} color="white" style={{ marginRight: 8 }} />
            <Text style={styles.whatsappBtnText}>
              {busy === 'whatsapp' ? 'Preparing…' : 'Send on WhatsApp'}
            </Text>
          </Pressable>
          <Pressable style={styles.doneLink} onPress={() => navigation.popToTop()}>
            <Text style={styles.doneLinkText}>Done — back to dashboard</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  center: { alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 40 : 20, paddingBottom: 40 },

  // Header
  topHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  techName: { fontSize: 24, fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  badgeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  badgeLight: { backgroundColor: '#f1f5f9', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8 },
  badgeLightText: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  badgeDark: { backgroundColor: '#94a3b8', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8 },
  badgeDarkText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },

  staleBanner: { backgroundColor: '#fef3c7', borderColor: '#fde68a', borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 16 },
  staleText: { color: '#92400e', fontSize: 12, fontWeight: '700' },

  pendingNote: { fontSize: 12, fontWeight: '700', color: '#b45309', marginTop: 6 },
  closedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
  closedBannerText: { flex: 1, color: '#166534', fontSize: 13, fontWeight: '700' },
  closeBtn: { flexDirection: 'row', backgroundColor: '#0f172a', paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  closeBtnText: { color: 'white', fontSize: 15, fontWeight: '800' },
  closeHint: { fontSize: 12, color: '#94a3b8', fontWeight: '500', textAlign: 'center', marginTop: 8 },
  fuelWarn: { backgroundColor: '#fef3c7', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 16 },
  fuelWarnText: { color: '#92400e', fontSize: 13, fontWeight: '700' },

  // Bill Title
  billHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 },
  billTitle: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  autoBuiltText: { fontSize: 14, color: '#94a3b8', fontWeight: '500' },

  // Line Items
  lineItemsContainer: { marginBottom: 24 },
  lineItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  lineItemLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  lineItemLabel: { fontSize: 16, color: '#475569', fontWeight: '600' },
  lineItemValue: { fontSize: 16, color: '#0f172a', fontWeight: '500', fontVariant: ['tabular-nums'] },

  tbdBadge: { backgroundColor: '#e0e7ff', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginLeft: 8 },
  tbdText: { fontSize: 10, fontWeight: '800', color: '#3730a3' },
  p2Badge: { backgroundColor: '#bfdbfe', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginLeft: 6 },
  p2Text: { fontSize: 10, fontWeight: '800', color: '#1e3a8a' },

  divider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 12 },

  originalTotalLabel: { fontSize: 16, color: '#0f172a', fontWeight: '800' },
  originalTotalValue: { fontSize: 16, color: '#0f172a', fontWeight: '800', fontVariant: ['tabular-nums'] },

  // Negotiation Input
  negotiationContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 16 },
  inputLabel: { fontSize: 16, color: '#475569', fontWeight: '600' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center' },
  currencyPrefix: { fontSize: 18, color: '#0f172a', fontWeight: '700', marginRight: 4 },
  priceInput: { fontSize: 18, color: '#0f172a', fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 80, textAlign: 'right', paddingVertical: 4 },

  // Discount Chips
  discountRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  discountChip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  discountChipActive: { backgroundColor: '#eff6ff', borderColor: '#3b82f6' },
  discountText: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  discountTextActive: { color: '#2563eb' },

  saveNegotiateBtn: { backgroundColor: '#0f172a', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 8 },
  saveNegotiateText: { color: 'white', fontSize: 15, fontWeight: '800' },
  btnBusy: { opacity: 0.5 },

  heavyDivider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 20 },

  // Payment Methods
  paymentMethodRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  payBtn: { flex: 1, paddingVertical: 12, borderRadius: 24, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center' },
  payBtnActive: { backgroundColor: '#1c1917', borderColor: '#1c1917' },
  payBtnText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  payBtnTextActive: { color: '#ffffff' },

  payRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 8 },
  payInputWrap: { flex: 1, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  logPayBtn: { backgroundColor: '#059669', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center' },
  logPayText: { color: 'white', fontWeight: '800', fontSize: 14 },
  laterNote: { fontSize: 13, color: '#64748b', fontStyle: 'italic', marginBottom: 8 },

  errorText: { color: '#b91c1c', fontSize: 13, fontWeight: '600', marginTop: 8 },
  infoText: { color: '#b45309', fontSize: 13, fontWeight: '600', marginTop: 8 },

  // Footer
  stickyFooter: { paddingVertical: 16, paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 32 : 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  whatsappBtn: { flexDirection: 'row', backgroundColor: '#25D366', paddingVertical: 18, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  whatsappBtnDisabled: { backgroundColor: '#86efac' },
  whatsappBtnText: { color: 'white', fontSize: 16, fontWeight: '800' },
  doneLink: { alignItems: 'center', marginTop: 12 },
  doneLinkText: { color: '#64748b', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
});
