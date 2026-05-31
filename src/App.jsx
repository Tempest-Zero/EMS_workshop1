import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ManagerLayout from "./layouts/ManagerLayout";
import TechLayout from "./layouts/TechLayout";
import ToastHost from "./components/ToastHost";

// Manager pages
import Dashboard from "./pages/manager/Dashboard";
import Technicians from "./pages/manager/Technicians";
import TechnicianDetail from "./pages/manager/TechnicianDetail";
import JobsBoard from "./pages/manager/JobsBoard";
import JobDetail from "./pages/manager/JobDetail";
import Attendance from "./pages/manager/Attendance";
import Schedule from "./pages/manager/Schedule";
import Troubleshooting from "./pages/manager/Troubleshooting";
import Settings from "./pages/manager/Settings";

// Technician pages
import MyJobs from "./pages/tech/MyJobs";
import TechJobDetail from "./pages/tech/TechJobDetail";
import ClockIn from "./pages/tech/ClockIn";
import TechTroubleshoot from "./pages/tech/TechTroubleshoot";
import Profile from "./pages/tech/Profile";
import MyWeek from "./pages/tech/MyWeek";

export default function App() {
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
