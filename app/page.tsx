import type { Metadata } from "next";
import { OpenGymApp } from "./OpenGymApp";

export const metadata: Metadata = {
  title: "OpenGym Coach",
  description: "Entrena, progresa y mantén tu historial bajo tu control.",
};

export default function Home() {
  return <OpenGymApp />;
}
