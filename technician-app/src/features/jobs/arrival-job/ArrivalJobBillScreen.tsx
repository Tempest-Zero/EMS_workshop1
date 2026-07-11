/**
 * The bill sheet. STILL A MOCK in this stage: amounts are wireframe
 * placeholders — real bill lines from the job's completion, negotiate +
 * payments through the outbox, and the WhatsApp send land in the
 * bill-wiring stage.
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from 'react';
import { StyleSheet, Text, View, Pressable, SafeAreaView, ScrollView, Platform, TextInput, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { RootStackParamList } from "../../../lib/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "BillSheet">;

export function ArrivalJobBillScreen({ route, navigation }: Props) {
  // Wireframe placeholders — replaced by the job's real completion lines
  // in the bill-wiring stage.
  const billDetails = {
    jobId: String(route.params.token),
    labour: 1500,
    materials: 2850,
    fuel: 200,
  };
  const originalTotal = billDetails.labour + billDetails.materials + billDetails.fuel;

  const [negotiatedTotal, setNegotiatedTotal] = useState(originalTotal.toString());
  const [selectedDiscount, setSelectedDiscount] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'later' | null>(null);

  // Helper to apply quick discounts
  const applyDiscount = (type: string, amount: number) => {
    setSelectedDiscount(type);
    setNegotiatedTotal((originalTotal - amount).toString());
  };

  const isReadyToSend = paymentMethod !== null && negotiatedTotal !== '';

  const handleSendWhatsApp = () => {
    // This is where you'd trigger the WhatsApp Deep Link API
    console.log(`Sending bill for Rs${negotiatedTotal} via WhatsApp`);
    // After sending, return to the Dashboard Hub!
    navigation.popToTop(); 
  };

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1 }} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          {/* 🧑‍🔧 TECHNICIAN HEADER */}
          <View style={styles.topHeader}>
            <View>
              <Text style={styles.techName}>Bilal A.</Text>
              <View style={styles.badgeRow}>
                <View style={styles.badgeLight}><Text style={styles.badgeLightText}>Fridge FRG-8817</Text></View>
                <View style={styles.badgeDark}><Text style={styles.badgeDarkText}>work complete</Text></View>
              </View>
            </View>
            <View style={styles.timeBadge}>
              <Ionicons name="time-outline" size={14} color="#64748b" style={{ marginRight: 4 }} />
              <Text style={styles.timeBadgeText}>1:42</Text>
            </View>
          </View>

          {/* 🧾 BILL SHEET TITLE */}
          <View style={styles.billHeader}>
            <Text style={styles.billTitle}>Bill · job #{billDetails.jobId}</Text>
            <Text style={styles.autoBuiltText}>auto-built</Text>
          </View>

          {/* 📊 LINE ITEMS */}
          <View style={styles.lineItemsContainer}>
            <View style={styles.lineItem}>
              <View style={styles.lineItemLeft}>
                <Text style={styles.lineItemLabel}>Labour</Text>
                <View style={styles.tbdBadge}><Text style={styles.tbdText}>TBD</Text></View>
              </View>
              <Text style={styles.lineItemValue}>Rs{billDetails.labour.toLocaleString()}</Text>
            </View>
            
            <View style={styles.lineItem}>
              <Text style={styles.lineItemLabel}>Materials (picker)</Text>
              <Text style={styles.lineItemValue}>Rs{billDetails.materials.toLocaleString()}</Text>
            </View>

            <View style={styles.lineItem}>
              <View style={styles.lineItemLeft}>
                <Text style={styles.lineItemLabel}>Fuel (travel log</Text>
                <View style={styles.p2Badge}><Text style={styles.p2Text}>P2</Text></View>
                <Text style={styles.lineItemLabel}>)</Text>
              </View>
              <Text style={styles.lineItemValue}>Rs{billDetails.fuel.toLocaleString()}</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.lineItem}>
              <Text style={styles.originalTotalLabel}>Original</Text>
              <Text style={styles.originalTotalValue}>Rs{originalTotal.toLocaleString()}</Text>
            </View>
          </View>

          {/* 🤝 NEGOTIATION INPUT */}
          <View style={styles.negotiationContainer}>
            <Text style={styles.inputLabel}>Negotiated</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.currencyPrefix}>Rs</Text>
              <TextInput
                style={styles.priceInput}
                keyboardType="numeric"
                value={negotiatedTotal}
                onChangeText={(val) => {
                  setNegotiatedTotal(val);
                  setSelectedDiscount(null); // Clear active discount chip if they type manually
                }}
              />
            </View>
          </View>

          {/* 🏷️ DISCOUNT CHIPS */}
          <View style={styles.discountRow}>
            <Pressable 
              style={[styles.discountChip, selectedDiscount === 'Loyal' && styles.discountChipActive]}
              onPress={() => applyDiscount('Loyal', 250)}
            >
              <Text style={[styles.discountText, selectedDiscount === 'Loyal' && styles.discountTextActive]}>
                {selectedDiscount === 'Loyal' ? '− Rs250 discount' : 'Loyal'}
              </Text>
            </Pressable>
            <Pressable style={styles.discountChip}><Text style={styles.discountText}>quote</Text></Pressable>
            <Pressable style={styles.discountChip}><Text style={styles.discountText}>goodwill</Text></Pressable>
          </View>

          <View style={styles.heavyDivider} />

          {/* 💳 PAYMENT METHOD */}
          <View style={styles.paymentMethodRow}>
            <Pressable 
              style={[styles.payBtn, paymentMethod === 'cash' && styles.payBtnActive]} 
              onPress={() => setPaymentMethod('cash')}
            >
              <Text style={[styles.payBtnText, paymentMethod === 'cash' && styles.payBtnTextActive]}>Cash</Text>
            </Pressable>
            <Pressable 
              style={[styles.payBtn, paymentMethod === 'transfer' && styles.payBtnActive]} 
              onPress={() => setPaymentMethod('transfer')}
            >
              <Text style={[styles.payBtnText, paymentMethod === 'transfer' && styles.payBtnTextActive]}>Transfer</Text>
            </Pressable>
            <Pressable 
              style={[styles.payBtn, paymentMethod === 'later' && styles.payBtnActive]} 
              onPress={() => setPaymentMethod('later')}
            >
              <Text style={[styles.payBtnText, paymentMethod === 'later' && styles.payBtnTextActive]}>Later / partial</Text>
            </Pressable>
          </View>

          {/* 📎 EVIDENCE THUMBNAILS MOCK */}
          <View style={styles.evidenceRow}>
            <View style={styles.evidenceThumb} />
            <View style={styles.evidenceThumb} />
            <View style={styles.evidenceThumb} />
            <Text style={styles.evidenceText}>evidence attached</Text>
          </View>

        </ScrollView>

        {/* 🚀 STICKY FOOTER NAVIGATION */}
        <View style={styles.stickyFooter}>
          <Pressable 
            style={[styles.whatsappBtn, !isReadyToSend && styles.whatsappBtnDisabled]}
            disabled={!isReadyToSend}
            onPress={handleSendWhatsApp}
          >
            <Ionicons name="logo-whatsapp" size={20} color="white" style={{ marginRight: 8 }} />
            <Text style={styles.whatsappBtnText}>Send on WhatsApp</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scrollContent: { paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 40 : 20, paddingBottom: 40 },
  
  // Header
  topHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 },
  techName: { fontSize: 24, fontWeight: '800', color: '#0f172a', fontStyle: 'italic', marginBottom: 8 },
  badgeRow: { flexDirection: 'row', gap: 8 },
  badgeLight: { backgroundColor: '#f1f5f9', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8 },
  badgeLightText: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  badgeDark: { backgroundColor: '#94a3b8', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8 },
  badgeDarkText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  timeBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  timeBadgeText: { color: '#64748b', fontWeight: '700', fontSize: 13 },

  // Bill Title
  billHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 },
  billTitle: { fontSize: 22, fontWeight: '800', fontStyle: 'italic', color: '#0f172a' },
  autoBuiltText: { fontSize: 14, color: '#94a3b8', fontWeight: '500' },

  // Line Items
  lineItemsContainer: { marginBottom: 24 },
  lineItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  lineItemLeft: { flexDirection: 'row', alignItems: 'center' },
  lineItemLabel: { fontSize: 16, color: '#475569', fontWeight: '600' },
  lineItemValue: { fontSize: 16, color: '#0f172a', fontWeight: '500', fontVariant: ['tabular-nums'] },
  
  tbdBadge: { backgroundColor: '#fef08a', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginLeft: 8 },
  tbdText: { fontSize: 10, fontWeight: '800', color: '#854d0e' },
  p2Badge: { backgroundColor: '#bfdbfe', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginLeft: 6, marginRight: 2 },
  p2Text: { fontSize: 10, fontWeight: '800', color: '#1e3a8a' },

  divider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 12 },
  
  originalTotalLabel: { fontSize: 16, color: '#0f172a', fontWeight: '800' },
  originalTotalValue: { fontSize: 16, color: '#0f172a', fontWeight: '800', fontVariant: ['tabular-nums'] },

  // Negotiation Input
  negotiationContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 16 },
  inputLabel: { fontSize: 16, color: '#475569', fontWeight: '600' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center' },
  currencyPrefix: { fontSize: 18, color: '#0f172a', fontWeight: '700', marginRight: 4 },
  priceInput: { fontSize: 18, color: '#0f172a', fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 60, textAlign: 'right' },

  // Discount Chips
  discountRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  discountChip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  discountChipActive: { backgroundColor: '#eff6ff', borderColor: '#3b82f6' },
  discountText: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  discountTextActive: { color: '#2563eb' },

  heavyDivider: { height: 1, backgroundColor: '#f1f5f9', marginBottom: 24 },

  // Payment Methods
  paymentMethodRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  payBtn: { flex: 1, paddingVertical: 12, borderRadius: 24, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center' },
  payBtnActive: { backgroundColor: '#1c1917', borderColor: '#1c1917' },
  payBtnText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  payBtnTextActive: { color: '#ffffff' },

  // Evidence Mocks
  evidenceRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  evidenceThumb: { width: 40, height: 40, backgroundColor: '#e2e8f0', borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: '#cbd5e1' },
  evidenceText: { fontSize: 14, color: '#94a3b8', fontWeight: '500', fontStyle: 'italic', marginLeft: 4 },

  // Footer
  stickyFooter: { paddingVertical: 16, paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 32 : 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  whatsappBtn: { flexDirection: 'row', backgroundColor: '#25D366', paddingVertical: 18, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  whatsappBtnDisabled: { backgroundColor: '#86efac' },
  whatsappBtnText: { color: 'white', fontSize: 16, fontWeight: '800' },
});