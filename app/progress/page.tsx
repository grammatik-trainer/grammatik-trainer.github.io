import type { Metadata } from "next";
import { TrainerApp } from "../components/trainer-app";

export const metadata: Metadata = {
  title: "Fortschritt — Der Die Das Sprint",
  description: "Sieh deinen lokal gespeicherten Lernfortschritt und deine Trainingsserie.",
  alternates: { canonical: "/progress/" },
  robots: { index: false, follow: false },
};

export default function ProgressPage() {
  return <TrainerApp initialView="progress" />;
}
