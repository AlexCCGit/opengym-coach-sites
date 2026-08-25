import React from "react";
import { createRoot } from "react-dom/client";
import { OpenGymApp } from "../app/OpenGymApp";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><OpenGymApp /></React.StrictMode>);
