import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/app.css";

document.documentElement.dataset.theme = localStorage.getItem("fily.theme") || "dark";

// Fily renders its own context menus everywhere. Suppress the webview's
// native menu (Back/Forward/Reload/...) so right-click shows exactly one menu.
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
}, true);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
