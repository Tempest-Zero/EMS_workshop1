import React, { useState } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform, Modal } from 'react-native';

interface Step3Props {
  /** The customer address — held by the wizard so submit can send it. */
  location: string;
  setLocation: (val: string) => void;
  serviceType: string;
  setServiceType: (val: string) => void;
  timeWindow: string;
  setTimeWindow: (val: string) => void;
  onNext: () => void;
}

// 📅 Helper data for our custom calendar
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const TIME_SLOTS = ['Morning (9a - 12p)', 'Afternoon (1p - 5p)', 'Evening (5p - 8p)'];

export function CreateJobStep3({ location, setLocation, serviceType, setServiceType, timeWindow, setTimeWindow, onNext }: Step3Props) {
  // 🪄 NEW: Calendar Modal States
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);

  const isStep3Valid = serviceType !== '' && timeWindow !== '' && location.trim().length > 0;

  // Checks if the active time window is a custom date rather than the default presets
  const isCustomTime = timeWindow !== 'Today 4-6' && timeWindow !== 'Tmrw AM' && timeWindow !== '';

  // 📅 Generate Calendar Grid Data
  const today = new Date();
  const currentMonth = MONTHS[today.getMonth()];
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).getDay();
  
  // Creates empty slots for the days before the 1st of the month
  const blanks = Array.from({ length: firstDayOfMonth }, (_, i) => i);
  // Creates the actual days of the month (1 to 31)
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Saves the custom date and closes the popup
  const handleConfirmCalendar = () => {
    if (selectedDate && selectedTimeSlot) {
      setTimeWindow(`${currentMonth} ${selectedDate} - ${selectedTimeSlot.split(' ')[0]}`);
      setShowCalendar(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1 }} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
    >
      <ScrollView 
        style={styles.stepContainer}
        contentContainerStyle={{ paddingBottom: 40 }} 
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Where & how</Text>

        {/* 1. SERVICE TYPE CHIPS */}
        <View style={styles.chipRow}>
          {['Home visit', 'Carry-in', 'Pickup'].map((item) => (
            <Pressable 
              key={item} 
              style={[styles.chip, serviceType === item && styles.chipActive]}
              onPress={() => setServiceType(item)}
            >
              <Text style={[styles.chipText, serviceType === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        {/* 2. MAP MOCKUP */}
        <View style={styles.mapContainer}>
          <View style={styles.mapRoadVertical} />
          <View style={styles.mapRoadHorizontal} />
          
          <View style={styles.mapPinContainer}>
            <View style={styles.mapPinOuter}>
              <View style={styles.mapPinInner} />
            </View>
          </View>

          <View style={styles.addressPill}>
            <Text style={styles.addressIcon}>📍</Text>
            <TextInput
              style={styles.addressInput}
              placeholder="Type customer address..."
              placeholderTextColor="#94a3b8"
              value={location}
              onChangeText={setLocation}
              autoCorrect={false}
            />
          </View>
        </View>
        <Text style={styles.helperText}>Live map disabled for Expo Go testing</Text>

        <View style={styles.spacer} />

        {/* 3. SCHEDULING CHIPS (WITH POPUP TRIGGER) */}
        <View style={styles.chipRow}>
          {['Today 4-6', 'Tmrw AM'].map((item) => (
            <Pressable 
              key={item} 
              style={[styles.chip, timeWindow === item && styles.chipActive]}
              onPress={() => setTimeWindow(item)}
            >
              <Text style={[styles.chipText, timeWindow === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
          
          {/* 🪄 The Custom "Pick..." Button */}
          <Pressable 
            style={[styles.chip, isCustomTime && styles.chipActive]}
            onPress={() => setShowCalendar(true)}
          >
            <Text style={[styles.chipText, isCustomTime && styles.chipTextActive]}>
              {isCustomTime ? timeWindow : '🗓️ Pick date...'}
            </Text>
          </Pressable>
        </View>
        
      </ScrollView>

      {/* STICKY FOOTER */}
      <View style={styles.stickyFooter}>
        <Pressable 
          style={[styles.nextBtn, !isStep3Valid && styles.nextBtnDisabled]}
          disabled={!isStep3Valid}
          onPress={onNext}
        >
          <Text style={styles.nextBtnText}>Next</Text>
        </Pressable>
      </View>

      {/* 🗓️ THE CALENDAR MODAL */}
      <Modal
        visible={showCalendar}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCalendar(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowCalendar(false)} />
          
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Schedule Task</Text>
              <Pressable onPress={() => setShowCalendar(false)}>
                <Text style={styles.sheetClose}>Close</Text>
              </Pressable>
            </View>

            <Text style={styles.monthTitle}>{currentMonth} {today.getFullYear()}</Text>

            {/* Weekday Headers */}
            <View style={styles.weekRow}>
              {WEEKDAYS.map(day => (
                <Text key={day} style={styles.weekDayText}>{day}</Text>
              ))}
            </View>

            {/* Calendar Grid */}
            <View style={styles.daysGrid}>
              {blanks.map(b => <View key={`blank-${b}`} style={styles.dayBox} />)}
              {days.map(day => (
                <Pressable 
                  key={`day-${day}`} 
                  style={[styles.dayBox, selectedDate === day && styles.dayBoxActive]}
                  onPress={() => setSelectedDate(day)}
                >
                  <Text style={[styles.dayText, selectedDate === day && styles.dayTextActive]}>{day}</Text>
                </Pressable>
              ))}
            </View>

            {/* Time Slot Selection (Appears after picking a date) */}
            {selectedDate && (
              <View style={styles.timeSlotsContainer}>
                <Text style={styles.timeTitle}>Available Times</Text>
                {TIME_SLOTS.map(slot => (
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

            {/* Confirm Button */}
            <Pressable 
              style={[styles.confirmBtn, (!selectedDate || !selectedTimeSlot) && styles.confirmBtnDisabled]}
              disabled={!selectedDate || !selectedTimeSlot}
              onPress={handleConfirmCalendar}
            >
              <Text style={styles.confirmBtnText}>Confirm Date</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  stepContainer: { flex: 1, paddingTop: 20 },
  title: { fontSize: 28, fontWeight: '800', fontStyle: 'italic', color: '#0f172a', marginBottom: 20 },
  
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  chipActive: { backgroundColor: '#1c1917', borderColor: '#1c1917' },
  chipText: { color: '#475569', fontWeight: '600', fontSize: 14 },
  chipTextActive: { color: '#ffffff' },

  mapContainer: { height: 180, backgroundColor: '#f0ebd8', borderRadius: 16, borderWidth: 1, borderColor: '#94a3b8', overflow: 'hidden', position: 'relative', marginTop: 8 },
  mapRoadVertical: { position: 'absolute', left: '35%', top: 0, bottom: 0, width: 12, backgroundColor: '#e2ddc7' },
  mapRoadHorizontal: { position: 'absolute', top: '45%', left: 0, right: 0, height: 12, backgroundColor: '#e2ddc7' },
  mapPinContainer: { position: 'absolute', top: '55%', left: '65%', transform: [{ translateX: -10 }, { translateY: -10 }] },
  mapPinOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#1c1917', justifyContent: 'center', alignItems: 'center' },
  mapPinInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1c1917' },
  
  addressPill: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: '#ffffff', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: '#cbd5e1', flexDirection: 'row', alignItems: 'center' },
  addressIcon: { fontSize: 14, marginRight: 8 },
  addressInput: { flex: 1, fontSize: 13, color: '#0f172a', fontWeight: '500', height: 36, padding: 0 },

  helperText: { fontSize: 13, color: '#64748b', marginTop: 12, marginLeft: 4 },
  
  spacer: { height: 24 },
  
  stickyFooter: { paddingVertical: 12, paddingBottom: Platform.OS === 'ios' ? 24 : 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  nextBtn: { backgroundColor: '#1c1917', paddingVertical: 18, borderRadius: 24, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#cbd5e1' },
  nextBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },

  // 🗓️ MODAL CALENDAR STYLES
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