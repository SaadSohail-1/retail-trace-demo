import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AdminDashboard from "./App";
import PublicVerificationPage from "./PublicVerificationPage";
import Storefront from "./Storefront";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Storefront />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/verify/:recordId" element={<PublicVerificationPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
