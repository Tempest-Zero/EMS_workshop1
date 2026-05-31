// Browseable common-fixes reference, grouped by appliance for the accordion.
export const commonFixes = [
  {
    appliance: "Split AC",
    symptoms: [
      { symptom: "Not Cooling", cause: "Low refrigerant, dirty filters, or weak capacitor", partsToCheck: ["Refrigerant gas", "Air filter / coil cleaning", "Run capacitor"], costRange: "Rs 1,500 – Rs 3,500" },
      { symptom: "Tripping Breaker", cause: "Faulty run capacitor or compressor short circuit", partsToCheck: ["Run capacitor", "Compressor contactor"], costRange: "Rs 550 – Rs 2,000" },
      { symptom: "Water Leak", cause: "Blocked drain pipe or dirty evaporator tray", partsToCheck: ["Drain pipe cleaning", "Drain pan"], costRange: "Rs 500 – Rs 1,500" },
      { symptom: "Common Error Codes", cause: "E1/E4/E6/F0/P1 — see fault-code reference above", partsToCheck: ["Temp sensor", "Outdoor PCB"], costRange: "Rs 300 – Rs 8,500" },
    ],
  },
  {
    appliance: "Washing Machine",
    symptoms: [
      { symptom: "Won't Drain", cause: "Clogged filter/hose or seized drain pump", partsToCheck: ["Drain pump", "Filter cleaning"], costRange: "Rs 800 – Rs 3,200" },
      { symptom: "Won't Spin", cause: "Broken belt, worn motor brushes, or door-lock fault", partsToCheck: ["Drive belt", "Carbon brushes", "Door lock"], costRange: "Rs 650 – Rs 2,400" },
      { symptom: "Leaking", cause: "Worn door gasket or loose hose clamps", partsToCheck: ["Door gasket", "Inlet/outlet hose"], costRange: "Rs 700 – Rs 2,500" },
      { symptom: "Error Codes", cause: "UE/OE/DE/LE/PE — see fault-code reference above", partsToCheck: ["Level sensor", "Hall sensor"], costRange: "Rs 800 – Rs 6,000" },
    ],
  },
  {
    appliance: "Refrigerator",
    symptoms: [
      { symptom: "Not Cooling", cause: "Thermostat, relay, gas leak, or fan failure", partsToCheck: ["Thermostat", "Compressor relay", "Refrigerant gas"], costRange: "Rs 900 – Rs 4,000" },
      { symptom: "Noisy", cause: "Worn fan bearing or compressor mounts", partsToCheck: ["Fan motor", "Compressor mounts"], costRange: "Rs 1,200 – Rs 2,800" },
      { symptom: "Ice Buildup", cause: "Faulty defrost heater/timer or poor door seal", partsToCheck: ["Defrost heater", "Defrost timer", "Door gasket"], costRange: "Rs 800 – Rs 2,500" },
      { symptom: "Compressor Issues", cause: "Weak start relay/capacitor or compressor wear", partsToCheck: ["Relay + overload", "Start capacitor"], costRange: "Rs 700 – Rs 6,500" },
    ],
  },
  {
    appliance: "Microwave",
    symptoms: [
      { symptom: "Not Heating", cause: "Burnt magnetron or failed HV diode/capacitor", partsToCheck: ["Magnetron", "HV diode", "HV capacitor"], costRange: "Rs 400 – Rs 4,000" },
      { symptom: "Sparking", cause: "Burnt waveguide cover or damaged cavity", partsToCheck: ["Waveguide cover", "Mica sheet"], costRange: "Rs 200 – Rs 600" },
      { symptom: "Turntable Issues", cause: "Failed turntable motor or broken drive coupler", partsToCheck: ["Turntable motor", "Drive coupler"], costRange: "Rs 400 – Rs 1,200" },
    ],
  },
];
