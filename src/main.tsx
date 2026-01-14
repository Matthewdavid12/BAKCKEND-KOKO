import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./styles/index.css";

console.log("API BASE =", import.meta.env.VITE_API_BASE); // 👈 ADD THIS

createRoot(document.getElementById("root")!).render(<App />);
