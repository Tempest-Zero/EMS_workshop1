import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from 'react';
import { StyleSheet, View, SafeAreaView, StatusBar } from 'react-native';

import type { RootStackParamList } from "../../../lib/navigation";
import { ArrivalCapturesScreen } from './ArrivalCapturesScreen';
import { ArrivalJobStep2 } from './ArrivalJobStep2';
import { ArrivalJobStep3 } from './ArrivalJobStep3';
import { ArrivalJobStep4 } from './ArrivalJobStep4';
import { ArrivalJobStep5 } from './ArrivalJobStep5';

type Props = NativeStackScreenProps<RootStackParamList, "ArrivalWizard">;

export function ArrivalJobWizard({ route, navigation }: Props) {
  const { id, token } = route.params;
  const [currentStep, setCurrentStep] = useState(1);

  // The travel screen's arrival moment seeds the on-site timer (fallback: now).
  const arrivalTime = route.params.arrivalTime ?? Date.now();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      
      <View style={styles.contentArea}>
        {currentStep === 1 && <ArrivalCapturesScreen onNext={() => setCurrentStep(2)} />}
        {currentStep === 2 && <ArrivalJobStep2 onNext={() => setCurrentStep(3)} />}
        {currentStep === 3 && <ArrivalJobStep3 onNext={() => setCurrentStep(4)} />}
        {currentStep === 4 && <ArrivalJobStep4 onNext={() => setCurrentStep(5)} />}
        
        {/* RENDER STEP 5 HERE WITH THE TIMER */}
        {currentStep === 5 && (
          <ArrivalJobStep5 
            arrivalTime={arrivalTime} 
            onComplete={() => {
              // 1. Close the Wizard Modal
              navigation.goBack();

              // 2. Open the Bill Sheet!
              setTimeout(() => {
                navigation.navigate('BillSheet', { id, token });
              }, 300);
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  contentArea: { flex: 1 },
});