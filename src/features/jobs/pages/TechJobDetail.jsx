import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, User, Phone, MapPin, Wrench, Loader2, Camera, CheckCircle, MessageSquare, X, Send } from "lucide-react";
import { fetchJob, addJobNote } from "@features/jobs/data/jobsApi";

export default function TechJobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);

  // Hardware & Modal States
  const fileInputRef = useRef(null);
  const [isRemarkOpen, setIsRemarkOpen] = useState(false);
  const [remarkText, setRemarkText] = useState("");
  const [submittingRemark, setSubmittingRemark] = useState(false);

  const loadJobData = () => {
    fetchJob(id)
      .then((data) => setJob(data))
      .catch((err) => console.error("Failed to load job details:", err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadJobData();
  }, [id]);

  // ── ACTION: SUBMIT TEXT REMARK ──
  const handleSubmitRemark = async () => {
    if (!remarkText.trim()) return;
    setSubmittingRemark(true);
    try {
      await addJobNote(id, remarkText);
      setRemarkText("");
      setIsRemarkOpen(false);
      loadJobData(); // Refresh the job to show the new note
      alert("Remark added successfully!");
    } catch (error) {
      alert("Failed to add remark. Please try again.");
    } finally {
      setSubmittingRemark(false);
    }
  };

  // ── ACTION: HANDLE CAMERA CAPTURE ──
  const handleMediaCapture = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    alert(`Successfully captured: ${file.name} (${Math.round(file.size / 1024)} KB)`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh] text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!job) return <div className="p-6 text-center text-slate-500">Job not found.</div>;

  return (
    <div className="space-y-4 pb-10">
      {/* ── TOP NAVIGATION ── */}
      <div className="flex items-center gap-3 mb-2">
        <Link to="/my-jobs" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 text-slate-600 active:scale-95 transition-transform">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 leading-tight">Order #{job.id.substring(0, 5).toUpperCase()}</h2>
          <div className="text-xs font-bold text-indigo-600 uppercase tracking-wide">{job.status}</div>
        </div>
      </div>

      {/* ── CUSTOMER & DEVICE INFO ── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-slate-100 rounded-lg text-slate-500 mt-0.5"><User className="w-4 h-4" /></div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Customer</div>
            <div className="text-sm font-bold text-slate-900">{job.customer_name || "N/A"}</div>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="p-2 bg-slate-100 rounded-lg text-slate-500 mt-0.5"><Phone className="w-4 h-4" /></div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contact</div>
            <div className="text-sm font-bold text-slate-900">{job.customer_phone || "N/A"}</div>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="p-2 bg-slate-100 rounded-lg text-slate-500 mt-0.5"><MapPin className="w-4 h-4" /></div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Address</div>
            <div className="text-sm font-medium text-slate-900 leading-snug">{job.customer_address || "No address provided"}</div>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex items-start gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600 mt-0.5"><Wrench className="w-4 h-4" /></div>
          <div>
            <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Issue / Device</div>
            <div className="text-sm font-bold text-slate-900">{job.device_model || "Appliance"}</div>
            <p className="text-sm text-slate-600 mt-1">{job.issue_description || "No description provided."}</p>
          </div>
        </div>
      </div>

      {/* ── HIDDEN NATIVE CAMERA TRIGGER ── */}
      <input
        type="file"
        accept="image/*,video/*"
        capture="environment"
        ref={fileInputRef}
        className="hidden"
        onChange={handleMediaCapture}
      />

      {/* ── ACTION GRID ── */}
      <div className="grid grid-cols-2 gap-3">
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 p-4 bg-white border border-slate-200/80 rounded-2xl shadow-sm active:scale-95 transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-1">
            <Camera className="w-5 h-5" />
          </div>
          <span className="text-xs font-bold text-slate-700">Capture Media</span>
        </button>

        <button 
          onClick={() => setIsRemarkOpen(true)}
          className="flex flex-col items-center justify-center gap-2 p-4 bg-white border border-slate-200/80 rounded-2xl shadow-sm active:scale-95 transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mb-1">
            <MessageSquare className="w-5 h-5" />
          </div>
          <span className="text-xs font-bold text-slate-700">Add Remark</span>
        </button>
      </div>

      {/* ── CHECKOUT BUTTON (Fully Fixed) ── */}
      <Link 
        to={`/my-jobs/${job.id}/checkout`} 
        className="w-full flex items-center justify-center gap-2 py-4 bg-slate-900 text-white rounded-2xl font-bold active:scale-[0.98] transition-transform shadow-md"
      >
        <CheckCircle className="w-5 h-5" />
        Complete & Bill Job
      </Link>

      {/* ── REMARK MODAL OVERLAY ── */}
      {isRemarkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/50">
              <h3 className="font-bold text-slate-900">Add Job Remark</h3>
              <button onClick={() => setIsRemarkOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <textarea
                value={remarkText}
                onChange={(e) => setRemarkText(e.target.value)}
                placeholder="Type your notes or updates here..."
                className="w-full h-32 p-3 text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 resize-none"
                autoFocus
              />
              <button
                onClick={handleSubmitRemark}
                disabled={submittingRemark || !remarkText.trim()}
                className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 text-white font-bold rounded-xl disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                {submittingRemark ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Submit Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}