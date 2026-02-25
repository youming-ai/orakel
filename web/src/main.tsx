import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import Dashboard from "./components/Dashboard";
import { useUIStore } from "./lib/store";

// Apply stored theme before render (backup for inline script)
const storedTheme = useUIStore.getState().theme;
document.documentElement.classList.toggle("dark", storedTheme === "dark");

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Root element not found");
}

createRoot(rootElement).render(
	<StrictMode>
		<Dashboard />
	</StrictMode>,
);
