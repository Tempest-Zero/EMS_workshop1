import { createPortal } from "react-dom";
import { CheckCircle2, Info, AlertTriangle } from "lucide-react";
import { useApp } from "../context/AppContext";

const toneStyles = {
  default: "bg-slate-900 text-white",
  ready: "bg-emerald-600 text-white",
  danger: "bg-red-600 text-white",
};
const toneIcon = { default: Info, ready: CheckCircle2, danger: AlertTriangle };

export default function ToastHost() {
  const { toasts, removeToast } = useApp();
  if (!toasts.length) return null;
  return createPortal(
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => {
        const Icon = toneIcon[t.tone] || Info;
        return (
          <button
            key={t.id}
            onClick={() => removeToast(t.id)}
            style={{ animation: "popIn .18s ease-out" }}
            className={`pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg ${
              toneStyles[t.tone] || toneStyles.default
            }`}
          >
            <Icon className="h-4 w-4" />
            {t.message}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
