import TechJobCheckout from "@features/jobs/pages/TechJobCheckout";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ManagerLayout from "@app/layouts/ManagerLayout";
import TechnicianLayout from "@app/layouts/TechnicianLayout"; // 👈 New: We will create this file
import ToastHost from "@app/components/ToastHost";
import { useAuth } from "@app/providers/AuthContext";
import { Login } from "@features/auth";

// MANAGER web page imports
import { Dashboard } from "@features/dashboard";
import { JobsBoard, JobDetail } from "@features/jobs";
import { Technicians, TechnicianDetail } from "@features/technicians";
import { Attendance, AttendanceTechDetail } from "@features/attendance";
import { Schedule } from "@features/schedule";
import { Troubleshooting } from "@features/troubleshooting";
import { Settings } from "@features/settings";

// 👈 New: Technician web pages placeholders (we will add these to existing features)
// We will build these directly inside your current src/features folders
import TechJobsList from "@features/jobs/pages/TechJobsList";
import TechJobDetail from "@features/jobs/pages/TechJobDetail";
import TechClock from "@features/attendance/pages/TechClock";

export default function App() {
  const { isAuthenticated, ready, user } = useAuth(); // 👈 Added 'user' to read roles (e.g., user.role)

  // Wait for the initial token check so we don't flash the login screen.
  if (!ready) return <div className="min-h-[100svh] bg-[#eef2f6]" />;
  if (!isAuthenticated) return <Login />;

  // 👈 Detect role and establish routing paths
  const isManager = user?.role === "manager"; 

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        {isManager ? (
          /* ================= MANAGER ROUTES ================= */
          <Route element={<ManagerLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="technicians" element={<Technicians />} />
            <Route path="technicians/:id" element={<TechnicianDetail />} />
            <Route path="jobs" element={<JobsBoard />} />
            <Route path="jobs/:id" element={<JobDetail />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="attendance/:techId" element={<AttendanceTechDetail />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="troubleshooting" element={<Troubleshooting />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        ) : (
          /* ================= TECHNICIAN ROUTES ================= */
          /* Uses the same style principles, but optimized for field mobile viewports */
          <Route element={<TechnicianLayout />}>
	    <Route path="my-jobs/:id/checkout" element={<TechJobCheckout />} />
            <Route index element={<Navigate to="/my-jobs" replace />} />
            <Route path="my-jobs" element={<TechJobsList />} />
            <Route path="my-jobs/:id" element={<TechJobDetail />} />
            <Route path="clock" element={<TechClock />} />
            <Route path="*" element={<Navigate to="/my-jobs" replace />} />
          </Route>
        )}
      </Routes>
      <ToastHost />
    </BrowserRouter>
  );
}