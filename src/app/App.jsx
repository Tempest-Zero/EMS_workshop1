import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ManagerLayout from "@app/layouts/ManagerLayout";
import TechLayout from "@app/layouts/TechLayout";
import ToastHost from "@app/components/ToastHost";
import { useAuth } from "@app/providers/AuthContext";
import { Login } from "@features/auth";

// Each feature exposes its pages through its public barrel (src/features/<x>/index.js).
import { Dashboard } from "@features/dashboard";
import { JobsBoard, JobDetail, MyJobs, TechJobDetail } from "@features/jobs";
import { Technicians, TechnicianDetail, Profile } from "@features/technicians";
import { Attendance, AttendanceTechDetail, ClockIn } from "@features/attendance";
import { Schedule, MyWeek } from "@features/schedule";
import { Troubleshooting, TechTroubleshoot } from "@features/troubleshooting";
import { Settings } from "@features/settings";

export default function App() {
  const { isAuthenticated, ready } = useAuth();

  // Wait for the initial token check so we don't flash the login screen.
  if (!ready) return <div className="min-h-[100svh] bg-[#eef2f6]" />;
  if (!isAuthenticated) return <Login />;

  return (
    <BrowserRouter>
      <Routes>
        {/* Manager (desktop) */}
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
        </Route>

        {/* Technician (mobile) */}
        <Route path="tech" element={<TechLayout />}>
          <Route index element={<Navigate to="/tech/jobs" replace />} />
          <Route path="jobs" element={<MyJobs />} />
          <Route path="jobs/:id" element={<TechJobDetail />} />
          <Route path="clock" element={<ClockIn />} />
          <Route path="troubleshoot" element={<TechTroubleshoot />} />
          <Route path="profile" element={<Profile />} />
          <Route path="schedule" element={<MyWeek />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </BrowserRouter>
  );
}
