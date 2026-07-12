import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ManagerLayout from "@app/layouts/ManagerLayout";
import ToastHost from "@app/components/ToastHost";
import { useAuth } from "@app/providers/AuthContext";
import { Login, ForceChangePassword } from "@features/auth";

// Each feature exposes its pages through its public barrel (src/features/<x>/index.js).
// This is the MANAGER web. Technician field workflows (clock-in, my-jobs, SOP
// capture, completion form, closing video) live in the separate mobile app —
// they are intentionally NOT routed here.
import { Dashboard } from "@features/dashboard";
import { JobsBoard, JobDetail } from "@features/jobs";
import { Technicians, TechnicianDetail } from "@features/technicians";
import { Attendance, AttendanceTechDetail, AttendanceVariance } from "@features/attendance";
import { Schedule } from "@features/schedule";
import { Troubleshooting } from "@features/troubleshooting";
import { Settings } from "@features/settings";
import { Users } from "@features/users";

export default function App() {
  const { isAuthenticated, ready, needsPasswordChange } = useAuth();

  // Wait for the initial token check so we don't flash the login screen.
  if (!ready) return <div className="min-h-[100svh] bg-[#eef2f6]" />;
  if (!isAuthenticated) return <Login />;
  if (needsPasswordChange) return <ForceChangePassword />;

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route element={<ManagerLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="technicians" element={<Technicians />} />
          <Route path="technicians/:id" element={<TechnicianDetail />} />
          <Route path="jobs" element={<JobsBoard />} />
          <Route path="jobs/:id" element={<JobDetail />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="attendance/variance" element={<AttendanceVariance />} />
          <Route path="attendance/:techId" element={<AttendanceTechDetail />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="troubleshooting" element={<Troubleshooting />} />
          <Route path="settings" element={<Settings />} />
          <Route path="users" element={<Users />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </BrowserRouter>
  );
}
