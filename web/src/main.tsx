import { createRoot } from "react-dom/client";
import { LazyMotion } from "motion/react";
import { App } from "./App";
import "./styles.css";

// Start loading immediately after mount: the cover's initial fade needs these
// features too, so waiting for an idle callback could leave it hidden.
const loadFeatures = () => import("./motion-features").then((m) => m.default);

createRoot(document.getElementById("root")!).render(
  <LazyMotion features={loadFeatures} strict>
    <App />
  </LazyMotion>,
);
