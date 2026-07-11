/**
 * The 4-step intake wizard. STILL A MOCK in this stage: submit is a
 * placeholder alert — the real POST /api/jobs through the outbox, the map
 * pin, and the voice-note uploads land in the intake-wiring stage.
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from 'react';
import { StyleSheet, View, Pressable, SafeAreaView, StatusBar, Alert, Text, Platform } from 'react-native';

import type { JobsStackParamList } from "../types";
// 🔌 Child Steps
import { CreateJobStep1 } from './CreateJobStep1Screen';
import { CreateJobStep2 } from './CreateJobStep2';
import { CreateJobStep3 } from './CreateJobStep3';
import { CreateJobStep4 } from './CreateJobStep4';

type Props = NativeStackScreenProps<JobsStackParamList, "CreateJob">;

export function CreateJobWizard({ navigation }: Props) {
  const [currentStep, setCurrentStep] = useState(1);
  const [highestStep, setHighestStep] = useState(1);
  
  // Shared Data - Step 1
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [isExisting, setIsExisting] = useState<boolean | null>(null);
  
  // Shared Data - Step 2
  const [appliance, setAppliance] = useState('');
  const [brand, setBrand] = useState('');
  const [problemText, setProblemText] = useState('');
  const [problemAudio, setProblemAudio] = useState(''); // 🎙️ NEW: Stores the problem audio file URI
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('voice');
  
  // Shared Data - Step 3
  const [location, setLocation] = useState(''); 
  const [serviceType, setServiceType] = useState('Home visit');
  const [timeWindow, setTimeWindow] = useState('Today 4-6');

  // Shared Data - Step 4
  const [estimate, setEstimate] = useState('');
  const [approval, setApproval] = useState('Approve now');
  const [consent, setConsent] = useState(true);
  const [voiceNote, setVoiceNote] = useState(''); // Stores Step 4's Estimate audio file URI

  // 🚦 STRICT VALIDATION LOCKS 
  const isStep1Valid = phone.length >= 10 && name.trim().length > 0;
  // 🪄 Step 2 requires an appliance, a brand, and AT LEAST ONE format of problem description
  const isStep2Valid = appliance !== '' && brand !== '' && (problemText.trim().length > 0 || problemAudio.length > 0);
  const isStep3Valid = location !== '' && serviceType !== '' && timeWindow !== ''; 
  const isStep4Valid = estimate.trim().length > 0;

  // 🟢 SMART DOT NAVIGATION 
  const handleDotPress = (targetStep: number) => {
    if (targetStep <= highestStep) {
      setCurrentStep(targetStep);
    }
  };

  // 🚀 THE FINAL SUBMISSION — placeholder until the intake-wiring stage
  // replaces it with the real POST /api/jobs through the outbox.
  const submitJob = () => {
    Alert.alert("Job Created!", `Successfully queued new ${appliance} job at ${location}.`, [
      { text: "OK", onPress: () => navigation.goBack() }
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      
      {/* 🟢 HEADER PAGINATION DOTS */}
      <View style={styles.wizardHeader}>
        {[1, 2, 3, 4].map((stepIndex) => {
          
          const isActive = currentStep === stepIndex;
          let isCompleted = false;
          
          if (stepIndex < highestStep) {
            if (stepIndex === 1 && isStep1Valid) isCompleted = true;
            if (stepIndex === 2 && isStep2Valid) isCompleted = true;
            if (stepIndex === 3 && isStep3Valid) isCompleted = true;
            if (stepIndex === 4 && isStep4Valid) isCompleted = true;
          }

          return (
            <Pressable 
              key={stepIndex} 
              onPress={() => handleDotPress(stepIndex)} 
              hitSlop={20}
              style={[
                styles.dot,
                isActive && styles.dotActive,
                (!isActive && isCompleted) && styles.dotCompleted,
                (stepIndex > highestStep) && { opacity: 0.4 } 
              ]}
            >
              {isActive && <Text style={styles.activeDotText}>{stepIndex}</Text>}
            </Pressable>
          );
        })}
      </View>

      {/* 🖥️ STEP RENDERER */}
      <View style={styles.contentArea}>
        {currentStep === 1 && (
          <CreateJobStep1 
            phone={phone} setPhone={setPhone} name={name} setName={setName}
            isExisting={isExisting} setIsExisting={setIsExisting}
            onNext={() => {
              setCurrentStep(2);
              setHighestStep(Math.max(highestStep, 2));
            }} 
          />
        )}

        {currentStep === 2 && (
          <CreateJobStep2 
            appliance={appliance} setAppliance={setAppliance} 
            brand={brand} setBrand={setBrand}
            problemText={problemText} setProblemText={setProblemText}
            problemAudio={problemAudio} setProblemAudio={setProblemAudio} // 🎙️ NEW: Passed down to Step 2
            inputMode={inputMode} setInputMode={setInputMode}
            isExisting={isExisting}
            onNext={() => {
              setCurrentStep(3);
              setHighestStep(Math.max(highestStep, 3));
            }} 
          />
        )}

        {currentStep === 3 && (
          <CreateJobStep3 
            location={location} setLocation={setLocation}
            serviceType={serviceType} setServiceType={setServiceType} 
            timeWindow={timeWindow} setTimeWindow={setTimeWindow}
            onNext={() => {
              setCurrentStep(4);
              setHighestStep(Math.max(highestStep, 4));
            }} 
          />
        )}

        {currentStep === 4 && (
          <View style={{flex: 1}}>
            <CreateJobStep4 
              estimate={estimate} setEstimate={setEstimate}
              approval={approval} setApproval={setApproval} 
              consent={consent} setConsent={setConsent}
              voiceNote={voiceNote} setVoiceNote={setVoiceNote} 
              name={name} appliance={appliance} brand={brand} serviceType={serviceType} timeWindow={timeWindow}
              onSubmit={submitJob}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  contentArea: { flex: 1, paddingHorizontal: 24 },
  
  wizardHeader: { 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginTop: Platform.OS === 'android' ? 50 : 20, 
    paddingBottom: 20, 
    gap: 16 
  },
  
  dot: { 
    width: 20, 
    height: 20, 
    borderRadius: 10, 
    borderWidth: 2, 
    borderColor: '#cbd5e1', 
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center'
  },
  dotActive: { borderColor: '#0f172a', backgroundColor: '#0f172a' },
  dotCompleted: { borderColor: '#10b981', backgroundColor: '#10b981' }, 
  
  activeDotText: { color: 'white', fontSize: 10, fontWeight: '900' },

});