/**
 * A shared date + time-window picker bottom sheet. Used by intake (step 3) and
 * the customer-unreachable reschedule flow. It emits BOTH a real ISO date
 * (yyyy-mm-dd — what the transition endpoint's preferred_date needs) and a
 * human window label (what the free-text time_window shows), so each caller
 * takes what it needs.
 */
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, Platform } from 'react-native';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const TIME_SLOTS = ['Morning (9a - 12p)', 'Afternoon (1p - 5p)', 'Evening (5p - 8p)'];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** preferredDateISO is yyyy-mm-dd; windowLabel is e.g. "July 15 · Morning". */
  onConfirm: (preferredDateISO: string, windowLabel: string) => void;
  title?: string;
}

export function SchedulePickerModal({ visible, onClose, onConfirm, title = 'Schedule' }: Props) {
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-based
  const currentMonth = MONTHS[month];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const blanks = Array.from({ length: firstDayOfMonth }, (_, i) => i);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const confirm = () => {
    if (!selectedDate || !selectedTimeSlot) return;
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDate).padStart(2, '0')}`;
    const label = `${currentMonth} ${selectedDate} · ${selectedTimeSlot.split(' ')[0]}`;
    onConfirm(iso, label);
    setSelectedDate(null);
    setSelectedTimeSlot(null);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />

        <View style={styles.bottomSheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.sheetClose}>Close</Text>
            </Pressable>
          </View>

          <Text style={styles.monthTitle}>{currentMonth} {year}</Text>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((day) => (
              <Text key={day} style={styles.weekDayText}>{day}</Text>
            ))}
          </View>

          <View style={styles.daysGrid}>
            {blanks.map((b) => <View key={`blank-${b}`} style={styles.dayBox} />)}
            {days.map((day) => (
              <Pressable
                key={`day-${day}`}
                style={[styles.dayBox, selectedDate === day && styles.dayBoxActive]}
                onPress={() => setSelectedDate(day)}
              >
                <Text style={[styles.dayText, selectedDate === day && styles.dayTextActive]}>{day}</Text>
              </Pressable>
            ))}
          </View>

          {selectedDate && (
            <View style={styles.timeSlotsContainer}>
              <Text style={styles.timeTitle}>Available Times</Text>
              {TIME_SLOTS.map((slot) => (
                <Pressable
                  key={slot}
                  style={[styles.timeSlot, selectedTimeSlot === slot && styles.timeSlotActive]}
                  onPress={() => setSelectedTimeSlot(slot)}
                >
                  <Text style={[styles.timeSlotText, selectedTimeSlot === slot && styles.timeSlotTextActive]}>{slot}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Pressable
            style={[styles.confirmBtn, (!selectedDate || !selectedTimeSlot) && styles.confirmBtnDisabled]}
            disabled={!selectedDate || !selectedTimeSlot}
            onPress={confirm}
          >
            <Text style={styles.confirmBtnText}>Confirm</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  bottomSheet: { backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  sheetClose: { fontSize: 15, color: '#64748b', fontWeight: '600' },
  monthTitle: { fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 12, textAlign: 'center' },
  weekRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  weekDayText: { width: 40, textAlign: 'center', fontSize: 13, color: '#94a3b8', fontWeight: '600' },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' },
  dayBox: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 8, borderRadius: 20 },
  dayBoxActive: { backgroundColor: '#3b82f6' },
  dayText: { fontSize: 15, color: '#1e293b', fontWeight: '500' },
  dayTextActive: { color: '#ffffff', fontWeight: '800' },
  timeSlotsContainer: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 16 },
  timeTitle: { fontSize: 14, fontWeight: '700', color: '#64748b', marginBottom: 12 },
  timeSlot: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', marginBottom: 8 },
  timeSlotActive: { backgroundColor: '#f0fdf4', borderColor: '#22c55e' },
  timeSlotText: { fontSize: 14, color: '#334155', fontWeight: '500' },
  timeSlotTextActive: { color: '#15803d', fontWeight: '700' },
  confirmBtn: { backgroundColor: '#10b981', paddingVertical: 16, borderRadius: 20, alignItems: 'center', marginTop: 24 },
  confirmBtnDisabled: { backgroundColor: '#cbd5e1' },
  confirmBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});
