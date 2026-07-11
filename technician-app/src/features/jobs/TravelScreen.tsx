/**
 * Travel to the customer. STILL A MOCK in this stage: the "arrival" is a
 * placeholder alert — real depart/arrive GPS punches through the outbox, the
 * live map, and the breadcrumb trail land in the travel-wiring stage.
 */
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from 'react';
import { StyleSheet, Text, View, Pressable, SafeAreaView, StatusBar, Alert } from 'react-native';

import type { RootStackParamList } from "../../lib/navigation";
import type { JobsStackParamList } from "./types";

type Props = CompositeScreenProps<
  NativeStackScreenProps<JobsStackParamList, "Travel">,
  NativeStackScreenProps<RootStackParamList>
>;

export function TravelScreen({ route, navigation }: Props) {
  const { id, token } = route.params;
  const [isArriving, setIsArriving] = useState(false);

  const handleArrival = () => {
    setIsArriving(true);

    // ⏱️ Capture the exact start time — the arrival wizard's timer seed.
    const timeOfArrival = Date.now();

    setTimeout(() => {
      Alert.alert(
        "Location Verified",
        "Arrival punched at customer location. Entering Job Hub.",
        [{
          text: "OK",
          onPress: () => {
            navigation.navigate("JobDetail", { id, token });
            setTimeout(() => {
              navigation.navigate("ArrivalWizard", { id, token, arrivalTime: timeOfArrival });
            }, 300);
          }
        }]
      );
    }, 800);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#1e293b" />
      
      {/* Dark mode header for navigation screen feel */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <View>
          <Text style={styles.headerSub}>Navigating to</Text>
          <Text style={styles.headerTitle}>Job #{token}</Text>
        </View>
      </View>

      {/* Map Route Mockup */}
      <View style={styles.mapArea}>
        <View style={styles.routeLine} />
        <View style={styles.techPin}>
          <Text style={styles.pinText}>🚗</Text>
        </View>
        <View style={styles.destinationPin}>
          <View style={styles.destinationDot} />
        </View>

        {/* Floating ETA Card */}
        <View style={styles.etaCard}>
          <Text style={styles.etaTime}>14 min</Text>
          <Text style={styles.etaDistance}>4.2 km · Fastest route</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.instructionText}>
          Drive safely. Tap below once you have reached the customer's gate or door.
        </Text>

        <Pressable 
          style={[styles.arriveBtn, isArriving && styles.arriveBtnBusy]}
          disabled={isArriving}
          onPress={handleArrival}
        >
          <Text style={styles.arriveBtnText}>
            {isArriving ? "Verifying GPS..." : "I HAVE ARRIVED"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1e293b' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, backgroundColor: '#1e293b' },
  backButton: { paddingRight: 16, paddingVertical: 8 },
  backArrow: { fontSize: 24, color: '#ffffff', fontWeight: '300' },
  headerSub: { fontSize: 13, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#ffffff' },
  
  mapArea: { flex: 1, backgroundColor: '#e2e8f0', position: 'relative', overflow: 'hidden' },
  routeLine: { position: 'absolute', top: '20%', bottom: '30%', left: '50%', width: 8, backgroundColor: '#3b82f6', marginLeft: -4, borderRadius: 4 },
  techPin: { position: 'absolute', bottom: '25%', left: '50%', marginLeft: -20, width: 40, height: 40, backgroundColor: '#ffffff', borderRadius: 20, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  pinText: { fontSize: 20 },
  destinationPin: { position: 'absolute', top: '15%', left: '50%', marginLeft: -12, width: 24, height: 24, backgroundColor: '#ffffff', borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#10b981' },
  destinationDot: { width: 8, height: 8, backgroundColor: '#10b981', borderRadius: 4 },
  
  etaCard: { position: 'absolute', top: 20, alignSelf: 'center', backgroundColor: '#ffffff', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 30, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5, alignItems: 'center' },
  etaTime: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  etaDistance: { fontSize: 13, fontWeight: '600', color: '#64748b', marginTop: 2 },

  footer: { backgroundColor: '#ffffff', padding: 24, paddingBottom: 40, borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -20 },
  instructionText: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  arriveBtn: { backgroundColor: '#10b981', paddingVertical: 20, borderRadius: 16, alignItems: 'center', shadowColor: '#10b981', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  arriveBtnBusy: { backgroundColor: '#94a3b8', shadowOpacity: 0 },
  arriveBtnText: { color: '#ffffff', fontSize: 18, fontWeight: '800', letterSpacing: 1 },
});