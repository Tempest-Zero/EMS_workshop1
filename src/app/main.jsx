import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import App from "@app/App";
import { AppProvider } from "@app/providers/AppContext";
import { AuthProvider } from "@app/providers/AuthContext";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <AppProvider>
        <App />
      </AppProvider>
    </AuthProvider>
  </StrictMode>
);
