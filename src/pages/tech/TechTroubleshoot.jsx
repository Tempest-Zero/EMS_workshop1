import TroubleshootGuide from "../../components/TroubleshootGuide";

export default function TechTroubleshoot() {
  return (
    <div>
      <div className="px-4 pt-4">
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">Diagnose</h1>
        <p className="text-sm text-slate-500">Fault codes & common fixes</p>
      </div>
      <TroubleshootGuide compact />
    </div>
  );
}
