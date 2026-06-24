import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Calculator, Banknote, PenTool, Clock, Loader2 } from "lucide-react";
import { submitCompletion, negotiateBill, logPayment, transitionJob } from "@features/jobs/data/jobsApi";

export default function TechJobCheckout() {
  const { id } = useParams();
  const navigate = useNavigate();

  // Form State
  const [timeSpent, setTimeSpent] = useState("");
  const [materials, setMaterials] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [isNegotiated, setIsNegotiated] = useState(false);
  const [negotiatedPrice, setNegotiatedPrice] = useState("");
  
  // Processing State
  const [isProcessing, setIsProcessing] = useState(false);

  const handleProcessCheckout = async () => {
    if (!originalPrice) {
      alert("Please enter the Original Bill amount.");
      return;
    }

    setIsProcessing(true);

    try {
      // 1. Safe Currency Conversion (Rupees to Integer Paisa)
      const originalPaisa = Math.round(parseFloat(originalPrice) * 100);
      const finalPaisa = isNegotiated && negotiatedPrice 
        ? Math.round(parseFloat(negotiatedPrice) * 100) 
        : originalPaisa;

      // 2. Submit Completion Metrics
      await submitCompletion(id, {
        time_spent_mins: parseInt(timeSpent) || 0,
        fuel_paisa: 0,
        // The backend expects an array of material objects
        materials: [{ name: materials || "General Field Materials", qty: 1, unit_paisa: 0 }]
      });

      // 3. Apply Negotiation Override (If active)
      if (isNegotiated && negotiatedPrice) {
        await negotiateBill(id, finalPaisa, "Negotiated by customer on site");
      }

      // 4. Log the Physical Cash Payment (Generates a unique UUID to prevent double-charging)
      const paymentUUID = crypto.randomUUID();
      await logPayment(id, finalPaisa, "cash", paymentUUID);

      // 5. Finalize and Close the Job
      await transitionJob(id, { action: "ready" });

      alert("Job successfully billed and closed!");
      navigate("/my-jobs"); // Route back to the main queue
      
    } catch (error) {
      console.error("Checkout Pipeline Error:", error);
      alert("Failed to process payment. Ensure you are connected to the network.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-5 pb-10">
      {/* Navigation */}
      <div className="flex items-center gap-3 mb-4">
        <Link to={`/my-jobs/${id}`} className="p-2 bg-white rounded-full shadow-sm border border-slate-200 text-slate-600 active:scale-95">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-lg font-extrabold text-slate-900 leading-tight">Job Checkout</h2>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-5">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
          <PenTool className="w-4 h-4 text-slate-500" /> Completion Details
        </h3>
        
        {/* Time Spent */}
        <div>
          <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-1.5">
            <Clock className="w-3 h-3" /> Time Spent (Minutes)
          </label>
          <input
            type="number"
            value={timeSpent}
            onChange={(e) => setTimeSpent(e.target.value)}
            placeholder="e.g. 45"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
          />
        </div>

        {/* Materials Used */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1.5">
            Materials Used
          </label>
          <textarea
            value={materials}
            onChange={(e) => setMaterials(e.target.value)}
            placeholder="e.g. 1x Compressor Valve..."
            className="w-full h-20 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 resize-none focus:outline-none focus:ring-2 focus:ring-slate-900/20"
          />
        </div>
      </div>

      {/* Billing Section */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-5">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
          <Calculator className="w-4 h-4 text-slate-500" /> Billing & Payment
        </h3>

        {/* Original Price */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1.5">
            Original Bill (Rs.)
          </label>
          <input
            type="number"
            value={originalPrice}
            onChange={(e) => setOriginalPrice(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-lg font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
          />
        </div>

        {/* Negotiation Toggle */}
        <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer">
          <input
            type="checkbox"
            checked={isNegotiated}
            onChange={(e) => setIsNegotiated(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
          />
          <span className="text-sm font-bold text-slate-700">Customer negotiated the price</span>
        </label>

        {/* Negotiated Price */}
        {isNegotiated && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-200">
            <label className="block text-xs font-bold uppercase tracking-wide text-indigo-500 mb-1.5">
              Final Agreed Price (Rs.)
            </label>
            <input
              type="number"
              value={negotiatedPrice}
              onChange={(e) => setNegotiatedPrice(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-lg font-bold text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
        )}
      </div>

      <button 
        onClick={handleProcessCheckout}
        disabled={isProcessing || !originalPrice}
        className="w-full flex items-center justify-center gap-2 py-4 bg-emerald-600 text-white rounded-2xl font-bold active:scale-[0.98] transition-transform shadow-md shadow-emerald-600/20 disabled:opacity-50"
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Processing Pipeline...
          </>
        ) : (
          <>
            <Banknote className="w-5 h-5" />
            Process Payment & Close
          </>
        )}
      </button>
    </div>
  );
}