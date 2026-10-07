import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { applyCachedAppearance } from "./lib/appearance";
import "./styles/theme.css";
import "./styles/experience.css";
import "./styles/notifications.css";
import "./styles/about.css";
import "./styles/settings.css";

applyCachedAppearance();

createRoot(document.getElementById("root")!).render(<App />);
